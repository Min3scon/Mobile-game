-- Neon Swarm online database.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run again after updates: it only creates or replaces things.
--
-- Security model: the game in the browser is never trusted. Players can only read their own profile
-- row. Everything else (saves, scores, raid, duels) goes through the functions below, which check a
-- server-issued run ticket and reject impossible results.
--
-- Privacy: each player's cloud save is encrypted (AES-256) with a key that belongs only to them.
-- Keys live in the separate "private" schema, which the website and players can never read.
-- Deleting an account destroys the key first, so any leftover copy of the save is unreadable.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- per-player encryption keys (never exposed to the website) ----------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.user_keys (
  user_id uuid primary key references auth.users on delete cascade,
  key text not null,
  created_at timestamptz not null default now()
);
alter table private.user_keys enable row level security;
revoke all on private.user_keys from public, anon, authenticated;

create or replace function private.user_key(uid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  select key into k from private.user_keys where user_id = uid;
  if k is null then
    insert into private.user_keys (user_id, key) values (uid, encode(extensions.gen_random_bytes(32), 'hex'))
    on conflict (user_id) do nothing;
    select key into k from private.user_keys where user_id = uid;
  end if;
  return k;
end $$;
revoke all on function private.user_key(uuid) from public, anon, authenticated;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text,
  save_enc bytea,
  save_updated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists save_enc bytea;
alter table public.profiles drop column if exists save;
alter table public.profiles drop constraint if exists save_size;
alter table public.profiles add constraint save_size check (save_enc is null or octet_length(save_enc) < 400000);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  mode text not null,
  sector int not null default 1,
  seed bigint not null default 0,
  day date not null default (now() at time zone 'utc')::date,
  started_at timestamptz not null default now(),
  used_score boolean not null default false,
  used_raid boolean not null default false,
  used_duel boolean not null default false
);
create index if not exists runs_user_started on public.runs (user_id, started_at desc);
create unique index if not exists runs_one_daily on public.runs (user_id, day) where mode = 'daily';

create table if not exists public.scores (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  run_id uuid not null unique references public.runs on delete cascade,
  score int not null,
  time_s int not null,
  kills int not null,
  level int not null,
  pilot text not null,
  won boolean not null default false,
  sector int not null default 1,
  mode text not null,
  day date not null,
  created_at timestamptz not null default now()
);
create index if not exists scores_mode_score on public.scores (mode, score desc);
create index if not exists scores_mode_day on public.scores (mode, day, score desc);
create index if not exists scores_user on public.scores (user_id, mode);

create table if not exists public.raids (
  id serial primary key,
  week text not null unique,
  name text not null,
  max_hp bigint not null,
  hp bigint not null,
  created_at timestamptz not null default now(),
  defeated_at timestamptz
);

create table if not exists public.raid_hits (
  raid_id int not null references public.raids on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  damage bigint not null default 0,
  last_hit_at timestamptz,
  claimed boolean not null default false,
  primary key (raid_id, user_id)
);

