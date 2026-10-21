-- Neon Swarm online database.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run again after updates: it only creates or replaces things.
--
-- Security model: the game in the browser is never trusted. Players can only read their own profile
-- row. Everything else (saves, scores, raid, duels) goes through the functions below, which check a
-- server-issued run ticket and reject impossible results.
--
-- Anti-cheat: runs report checkpoints every 30 seconds; scores must match them and stay under hard
-- caps derived from the game's own spawn rates. Suspicious-but-possible scores are hidden until an
-- admin reviews them. Banned players cannot start, post or duel.
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

alter table public.runs add column if not exists tamper text;
alter table public.scores add column if not exists flagged boolean not null default false;
alter table public.scores add column if not exists flag_reason text;

create table if not exists public.run_checkpoints (
  run_id uuid not null references public.runs on delete cascade,
  seq int not null,
  at timestamptz not null default now(),
  t int not null,
  kills int not null,
  level int not null,
  primary key (run_id, seq)
);

create table if not exists public.bans (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  reason text,
  banned_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  until timestamptz,
  lifted_at timestamptz
);
create index if not exists bans_user on public.bans (user_id);

-- Weekly leagues: groups of up to 20 in the same tier; points come from posted scores.
alter table public.profiles add column if not exists league_tier int not null default 1;
create table if not exists public.league_members (
  week date not null,
  user_id uuid not null references auth.users on delete cascade,
  tier int not null,
  grp int not null,
  pts int not null default 0,
  runs int not null default 0,
  primary key (week, user_id)
);
create index if not exists league_members_group on public.league_members (week, tier, grp);
create table if not exists public.league_results (
  week date not null,
  user_id uuid not null references auth.users on delete cascade,
  tier_from int not null,
  tier_to int not null,
  rank int not null,
  size int not null,
  gems int not null,
  claimed boolean not null default false,
  primary key (week, user_id)
);

create table if not exists private.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.admins enable row level security;
revoke all on private.admins from public, anon, authenticated;

-- ---------- access rules ----------
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.scores enable row level security;
alter table public.raids enable row level security;
alter table public.raid_hits enable row level security;
alter table public.duels enable row level security;
alter table public.run_checkpoints enable row level security;
alter table public.bans enable row level security;
alter table public.league_members enable row level security;
alter table public.league_results enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own profile save" on public.profiles;

revoke all on public.profiles, public.runs, public.scores, public.raids, public.raid_hits, public.duels, public.run_checkpoints, public.bans, public.league_members, public.league_results from anon, authenticated;
grant select (id, username, save_updated_at) on public.profiles to authenticated;

-- ---------- helpers ----------
create or replace function public.ns_me() returns uuid
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  return auth.uid();
end $$;

-- Names are unique (ignoring capitals, so MINESCON can't copy Minescon; Min3scon is a different name).
create or replace function public.ns_name_ok(n text) returns boolean
language sql immutable as $$
  select n ~ '^[A-Za-z0-9_]{3,16}$'
     and lower(n) not in ('admin', 'administrator', 'moderator', 'staff', 'support', 'system', 'neonswarm', 'null', 'undefined')
$$;

create or replace function public.ns_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from private.admins where user_id = auth.uid())
$$;

create or replace function public.ns_active_ban(uid uuid) returns public.bans
language sql stable security definer set search_path = public as $$
  select * from public.bans where user_id = uid and lifted_at is null and (until is null or until > now())
  order by coalesce(until, 'infinity'::timestamptz) desc limit 1
$$;

-- Like ns_me(), but refuses banned players. Used by everything that affects other players.
create or replace function public.ns_play() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.ns_me(); b public.bans;
begin
  b := public.ns_active_ban(uid);
  if b.id is not null then
    if b.until is null then raise exception 'You are banned permanently%', coalesce(': ' || b.reason, '');
    else raise exception 'You are banned until % UTC%', to_char(b.until at time zone 'utc', 'YYYY-MM-DD HH24:MI'), coalesce(': ' || b.reason, '');
    end if;
  end if;
  return uid;