create table if not exists public.duels (
  code text primary key,
  seed bigint not null,
  pilot text not null,
  creator_id uuid not null references auth.users on delete cascade,
  creator_score int not null,
  creator_time int not null,
  creator_kills int not null,
  opponent_id uuid references auth.users on delete set null,
  opponent_score int,
  opponent_time int,
  opponent_kills int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------- access rules ----------
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.scores enable row level security;
alter table public.raids enable row level security;
alter table public.raid_hits enable row level security;
alter table public.duels enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own profile save" on public.profiles;

revoke all on public.profiles, public.runs, public.scores, public.raids, public.raid_hits, public.duels from anon, authenticated;
grant select (id, username, save_updated_at) on public.profiles to authenticated;

-- ---------- helpers ----------
create or replace function public.ns_me() returns uuid
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  return auth.uid();
end $$;

-- Score multiplier per sector; must match SECTORS[n].reward in the game.
create or replace function public.ns_sector_mult(s int) returns numeric
language sql immutable as $$
  select case s when 1 then 1.0 when 2 then 1.5 when 3 then 2.1 when 4 then 2.8 when 5 then 3.6 else 1.0 end::numeric
$$;

-- Loads a run ticket and checks it belongs to the caller, matches the mode, and lasted long enough.
-- Game time can run 1.25x faster than real time on one daily modifier.
create or replace function public.ns_run(p_run uuid, p_mode text, p_time int) returns public.runs
language plpgsql set search_path = public as $$
declare r public.runs;
begin
  select * into r from public.runs where id = p_run and user_id = public.ns_me() for update;
  if not found then raise exception 'Unknown run'; end if;
  if r.mode <> p_mode then raise exception 'That run was a different mode'; end if;
  if p_time < 1 or p_time > 3600 then raise exception 'Impossible run time'; end if;
  if extract(epoch from now() - r.started_at) < p_time / 1.3 - 5 then raise exception 'That run finished too fast'; end if;
  return r;
end $$;

-- ---------- accounts ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare wanted text := new.raw_user_meta_data ->> 'username';
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_]{3,16}$' then wanted := null; end if;
  begin
    insert into public.profiles (id, username) values (new.id, wanted) on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, username) values (new.id, null) on conflict (id) do nothing;
  end;
  perform private.user_key(new.id);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_name ~ '^[A-Za-z0-9_]{3,16}$' and not exists (select 1 from public.profiles where lower(username) = lower(p_name))
$$;