end $$;

-- Most enemies the game can spawn by game time t (seconds), with generous headroom. Mirrors the
-- director in game.js: 2 + 18*(t/480)^1.5 spawns/s, ~300 event enemies, splitter shards, then the
-- Queen fight. Daily runs can have 60% more enemies.
create or replace function public.ns_max_kills(p_t int, p_mode text) returns int
language sql immutable as $$
  select ceil(((2 * least(p_t, 480) + 3456 * power(least(p_t, 480) / 480.0, 2.5) + 8 * greatest(p_t - 480, 0)) + 300)
    * case when p_mode = 'daily' then 1.6 else 1.0 end * 1.6)::int
$$;

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
  if wanted is null or not public.ns_name_ok(wanted)
     or exists (select 1 from public.profiles where lower(username) = lower(wanted)) then
    wanted := null;
  end if;
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
  select public.ns_name_ok(p_name) and not exists (select 1 from public.profiles where lower(username) = lower(p_name))
$$;

create or replace function public.claim_username(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_play();
begin
  if p_name !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Names are 3-16 letters, numbers or _'; end if;
  if not public.ns_name_ok(p_name) then raise exception 'That name is reserved'; end if;
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
  uid uuid := public.ns_play();
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

-- ---------- checkpoints ----------
-- The game reports progress every 30 seconds of play. Each report must move forward, keep pace with
-- real time and stay under the hard caps.
create or replace function public.run_checkpoint(p_run uuid, p_seq int, p_t int, p_kills int, p_level int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.ns_play();
  r public.runs;
  prev public.run_checkpoints;
  elapsed numeric;
begin
  select * into r from public.runs where id = p_run and user_id = uid;
  if not found then raise exception 'Unknown run'; end if;
  if r.used_score then raise exception 'That run is already finished'; end if;
  select * into prev from public.run_checkpoints where run_id = p_run order by seq desc limit 1;
  if p_seq <> coalesce(prev.seq, 0) + 1 then raise exception 'Checkpoint out of order'; end if;
  if prev.at is not null and now() - prev.at < interval '15 seconds' then raise exception 'Checkpoints too fast'; end if;
  elapsed := extract(epoch from now() - r.started_at);
  if p_t > elapsed * 1.3 + 5 then raise exception 'Game clock is ahead of real time'; end if;
  if p_t < coalesce(prev.t, 0) or p_kills < coalesce(prev.kills, 0) or p_level < coalesce(prev.level, 1) then
    raise exception 'Checkpoint went backwards';
  end if;
  if p_kills > public.ns_max_kills(p_t, r.mode) then raise exception 'Impossible kill count'; end if;
  if p_level > 10 + p_t / 10 then raise exception 'Impossible level'; end if;
  insert into public.run_checkpoints (run_id, seq, t, kills, level) values (p_run, p_seq, p_t, p_kills, p_level);
  return true;
end $$;

-- ---------- weekly leagues ----------
create or replace function public.ns_week(t timestamptz default now()) returns date
language sql stable as $$ select date_trunc('week', t at time zone 'utc')::date $$;

-- Settles every finished week the player took part in: rank in their group, promotion or demotion,
-- and a gem reward to claim. Runs lazily, so no scheduled job is needed.
create or replace function public.ns_league_settle(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare wk date := public.ns_week(); m public.league_members; r int; n int; t int; gems int;
begin
  for m in select * from public.league_members lm where lm.user_id = uid and lm.week < wk
      and not exists (select 1 from public.league_results x where x.week = lm.week and x.user_id = uid) order by lm.week loop
    select count(*) into n from public.league_members where week = m.week and tier = m.tier and grp = m.grp;
    select count(*) + 1 into r from public.league_members
      where week = m.week and tier = m.tier and grp = m.grp and (pts > m.pts or (pts = m.pts and user_id < m.user_id));
    t := m.tier;
    if n >= 3 and r <= 5 and r <= ceil(n / 2.0) and m.tier < 7 then t := m.tier + 1;
    elsif n >= 8 and r > n - 3 and m.tier > 1 then t := m.tier - 1;
    end if;
    gems := case when r = 1 then 60 when r = 2 then 45 when r = 3 then 35 when r <= 5 then 20 when r <= 10 then 10 else 5 end + (m.tier - 1) * 5;
    insert into public.league_results (week, user_id, tier_from, tier_to, rank, size, gems)
    values (m.week, uid, m.tier, t, r, n, gems) on conflict do nothing;
    update public.profiles set league_tier = t where id = uid;
  end loop;
end $$;

-- Points for a posted score. The first score of the week puts the player in a group of their tier.
create or replace function public.ns_league_add(uid uuid, p_score int) returns void
language plpgsql security definer set search_path = public as $$
declare wk date := public.ns_week(); m public.league_members; t int; g int;
begin
  perform public.ns_league_settle(uid);
  select * into m from public.league_members where week = wk and user_id = uid;
  if not found then
    select league_tier into t from public.profiles where id = uid;
    t := coalesce(t, 1);
    perform pg_advisory_xact_lock(hashtext('ns-league-' || wk || '-' || t));
    select grp into g from public.league_members where week = wk and tier = t group by grp having count(*) < 20 order by grp limit 1;
    if g is null then select coalesce(max(grp), 0) + 1 into g from public.league_members where week = wk and tier = t; end if;
    insert into public.league_members (week, user_id, tier, grp) values (wk, uid, t, g) returning * into m;
  end if;
  -- Square-rooted scores reward skill over hours played; at most 60 runs a week count.
  if m.runs < 60 then
    update public.league_members set pts = pts + floor(sqrt(greatest(p_score, 0)))::int, runs = runs + 1 where week = wk and user_id = uid;
  end if;
end $$;

create or replace function public.league_status() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_me(); wk date := public.ns_week(); m public.league_members; t int; last public.league_results;
begin
  perform public.ns_league_settle(uid);
  select * into m from public.league_members where week = wk and user_id = uid;
  select league_tier into t from public.profiles where id = uid;
  select * into last from public.league_results where user_id = uid and not claimed order by week desc limit 1;
  return json_build_object(
    'week', wk, 'ends', (wk + 7)::timestamp at time zone 'utc', 'tier', coalesce(m.tier, t, 1), 'joined', m.user_id is not null, 'pts', coalesce(m.pts, 0),
    'group', case when m.user_id is null then '[]'::json else coalesce((select json_agg(x) from (
        select coalesce(p.username, 'Pilot') as username, lm.pts, lm.user_id = uid as me
        from public.league_members lm left join public.profiles p on p.id = lm.user_id
        where lm.week = wk and lm.tier = m.tier and lm.grp = m.grp and (public.ns_active_ban(lm.user_id)).id is null
        order by lm.pts desc, lm.user_id) x), '[]'::json) end,
    'result', case when last.user_id is null then null else json_build_object('week', last.week, 'from', last.tier_from, 'to', last.tier_to,
      'rank', last.rank, 'size', last.size, 'gems', last.gems) end);
end $$;

create or replace function public.league_claim(p_week date) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.ns_play(); g int;
begin
  update public.league_results set claimed = true where week = p_week and user_id = uid and not claimed returning gems into g;
  if g is null then raise exception 'Nothing to claim'; end if;
  return g;
end $$;

-- The game reports runs that failed its own checks (edited values, sped-up clock, developer tools).
-- The run can no longer be posted, and admins see the report on the player's page.
create or replace function public.report_run(p_run uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.runs set tamper = coalesce(nullif(left(trim(p_reason), 100), ''), 'unknown'), used_score = true
  where id = p_run and user_id = public.ns_me() and tamper is null;
  return true;
end $$;

-- ---------- leaderboards ----------
-- 'all' and 'week' rank normal solo runs; 'daily' ranks the day's daily runs only.
-- Flagged scores and banned players never appear.
drop function if exists public.submit_score(uuid, int, int, int, int, text, boolean, int);
create or replace function public.submit_score(
  p_run uuid, p_score int, p_time int, p_kills int, p_level int, p_pilot text, p_won boolean, p_sector int
) returns json
language plpgsql security definer set search_path = public as $$
declare
  r public.runs;
  uid uuid := public.ns_play();
  mult numeric;
  expected int;
  better int;
  cp_n int; cp_t int; cp_k int; cp_l int;
  need int;
  cap int;
  elapsed numeric;
  why text := null;
begin
  select * into r from public.runs where id = p_run and user_id = uid;
  if not found then raise exception 'Unknown run'; end if;
  r := public.ns_run(p_run, r.mode, p_time);
  if r.used_score then raise exception 'That run was already submitted'; end if;
  if r.mode not in ('normal', 'daily') then raise exception 'Only solo runs go on the leaderboard'; end if;
  if p_sector <> r.sector then raise exception 'Sector mismatch'; end if;
  if not exists (select 1 from public.profiles where id = uid and username is not null) then raise exception 'Pick a name first'; end if;
  cap := public.ns_max_kills(p_time, r.mode);
  if p_kills < 0 or p_kills > cap then raise exception 'Impossible kill count'; end if;
  if p_level < 1 or p_level > 10 + p_time / 10 then raise exception 'Impossible level'; end if;
  if p_won and p_time < 485 then raise exception 'Impossible win'; end if;
  mult := public.ns_sector_mult(r.sector);
  expected := floor((p_time * 10 + p_kills * 2 + p_level * 50 + case when p_won then 5000 else 0 end) * mult);
  if abs(p_score - expected) > 30 * mult then raise exception 'Score does not add up'; end if;
  -- The run has to match what it reported along the way.
  select count(*), max(t), max(kills), max(level) into cp_n, cp_t, cp_k, cp_l from public.run_checkpoints where run_id = r.id;
  need := greatest(0, floor(p_time / 30.0)::int - 2);
  if cp_n < floor(need * 0.5) then raise exception 'This run could not be verified'; end if;
  if cp_n > 0 and (p_time < cp_t or p_kills < cp_k or p_level < cp_l) then raise exception 'Run does not match its checkpoints'; end if;
  if cp_n > 0 and p_kills - cp_k > public.ns_max_kills(p_time, r.mode) - public.ns_max_kills(cp_t, r.mode) + 250 then
    raise exception 'Impossible kills since the last checkpoint';
  end if;
  elapsed := extract(epoch from now() - r.started_at);
  if cp_n < need then why := 'missing checkpoints';
  elsif p_kills > cap * 0.9 then why := 'very high kill count';
  elsif r.mode <> 'daily' and elapsed < p_time / 1.1 then why := 'game ran faster than real time';
  end if;
  insert into public.scores (user_id, run_id, score, time_s, kills, level, pilot, won, sector, mode, day, flagged, flag_reason)
  values (uid, r.id, p_score, p_time, p_kills, p_level, left(p_pilot, 16), p_won, r.sector, r.mode, r.day, why is not null, why);
  update public.runs set used_score = true where id = r.id;
  if why is null then perform public.ns_league_add(uid, p_score); end if;
  select count(*) into better from (
    select user_id, max(score) as best from public.scores
    where mode = r.mode and (r.mode <> 'daily' or day = r.day) and user_id <> uid and not flagged
    group by user_id
  ) t where t.best > p_score;
  return json_build_object('rank', better + 1, 'flagged', why is not null);
end $$;

create or replace function public.leaderboard(p_board text, p_day date, p_limit int)
returns table (rank bigint, username text, score int, time_s int, kills int, level int, pilot text, won boolean, sector int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (s.user_id) s.user_id, s.score, s.time_s, s.kills, s.level, s.pilot, s.won, s.sector, s.created_at
    from public.scores s
    where not s.flagged and (public.ns_active_ban(s.user_id)).id is null
      and ((p_board = 'all' and s.mode = 'normal')
       or (p_board = 'week' and s.mode = 'normal' and s.created_at >= date_trunc('week', now()))
       or (p_board = 'daily' and s.mode = 'daily' and s.day = coalesce(p_day, (now() at time zone 'utc')::date)))
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
  where user_id = uid and not flagged and ((p_board = 'all' and mode = 'normal')
     or (p_board = 'week' and mode = 'normal' and created_at >= date_trunc('week', now()))
     or (p_board = 'daily' and mode = 'daily' and day = d));
  if mine is null then return null; end if;
  select count(*) into better from (
    select user_id, max(score) as best from public.scores
    where user_id <> uid and not flagged and ((p_board = 'all' and mode = 'normal')
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
  uid uuid := public.ns_play();
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
  uid uuid := public.ns_play();
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
  uid uuid := public.ns_play();
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
  uid uuid := public.ns_play();
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

-- ---------- player status ----------
create or replace function public.my_status() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.ns_me(); b public.bans := public.ns_active_ban(uid);
begin
  return json_build_object('admin', public.ns_is_admin(),
    'ban', case when b.id is null then null else json_build_object('until', b.until, 'reason', b.reason) end);
end $$;

-- ---------- admin ----------
create or replace function public.ns_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ns_is_admin() then raise exception 'Admins only'; end if;
  return auth.uid();
end $$;

create or replace function public.ns_player_json(uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', p.id, 'username', p.username, 'joined', p.created_at,
    'best', (select max(score) from public.scores where user_id = p.id and not flagged),
    'runs', (select count(*) from public.runs where user_id = p.id),
    'flagged', (select count(*) from public.scores where user_id = p.id and flagged),
    'tamper', (select count(*) from public.runs where user_id = p.id and tamper is not null),
    'admin', exists (select 1 from private.admins a where a.user_id = p.id),
    'ban', (select json_build_object('until', b.until, 'reason', b.reason) from public.bans b
            where b.user_id = p.id and b.lifted_at is null and (b.until is null or b.until > now())
            order by coalesce(b.until, 'infinity'::timestamptz) desc limit 1))
  from public.profiles p where p.id = uid
$$;

create or replace function public.admin_find(p_query text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_admin();
  return coalesce((select json_agg(public.ns_player_json(p.id) order by p.username)
    from (select id, username from public.profiles
          where username is not null and (coalesce(p_query, '') = '' or username ilike '%' || p_query || '%')
          order by username limit 30) p), '[]'::json);
end $$;

create or replace function public.admin_player(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_admin();
  return json_build_object(
    'player', public.ns_player_json(p_user),
    'scores', coalesce((select json_agg(t) from (
      select id, score, time_s, kills, level, mode, sector, won, flagged, flag_reason, created_at from public.scores
      where user_id = p_user order by created_at desc limit 20) t), '[]'::json),
    'tamper', coalesce((select json_agg(t) from (
      select started_at, mode, tamper from public.runs where user_id = p_user and tamper is not null
      order by started_at desc limit 10) t), '[]'::json),
    'bans', coalesce((select json_agg(t) from (
      select b.created_at, b.until, b.reason, b.lifted_at, coalesce(p.username, 'Admin') as by_name from public.bans b
      left join public.profiles p on p.id = b.banned_by where b.user_id = p_user order by b.created_at desc limit 20) t), '[]'::json));
end $$;

-- p_minutes null = permanent.
create or replace function public.admin_ban(p_user uuid, p_minutes int, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := public.ns_admin(); b public.bans;
begin
  if p_user = me then raise exception 'You cannot ban yourself'; end if;
  if exists (select 1 from private.admins where user_id = p_user) then raise exception 'Admins cannot be banned'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'No such player'; end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 5256000) then raise exception 'Ban length must be between 1 minute and 10 years'; end if;
  update public.bans set lifted_at = now() where user_id = p_user and lifted_at is null;
  insert into public.bans (user_id, reason, banned_by, until)
  values (p_user, nullif(left(trim(p_reason), 200), ''), me, case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end)
  returning * into b;
  return json_build_object('until', b.until, 'reason', b.reason);
end $$;

create or replace function public.admin_unban(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.ns_admin();
  update public.bans set lifted_at = now() where user_id = p_user and lifted_at is null;
  return true;
end $$;

create or replace function public.admin_flagged() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_admin();
  return coalesce((select json_agg(t) from (
    select s.id, s.user_id, coalesce(p.username, 'Pilot') as username, s.score, s.time_s, s.kills, s.level, s.mode, s.sector,
           s.flag_reason, s.created_at
    from public.scores s left join public.profiles p on p.id = s.user_id
    where s.flagged order by s.created_at desc limit 50) t), '[]'::json);
end $$;

-- Players with flagged scores or tamper reports, most suspicious first.
create or replace function public.admin_suspects() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_admin();
  return coalesce((select json_agg(public.ns_player_json(x.id) order by x.n desc) from (
    select id, n from (
      select p.id, (select count(*) from public.scores s where s.user_id = p.id and s.flagged)
                 + (select count(*) from public.runs r where r.user_id = p.id and r.tamper is not null) as n
      from public.profiles p) c
    where n > 0 order by n desc limit 30) x), '[]'::json);
end $$;

-- Approve a flagged score (shows on the leaderboard) or remove it.
create or replace function public.admin_review(p_score bigint, p_ok boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare sc public.scores;
begin
  perform public.ns_admin();
  if p_ok then
    update public.scores set flagged = false, flag_reason = 'approved' where id = p_score and flagged returning * into sc;
    if sc.id is not null and public.ns_week(sc.created_at) = public.ns_week() then perform public.ns_league_add(sc.user_id, sc.score); end if;
  else delete from public.scores where id = p_score;
  end if;
  return true;
end $$;

create or replace function public.admin_delete_scores(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.ns_admin();
  delete from public.scores where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

-- Run in the SQL editor to make someone an admin: select private.grant_admin('TheirName');
create or replace function private.grant_admin(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select id into uid from public.profiles where username = p_name;
  if uid is null then return 'No player named ' || p_name || '. Sign up with that name first, then run this again.'; end if;
  insert into private.admins (user_id) values (uid) on conflict do nothing;
  return p_name || ' is now an admin';
end $$;
revoke all on function private.grant_admin(text) from public, anon, authenticated;

-- ---------- who may call what ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.username_available(text), public.leaderboard(text, date, int), public.current_raid(), public.duel_get(text) to anon, authenticated;
grant execute on function
  public.save_put(jsonb), public.save_get(), public.delete_account(), public.my_status(),
  public.run_checkpoint(uuid, int, int, int, int), public.report_run(uuid, text), public.admin_suspects(),
  public.league_status(), public.league_claim(date),
  public.admin_find(text), public.admin_player(uuid), public.admin_ban(uuid, int, text), public.admin_unban(uuid),
  public.admin_flagged(), public.admin_review(bigint, boolean), public.admin_delete_scores(uuid),
  public.claim_username(text), public.start_run(text, int, bigint),
  public.submit_score(uuid, int, int, int, int, text, boolean, int), public.my_best(text, date),
  public.raid_hit(uuid, bigint, int), public.raid_claim(int),
  public.duel_create(uuid, text, int, int, int), public.duel_submit(uuid, text, int, int, int), public.my_duels()
  to authenticated;

-- ---------- admin ----------
-- The account named exactly Minescon is the game's admin.
select private.grant_admin('Minescon');