create or replace function public.claim_username(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_me();
begin
  if p_name !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Names are 3-16 letters, numbers or _'; end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_name) and id <> uid) then raise exception 'That name is taken'; end if;
  insert into public.profiles (id, username) values (uid, p_name) on conflict (id) do update set username = excluded.username;
  return p_name;
end $$;

-- ---------- encrypted cloud save ----------
create or replace function public.save_put(p_save jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_me(); t timestamptz := now();
begin
  if octet_length(p_save::text) > 300000 then raise exception 'Save is too large'; end if;
  update public.profiles
  set save_enc = extensions.pgp_sym_encrypt(p_save::text, private.user_key(uid), 'cipher-algo=aes256'), save_updated_at = t
  where id = uid;
  return t;
end $$;

create or replace function public.save_get() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_me(); p public.profiles; k text;
begin
  select * into p from public.profiles where id = uid;
  if not found or p.save_enc is null then return null; end if;
  select key into k from private.user_keys where user_id = uid;
  if k is null then return null; end if;
  return json_build_object('save', extensions.pgp_sym_decrypt(p.save_enc, k)::json, 'updatedAt', p.save_updated_at);
exception when others then
  return null;
end $$;

-- Deletes the account. The key goes first: after that, the encrypted save can never be decrypted,
-- even from a copy. Then everything else tied to the player is removed, and finally the login.
create or replace function public.delete_account() returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_me();
begin
  delete from private.user_keys where user_id = uid;
  update public.profiles set save_enc = null where id = uid;
  delete from public.duels where creator_id = uid;
  update public.duels set opponent_id = null where opponent_id = uid;
  delete from public.scores where user_id = uid;
  delete from public.raid_hits where user_id = uid;
  delete from public.runs where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
  return true;
end $$;

-- ---------- run tickets ----------
create or replace function public.start_run(p_mode text, p_sector int, p_seed bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_me();
  today date := (now() at time zone 'utc')::date;
  rid uuid;
begin
  if p_mode not in ('normal', 'daily', 'duel', 'coop') then raise exception 'Unknown mode'; end if;
  if p_sector < 1 or p_sector > 5 or (p_mode <> 'normal' and p_sector <> 1) then raise exception 'Unknown sector'; end if;
  if p_sector > 1 and not exists (
    select 1 from public.scores where user_id = uid and won and mode = 'normal' and sector >= p_sector - 1
  ) then raise exception 'Beat the Queen in the previous sector online first'; end if;
  if exists (select 1 from public.runs where user_id = uid and started_at > now() - interval '5 seconds') then
    raise exception 'Slow down a little';
  end if;
  if (select count(*) from public.runs where user_id = uid and started_at > now() - interval '1 day') >= 300 then
    raise exception 'Daily run limit reached';
  end if;
  if p_mode = 'daily' and exists (select 1 from public.runs where user_id = uid and mode = 'daily' and day = today) then
    raise exception 'You already played today''s daily run';
  end if;
  insert into public.runs (user_id, mode, sector, seed, day) values (uid, p_mode, p_sector, coalesce(p_seed, 0), today) returning id into rid;
  return rid;
end $$;

-- ---------- leaderboards ----------
-- 'all' and 'week' rank normal solo runs; 'daily' ranks the day's daily runs only.
create or replace function public.submit_score(
  p_run uuid, p_score int, p_time int, p_kills int, p_level int, p_pilot text, p_won boolean, p_sector int
) returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.runs;
  uid uuid := public.ns_me();
  mult numeric;
  expected int;
  better int;
begin
  select * into r from public.runs where id = p_run and user_id = uid;
  if not found then raise exception 'Unknown run'; end if;
  r := public.ns_run(p_run, r.mode, p_time);
  if r.used_score then raise exception 'That run was already submitted'; end if;
  if r.mode not in ('normal', 'daily') then raise exception 'Only solo runs go on the leaderboard'; end if;
  if p_sector <> r.sector then raise exception 'Sector mismatch'; end if;
  if not exists (select 1 from public.profiles where id = uid and username is not null) then raise exception 'Pick a name first'; end if;
  if p_kills < 0 or p_kills > p_time * 40 + 500 then raise exception 'Impossible kill count'; end if;
  if p_level < 1 or p_level > 1 + p_time / 5 then raise exception 'Impossible level'; end if;
  if p_won and p_time < 480 then raise exception 'Impossible win'; end if;
  mult := public.ns_sector_mult(r.sector);
  expected := floor((p_time * 10 + p_kills * 2 + p_level * 50 + case when p_won then 5000 else 0 end) * mult);
  if abs(p_score - expected) > 30 * mult then raise exception 'Score does not add up'; end if;
  insert into public.scores (user_id, run_id, score, time_s, kills, level, pilot, won, sector, mode, day)
  values (uid, r.id, p_score, p_time, p_kills, p_level, left(p_pilot, 16), p_won, r.sector, r.mode, r.day);
  update public.runs set used_score = true where id = r.id;
  select count(*) into better from (
    select user_id, max(score) as best from public.scores
    where mode = r.mode and (r.mode <> 'daily' or day = r.day) and user_id <> uid
    group by user_id
  ) t where t.best > p_score;
  return better + 1;
end $$;

create or replace function public.leaderboard(p_board text, p_day date, p_limit int)
returns table (rank bigint, username text, score int, time_s int, kills int, level int, pilot text, won boolean, sector int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (s.user_id) s.user_id, s.score, s.time_s, s.kills, s.level, s.pilot, s.won, s.sector, s.created_at
    from public.scores s
    where (p_board = 'all' and s.mode = 'normal')
       or (p_board = 'week' and s.mode = 'normal' and s.created_at >= date_trunc('week', now()))
       or (p_board = 'daily' and s.mode = 'daily' and s.day = coalesce(p_day, (now() at time zone 'utc')::date))
    order by s.user_id, s.score desc, s.created_at asc
  )
  select rank() over (order by b.score desc), coalesce(p.username, 'Pilot'), b.score, b.time_s, b.kills, b.level, b.pilot, b.won, b.sector,
         b.user_id = auth.uid()
  from best b left join public.profiles p on p.id = b.user_id
  order by b.score desc, b.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

create or replace function public.my_best(p_board text, p_day date) returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.ns_me(); mine int; better int; d date := coalesce(p_day, (now() at time zone 'utc')::date);
begin
  select max(score) into mine from public.scores
  where user_id = uid and ((p_board = 'all' and mode = 'normal')
     or (p_board = 'week' and mode = 'normal' and created_at >= date_trunc('week', now()))
     or (p_board = 'daily' and mode = 'daily' and day = d));
  if mine is null then return null; end if;
  select count(*) into better from (
    select user_id, max(score) as best from public.scores
    where user_id <> uid and ((p_board = 'all' and mode = 'normal')
       or (p_board = 'week' and mode = 'normal' and created_at >= date_trunc('week', now()))
       or (p_board = 'daily' and mode = 'daily' and day = d))
    group by user_id
  ) t where t.best > mine;
  return json_build_object('rank', better + 1, 'score', mine);
end $$;

-- ---------- weekly raid ----------
create or replace function public.current_raid() returns json
language plpgsql security definer set search_path = public as $$
declare
  wk text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  prev text := to_char((now() at time zone 'utc') - interval '7 days', 'IYYY-"W"IW');
  names text[] := array['Omega Hive', 'The Devourer', 'Null Leviathan', 'Crimson Matriarch', 'Void Colossus', 'Star Eater', 'The Abyssal Eye', 'Neon Wyrm'];
  r public.raids;
  n int;
  new_hp bigint;
  my_dmg bigint := 0;
  my_claimed boolean := false;
  top json;
begin
  select * into r from public.raids where week = wk;
  if not found then
    select count(*) into n from public.raid_hits h join public.raids x on x.id = h.raid_id where x.week = prev;
    new_hp := greatest(1500000, 900000 * n);
    insert into public.raids (week, name, max_hp, hp) values (wk, names[1 + (hashtext(wk) & 2147483647) % array_length(names, 1)], new_hp, new_hp)
    on conflict (week) do nothing;
    select * into r from public.raids where week = wk;
  end if;
  if auth.uid() is not null then
    select h.damage, h.claimed into my_dmg, my_claimed from public.raid_hits h where h.raid_id = r.id and h.user_id = auth.uid();
  end if;
  select count(*) into n from public.raid_hits where raid_id = r.id;
  select coalesce(json_agg(t), '[]'::json) into top from (
    select coalesce(p.username, 'Pilot') as username, h.damage from public.raid_hits h
    left join public.profiles p on p.id = h.user_id where h.raid_id = r.id order by h.damage desc limit 5
  ) t;
  return json_build_object('id', r.id, 'week', r.week, 'name', r.name, 'maxHp', r.max_hp, 'hp', r.hp,
    'defeated', r.defeated_at is not null, 'myDamage', coalesce(my_dmg, 0), 'contributors', n, 'claimed', coalesce(my_claimed, false), 'top', top);
end $$;

create or replace function public.raid_hit(p_run uuid, p_damage bigint, p_time int) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_me();
  r public.runs;
  rd public.raids;
  dmg bigint;
  elapsed numeric;
begin
  select * into r from public.runs where id = p_run and user_id = uid;
  if not found then raise exception 'Unknown run'; end if;
  r := public.ns_run(p_run, r.mode, p_time);
  if r.used_raid then raise exception 'That run already hit the raid'; end if;
  if r.mode = 'duel' then raise exception 'Duels do not count for the raid'; end if;
  perform public.current_raid();
  select * into rd from public.raids where week = to_char(now() at time zone 'utc', 'IYYY-"W"IW') for update;
  elapsed := extract(epoch from now() - r.started_at);
  dmg := least(greatest(p_damage, 0), 400000, floor(elapsed * 1200)::bigint);
  update public.runs set used_raid = true where id = r.id;
  if rd.defeated_at is not null or dmg = 0 then
    return json_build_object('hp', rd.hp, 'defeated', rd.defeated_at is not null, 'damage', 0);
  end if;
  update public.raids set hp = greatest(0, hp - dmg), defeated_at = case when hp - dmg <= 0 then now() else null end
  where id = rd.id returning * into rd;
  insert into public.raid_hits (raid_id, user_id, damage, last_hit_at) values (rd.id, uid, dmg, now())
  on conflict (raid_id, user_id) do update set damage = public.raid_hits.damage + excluded.damage, last_hit_at = now();
  return json_build_object('hp', rd.hp, 'defeated', rd.defeated_at is not null, 'damage', dmg);
end $$;

create or replace function public.raid_claim(p_raid int) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_me();
  rd public.raids;
  h public.raid_hits;
  top3 boolean;
begin
  select * into rd from public.raids where id = p_raid;
  if not found or rd.defeated_at is null then raise exception 'The raid boss is still alive'; end if;
  select * into h from public.raid_hits where raid_id = p_raid and user_id = uid for update;
  if not found or h.damage <= 0 then raise exception 'You did not fight this raid'; end if;
  if h.claimed then raise exception 'Reward already claimed'; end if;
  update public.raid_hits set claimed = true where raid_id = p_raid and user_id = uid;
  select uid in (select user_id from public.raid_hits where raid_id = p_raid order by damage desc limit 3) into top3;
  return json_build_object('gems', 60 + case when top3 then 40 else 0 end, 'eggs', 1);
end $$;

-- ---------- duels ----------
create or replace function public.ns_duel_json(d public.duels) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', d.code, 'seed', d.seed, 'pilot', d.pilot,
    'creatorName', (select coalesce(username, 'Pilot') from public.profiles where id = d.creator_id),
    'creatorScore', d.creator_score, 'creatorTime', d.creator_time, 'creatorKills', d.creator_kills,
    'opponentName', (select username from public.profiles where id = d.opponent_id),
    'opponentScore', d.opponent_score, 'opponentTime', d.opponent_time, 'opponentKills', d.opponent_kills,
    'isCreator', d.creator_id = auth.uid(), 'done', d.completed_at is not null)
$$;

create or replace function public.duel_create(p_run uuid, p_pilot text, p_score int, p_time int, p_kills int) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_me();
  r public.runs := public.ns_run(p_run, 'duel', p_time);
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if r.used_duel then raise exception 'That run already made a duel'; end if;
  if p_kills < 0 or p_kills > p_time * 40 + 500 then raise exception 'Impossible kill count'; end if;
  if p_score > p_time * 12 + p_kills * 3 + 8000 then raise exception 'Score does not add up'; end if;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.duels where code = c);
  end loop;
  insert into public.duels (code, seed, pilot, creator_id, creator_score, creator_time, creator_kills)
  values (c, r.seed, left(p_pilot, 16), uid, p_score, p_time, p_kills);
  update public.runs set used_duel = true where id = r.id;
  return c;
end $$;

create or replace function public.duel_get(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare d public.duels;
begin
  select * into d from public.duels where code = upper(p_code);
  if not found then return null; end if;
  return public.ns_duel_json(d);
end $$;

create or replace function public.duel_submit(p_run uuid, p_code text, p_score int, p_time int, p_kills int) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_me();
  r public.runs := public.ns_run(p_run, 'duel', p_time);
  d public.duels;
begin
  select * into d from public.duels where code = upper(p_code) for update;
  if not found then raise exception 'No duel with that code'; end if;
  if d.creator_id = uid then raise exception 'You cannot duel yourself'; end if;
  if d.opponent_id is not null then raise exception 'That duel is already finished'; end if;
  if r.seed <> d.seed then raise exception 'That run used a different seed'; end if;
  if r.used_duel then raise exception 'That run was already used'; end if;
  if p_kills < 0 or p_kills > p_time * 40 + 500 then raise exception 'Impossible kill count'; end if;
  if p_score > p_time * 12 + p_kills * 3 + 8000 then raise exception 'Score does not add up'; end if;
  update public.duels set opponent_id = uid, opponent_score = p_score, opponent_time = p_time, opponent_kills = p_kills, completed_at = now()
  where code = d.code;
  update public.runs set used_duel = true where id = r.id;
  return json_build_object('won', p_score > d.creator_score);
end $$;

create or replace function public.my_duels() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(t.j), '[]'::json) from (
    select public.ns_duel_json(d) as j from public.duels d
    where d.creator_id = auth.uid() or d.opponent_id = auth.uid() order by d.created_at desc limit 20
  ) t
$$;

-- ---------- who may call what ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.username_available(text), public.leaderboard(text, date, int), public.current_raid(), public.duel_get(text) to anon, authenticated;
grant execute on function
  public.save_put(jsonb), public.save_get(), public.delete_account(),
  public.claim_username(text), public.start_run(text, int, bigint),
  public.submit_score(uuid, int, int, int, int, text, boolean, int), public.my_best(text, date),
  public.raid_hit(uuid, bigint, int), public.raid_claim(int),
  public.duel_create(uuid, text, int, int, int), public.duel_submit(uuid, text, int, int, int), public.my_duels()
  to authenticated;
