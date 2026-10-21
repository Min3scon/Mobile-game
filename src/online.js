'use strict';
/* Neon Swarm — online layer: accounts, cloud save, leaderboards, raid, duels and live rooms.
   One API, two drivers: Supabase (production, configured in config.js) and a local mock
   (?backend=mock, localhost only) that enforces the same rules for testing. Never throws. */

const Online = (() => {
  const TIMEOUT = 8000;
  const authCbs = [], recoveryCbs = [];
  let mode = 'off', user = null, drv = null, status = 'no-config';

  const utcDay = () => new Date().toISOString().slice(0, 10);
  const rid = () => Math.random().toString(36).slice(2, 10);
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setUser(u) {
    const same = JSON.stringify(u) === JSON.stringify(user);
    user = u;
    if (!same) for (const cb of authCbs.slice()) { try { cb(user); } catch (e) { /* keep others running */ } }
  }

  function withTimeout(p) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))]);
  }

  function friendly(msg) {
    msg = String(msg || '');
    if (/timeout|Failed to fetch|NetworkError|network/i.test(msg)) return 'Could not reach the server. Check your connection.';
    if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/already registered|already been registered/i.test(msg)) return 'That email already has an account. Log in instead.';
    if (/rate limit/i.test(msg)) return 'Too many tries. Wait a few minutes and try again.';
    if (/Email not confirmed/i.test(msg)) return 'Confirm your email first, then log in.';
    if (/Password should be/i.test(msg)) return 'Pick a longer password (at least 6 characters).';
    if (/permission denied|JWT|not authorized/i.test(msg)) return 'Log in again to continue.';
    return msg.length < 120 ? msg : 'Something went wrong. Try again.';
  }

  function validSignup(email, password, username) {
    if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
    if (!password || password.length < 6) return 'Passwords need at least 6 characters.';
    if (!NAME_RE.test(username || '')) return 'Names are 3-16 letters, numbers or _.';
    return null;
  }

  // ---------- Supabase driver ----------
  function supabaseDriver(cfg) {
    let client = null;

    function loadLib() {
      if (window.supabase && window.supabase.createClient) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/supabase.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    async function rpc(name, args) {
      try {
        const { data, error } = await withTimeout(client.rpc(name, args || {}));
        if (error) return { ok: false, error: friendly(error.message) };
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: friendly(e.message) };
      }
    }

    async function applySession(session) {
      if (!session || !session.user) { setUser(null); return; }
      const u = session.user;
      let username = null;
      try {
        const { data } = await withTimeout(client.from('profiles').select('username').eq('id', u.id).maybeSingle());
        username = data ? data.username : null;
      } catch (e) { username = user && user.id === u.id ? user.username : null; }
      setUser({ id: u.id, email: u.email || '', username });
    }

    return {
      async init() {
        await loadLib();
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'neon-swarm-auth' },
          realtime: { params: { eventsPerSecond: 40 } },
        });
        client.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') setTimeout(() => recoveryCbs.forEach((cb) => cb()), 0);
          // Supabase deadlocks if its own calls run inside this callback, so defer.
          setTimeout(() => applySession(session), 0);
        });
        const { data } = await withTimeout(client.auth.getSession());
        await applySession(data && data.session);
      },
      async signUp(email, password, username) {
        const bad = validSignup(email, password, username);
        if (bad) return { ok: false, error: bad };
        const free = await rpc('username_available', { p_name: username });
        if (free.ok && free.data === false) return { ok: false, error: 'That name is taken.' };
        try {
          const { data, error } = await withTimeout(client.auth.signUp({
            email, password, options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
          }));
          if (error) return { ok: false, error: friendly(error.message) };
          if (!data.session) return { ok: true, needsConfirm: true };
          await applySession(data.session);
          if (user && !user.username) await this.setUsername(username);
          return { ok: true };
        } catch (e) { return { ok: false, error: friendly(e.message) }; }
      },
      async signIn(email, password) {
        if (!EMAIL_RE.test(email) || !password) return { ok: false, error: 'Enter your email and password.' };
        try {
          const { data, error } = await withTimeout(client.auth.signInWithPassword({ email, password }));
          if (error) return { ok: false, error: friendly(error.message) };
          await applySession(data.session);
          return { ok: true };
        } catch (e) { return { ok: false, error: friendly(e.message) }; }
      },
      async signOut() {
        try { await withTimeout(client.auth.signOut()); } catch (e) { /* local sign-out still happens */ }
        setUser(null);
        return { ok: true };
      },
      async resetPassword(email) {
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
        try {
          const { error } = await withTimeout(client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
          return error ? { ok: false, error: friendly(error.message) } : { ok: true };
        } catch (e) { return { ok: false, error: friendly(e.message) }; }
      },
      async updatePassword(password) {
        if (!password || password.length < 6) return { ok: false, error: 'Passwords need at least 6 characters.' };
        try {
          const { error } = await withTimeout(client.auth.updateUser({ password }));
          return error ? { ok: false, error: friendly(error.message) } : { ok: true };
        } catch (e) { return { ok: false, error: friendly(e.message) }; }
      },
      async setUsername(name) {
        if (!NAME_RE.test(name || '')) return { ok: false, error: 'Names are 3-16 letters, numbers or _.' };
        const res = await rpc('claim_username', { p_name: name });
        if (res.ok) setUser(Object.assign({}, user, { username: name }));
        return res.ok ? { ok: true } : res;
      },
      // The server encrypts saves with a per-player key; see save_put/save_get in schema.sql.
      async loadSave() {
        if (!user) return null;
        const res = await rpc('save_get');
        return res.ok && res.data && res.data.save ? { data: res.data.save, updatedAt: res.data.updatedAt } : null;
      },
      async pushSave(save) {
        if (!user) return { ok: false, error: 'Log in first' };
        const res = await rpc('save_put', { p_save: save });
        return res.ok ? { ok: true } : res;
      },
      async deleteAccount() {
        if (!user) return { ok: false, error: 'Log in first' };
        const res = await rpc('delete_account');
        if (!res.ok) return res;
        try { await client.auth.signOut(); } catch (e) { /* the login no longer exists */ }
        setUser(null);
        return { ok: true };
      },
      async startRun(o) {
        const res = await rpc('start_run', { p_mode: o.mode, p_sector: o.sector || 1, p_seed: o.seed || 0 });
        return res.ok ? { ok: true, runId: res.data } : res;
      },
      async submitScore(r) {
        const res = await rpc('submit_score', {
          p_run: r.runId, p_score: r.score, p_time: r.time, p_kills: r.kills, p_level: r.level, p_pilot: r.pilot, p_won: !!r.won, p_sector: r.sector || 1,
        });
        return res.ok ? { ok: true, rank: res.data } : res;
      },
      async leaderboard(o) {
        const res = await rpc('leaderboard', { p_board: o.board, p_day: o.day || utcDay(), p_limit: o.limit || 50 });
        if (!res.ok || !Array.isArray(res.data)) return [];
        return res.data.map((r) => ({ rank: Number(r.rank), username: r.username, score: r.score, time: r.time_s, kills: r.kills, level: r.level, pilot: r.pilot, won: r.won, sector: r.sector, me: !!r.is_me }));
      },
      async myBest(o) {
        if (!user) return null;
        const res = await rpc('my_best', { p_board: o.board, p_day: o.day || utcDay() });
        return res.ok ? res.data : null;
      },
      async raid() {
        const res = await rpc('current_raid');
        return res.ok ? res.data : null;
      },
      async raidHit(damage, runId, time) {
        const res = await rpc('raid_hit', { p_run: runId, p_damage: Math.max(0, Math.round(damage)), p_time: Math.round(time) });
        return res.ok ? Object.assign({ ok: true }, res.data) : res;
      },
      async raidClaim(raidId) {
        const res = await rpc('raid_claim', { p_raid: raidId });
        return res.ok ? { ok: true, reward: res.data } : res;
      },
      async duelCreate(o) {
        const res = await rpc('duel_create', { p_run: o.runId, p_pilot: o.pilot, p_score: o.score, p_time: Math.round(o.time), p_kills: o.kills });
        return res.ok ? { ok: true, code: res.data } : res;
      },
      async duelGet(code) {
        const res = await rpc('duel_get', { p_code: String(code || '').toUpperCase() });
        return res.ok ? res.data : null;
      },
      async duelSubmit(code, o) {
        const res = await rpc('duel_submit', { p_run: o.runId, p_code: String(code).toUpperCase(), p_score: o.score, p_time: Math.round(o.time), p_kills: o.kills });
        return res.ok ? { ok: true, won: !!res.data.won } : res;
      },
      async myDuels() {
        const res = await rpc('my_duels');
        return res.ok && Array.isArray(res.data) ? res.data : [];
      },
      watchOnline(cb) {
        const ch = client.channel('lobby', { config: { presence: { key: rid() } } });
        ch.on('presence', { event: 'sync' }, () => cb(Object.keys(ch.presenceState()).length));
        ch.subscribe((status) => { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
        return () => client.removeChannel(ch);
      },
      room(code, info) {
        const selfId = (user ? user.id.slice(0, 8) : 'guest') + '-' + rid();
        const handlers = {};
        let presenceCb = () => {}, members = [];
        const ch = client.channel('coop:' + code, { config: { broadcast: { self: false, ack: false }, presence: { key: selfId } } });
        ch.on('broadcast', { event: 'm' }, ({ payload }) => {
          if (!payload) return;
          for (const cb of handlers[payload.e] || []) { try { cb(payload.p, payload.f); } catch (e) { /* ignore bad message */ } }
        });
        ch.on('presence', { event: 'sync' }, () => {
          const st = ch.presenceState();
          members = Object.keys(st).map((id) => ({ id, name: (st[id][0] || {}).name || 'Pilot', host: !!(st[id][0] || {}).host }));
          presenceCb(members);
        });
        const ready = new Promise((resolve) => {
          let done = false;
          setTimeout(() => { if (!done) { done = true; resolve(false); } }, TIMEOUT);
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED' && !done) {
              done = true;
              ch.track({ name: info.name, host: !!info.host });
              resolve(true);
            } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !done) { done = true; resolve(false); }
          });
        });
        return {
          selfId, ready,
          send(e, p) { ch.send({ type: 'broadcast', event: 'm', payload: { e, p, f: selfId } }); },
          on(e, cb) { (handlers[e] = handlers[e] || []).push(cb); },
          onPresence(cb) { presenceCb = cb; cb(members); },
          leave() { client.removeChannel(ch); },
        };
      },
    };
  }

  // ---------- local mock driver (testing only) ----------
  function mockDriver() {
    const K = 'ns.mock.';
    const lag = () => new Promise((r) => setTimeout(r, 30 + Math.random() * 50));
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(K + k)) || d; } catch (e) { return d; } };
    const write = (k, v) => localStorage.setItem(K + k, JSON.stringify(v));
    const users = () => read('users', {});
    const err = (error) => ({ ok: false, error });
    const mult = [1, 1, 1.5, 2.1, 2.8, 3.6];
    const week = () => { const d = new Date(); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return d.getUTCFullYear() + '-W' + Math.ceil(((d - y) / 86400000 + y.getUTCDay() + 1) / 7); };

    function me() { return user ? users()[user.email] : null; }
    function checkRun(runId, modeWanted, time) {
      const runs = read('runs', {}), r = runs[runId];
      if (!r || r.uid !== user.id) return [null, 'Unknown run'];
      if (modeWanted && r.mode !== modeWanted) return [null, 'That run was a different mode'];
      if (time < 1 || time > 3600) return [null, 'Impossible run time'];
      if ((Date.now() - r.at) / 1000 < time / 1.3 - 5) return [null, 'That run finished too fast'];
      return [r, null, runs];
    }
    function bestRows(board, day) {
      const by = {};
      for (const s of read('scores', [])) {
        const ok = board === 'daily' ? s.mode === 'daily' && s.day === day : s.mode === 'normal' && (board === 'all' || s.week === week());
        if (ok && (!by[s.uid] || s.score > by[s.uid].score)) by[s.uid] = s;
      }
      return Object.values(by).sort((a, b) => b.score - a.score);
    }
    function raidNow() {
      const raids = read('raids', {});
      const wk = week();
      if (!raids[wk]) raids[wk] = { id: Object.keys(raids).length + 1, week: wk, name: 'Omega Hive', maxHp: 1500000, hp: 1500000, defeated: false, hits: {} };
      write('raids', raids);
      return [raids[wk], raids];
    }
    function duelView(d) {
      const u = Object.values(users());
      const name = (id) => (u.find((x) => x.id === id) || {}).username || null;
      return { code: d.code, seed: d.seed, pilot: d.pilot, creatorName: name(d.creator), creatorScore: d.cs, creatorTime: d.ct, creatorKills: d.ck,
        opponentName: name(d.opp), opponentScore: d.os, opponentTime: d.ot, opponentKills: d.ok, isCreator: !!user && d.creator === user.id, done: !!d.opp };
    }

    return {
      async init() {
        // Sessions are per tab so two tabs can be two players.
        const s = sessionStorage.getItem(K + 'session');
        const u = s && users()[s];
        setUser(u ? { id: u.id, email: s, username: u.username } : null);
      },
      async signUp(email, password, username) {
        await lag();
        const bad = validSignup(email, password, username);
        if (bad) return err(bad);
        const all = users();
        if (all[email]) return err('That email already has an account. Log in instead.');
        if (Object.values(all).some((u) => u.username.toLowerCase() === username.toLowerCase())) return err('That name is taken.');
        all[email] = { id: 'u-' + rid(), password, username, save: null };
        write('users', all);
        sessionStorage.setItem(K + 'session', email);
        setUser({ id: all[email].id, email, username });
        return { ok: true };
      },
      async signIn(email, password) {
        await lag();
        const u = users()[email];
        if (!u || u.password !== password) return err('Wrong email or password.');
        sessionStorage.setItem(K + 'session', email);
        setUser({ id: u.id, email, username: u.username });
        return { ok: true };
      },
      async signOut() { sessionStorage.removeItem(K + 'session'); setUser(null); return { ok: true }; },
      async resetPassword(email) { await lag(); return EMAIL_RE.test(email) ? { ok: true } : err('Enter a valid email address.'); },
      async updatePassword(pw) { const all = users(); if (user) { all[user.email].password = pw; write('users', all); } return { ok: true }; },
      async setUsername(name) {
        await lag();
        if (!NAME_RE.test(name || '')) return err('Names are 3-16 letters, numbers or _.');
        const all = users();
        if (Object.values(all).some((u) => u.username.toLowerCase() === name.toLowerCase() && u.id !== user.id)) return err('That name is taken.');
        all[user.email].username = name;
        write('users', all);
        setUser(Object.assign({}, user, { username: name }));
        return { ok: true };
      },
      async loadSave() { await lag(); const u = me(); return u && u.save ? { data: u.save, updatedAt: u.saveAt } : null; },
      async deleteAccount() {
        await lag();
        if (!user) return err('Log in first');
        const all = users();
        delete all[user.email];
        write('users', all);
        write('scores', read('scores', []).filter((s) => s.uid !== user.id));
        sessionStorage.removeItem(K + 'session');
        setUser(null);
        return { ok: true };
      },
      async pushSave(save) { await lag(); const all = users(); if (!user) return err('Log in first'); all[user.email].save = save; all[user.email].saveAt = new Date().toISOString(); write('users', all); return { ok: true }; },
      async startRun(o) {
        await lag();
        if (!user) return err('Log in first');
        const runs = read('runs', {}), mine = Object.values(runs).filter((r) => r.uid === user.id);
        if (mine.some((r) => Date.now() - r.at < 5000)) return err('Slow down a little');
        if (o.mode === 'daily' && mine.some((r) => r.mode === 'daily' && r.day === utcDay())) return err("You already played today's daily run");
        if ((o.sector || 1) > 1 && !read('scores', []).some((s) => s.uid === user.id && s.won && s.mode === 'normal' && s.sector >= o.sector - 1)) return err('Beat the Queen in the previous sector online first');
        const id = 'r-' + rid();
        runs[id] = { id, uid: user.id, mode: o.mode, sector: o.sector || 1, seed: o.seed || 0, day: utcDay(), at: Date.now() };
        write('runs', runs);
        return { ok: true, runId: id };
      },
      async submitScore(r) {
        await lag();
        if (!user) return err('Log in first');
        const [run, e, runs] = checkRun(r.runId, null, r.time);
        if (e) return err(e);
        if (run.usedScore) return err('That run was already submitted');
        if (!['normal', 'daily'].includes(run.mode)) return err('Only solo runs go on the leaderboard');
        if (r.won && r.time < 480) return err('Impossible win');
        const expected = Math.floor((r.time * 10 + r.kills * 2 + r.level * 50 + (r.won ? 5000 : 0)) * mult[run.sector]);
        if (Math.abs(r.score - expected) > 30 * mult[run.sector]) return err('Score does not add up');
        run.usedScore = true;
        write('runs', runs);
        const scores = read('scores', []);
        scores.push({ uid: user.id, score: r.score, time: r.time, kills: r.kills, level: r.level, pilot: r.pilot, won: !!r.won, sector: run.sector, mode: run.mode, day: run.day, week: week() });
        write('scores', scores);
        const rows = bestRows(run.mode === 'daily' ? 'daily' : 'all', run.day);
        return { ok: true, rank: rows.filter((x) => x.uid !== user.id && x.score > r.score).length + 1 };
      },
      async leaderboard(o) {
        await lag();
        const all = Object.values(users());
        return bestRows(o.board, o.day || utcDay()).slice(0, o.limit || 50).map((s, i) => ({
          rank: i + 1, username: (all.find((u) => u.id === s.uid) || {}).username || 'Pilot', score: s.score, time: s.time, kills: s.kills,
          level: s.level, pilot: s.pilot, won: s.won, sector: s.sector, me: !!user && s.uid === user.id,
        }));
      },
      async myBest(o) {
        await lag();
        if (!user) return null;
        const rows = bestRows(o.board, o.day || utcDay()), i = rows.findIndex((s) => s.uid === user.id);
        return i < 0 ? null : { rank: i + 1, score: rows[i].score };
      },
      async raid() {
        await lag();
        const [r] = raidNow(), hits = r.hits, all = Object.values(users());
        const top = Object.entries(hits).sort((a, b) => b[1].d - a[1].d).slice(0, 5).map(([uid, h]) => ({ username: (all.find((u) => u.id === uid) || {}).username || 'Pilot', damage: h.d }));
        const mine = user && hits[user.id];
        return { id: r.id, week: r.week, name: r.name, maxHp: r.maxHp, hp: r.hp, defeated: r.defeated, myDamage: mine ? mine.d : 0, contributors: Object.keys(hits).length, claimed: !!(mine && mine.c), top };
      },
      async raidHit(damage, runId, time) {
        await lag();
        if (!user) return err('Log in first');
        const [run, e, runs] = checkRun(runId, null, time);
        if (e) return err(e);
        if (run.usedRaid) return err('That run already hit the raid');
        run.usedRaid = true;
        write('runs', runs);
        const [r, raids] = raidNow();
        const dmg = Math.min(Math.max(0, damage), 400000, Math.floor(((Date.now() - run.at) / 1000) * 1200));
        if (!r.defeated) {
          r.hp = Math.max(0, r.hp - dmg);
          r.defeated = r.hp === 0;
          r.hits[user.id] = { d: ((r.hits[user.id] || {}).d || 0) + dmg, c: false };
          write('raids', raids);
        }
        return { ok: true, hp: r.hp, defeated: r.defeated, damage: dmg };
      },
      async raidClaim(id) {
        await lag();
        const raids = read('raids', {}), r = Object.values(raids).find((x) => x.id === id);
        if (!r || !r.defeated) return err('The raid boss is still alive');
        const h = r.hits[user.id];
        if (!h) return err('You did not fight this raid');
        if (h.c) return err('Reward already claimed');
        h.c = true;
        write('raids', raids);
        const top3 = Object.entries(r.hits).sort((a, b) => b[1].d - a[1].d).slice(0, 3).some(([uid]) => uid === user.id);
        return { ok: true, reward: { gems: 60 + (top3 ? 40 : 0), eggs: 1 } };
      },
      async duelCreate(o) {
        await lag();
        const [run, e, runs] = checkRun(o.runId, 'duel', o.time);
        if (e) return err(e);
        if (run.usedDuel) return err('That run already made a duel');
        run.usedDuel = true;
        write('runs', runs);
        const duels = read('duels', {});
        let code;
        do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join(''); } while (duels[code]);
        duels[code] = { code, seed: run.seed, pilot: o.pilot, creator: user.id, cs: o.score, ct: Math.round(o.time), ck: o.kills, at: Date.now() };
        write('duels', duels);
        return { ok: true, code };
      },
      async duelGet(code) { await lag(); const d = read('duels', {})[String(code).toUpperCase()]; return d ? duelView(d) : null; },
      async duelSubmit(code, o) {
        await lag();
        const duels = read('duels', {}), d = duels[String(code).toUpperCase()];
        if (!d) return err('No duel with that code');
        if (d.creator === user.id) return err('You cannot duel yourself');
        if (d.opp) return err('That duel is already finished');
        const [run, e, runs] = checkRun(o.runId, 'duel', o.time);
        if (e) return err(e);
        if (run.seed !== d.seed) return err('That run used a different seed');
        if (run.usedDuel) return err('That run was already used');
        run.usedDuel = true;
        write('runs', runs);
        Object.assign(d, { opp: user.id, os: o.score, ot: Math.round(o.time), ok: o.kills });
        write('duels', duels);
        return { ok: true, won: o.score > d.cs };
      },
      async myDuels() {
        await lag();
        return Object.values(read('duels', {})).filter((d) => user && (d.creator === user.id || d.opp === user.id)).sort((a, b) => b.at - a.at).slice(0, 20).map(duelView);
      },
      watchOnline(cb) {
        const bc = new BroadcastChannel('ns-mock-lobby'), id = rid(), seen = new Map();
        const beat = () => { bc.postMessage(id); seen.set(id, Date.now()); prune(); };
        const prune = () => { for (const [k, t] of seen) if (Date.now() - t > 4000) seen.delete(k); cb(seen.size); };
        bc.onmessage = (e) => { seen.set(e.data, Date.now()); prune(); };
        beat();
        const t = setInterval(beat, 1500);
        return () => { clearInterval(t); bc.close(); };
      },
      room(code, info) {
        const selfId = (user ? user.id : 'guest') + '-' + rid();
        const bc = new BroadcastChannel('ns-room-' + code), handlers = {}, members = new Map();
        let presenceCb = () => {};
        const meInfo = { id: selfId, name: info.name, host: !!info.host };
        members.set(selfId, Object.assign({ seen: Date.now() }, meInfo));
        const emit = () => presenceCb([...members.values()].map(({ id, name, host }) => ({ id, name, host })));
        bc.onmessage = (ev) => {
          const m = ev.data;
          if (m.k === 'pres') {
            const had = members.has(m.me.id);
            members.set(m.me.id, Object.assign({ seen: Date.now() }, m.me));
            if (!had) { bc.postMessage({ k: 'pres', me: meInfo }); emit(); }
          } else if (m.k === 'bye') { members.delete(m.id); emit(); }
          else for (const cb of handlers[m.e] || []) cb(m.p, m.f);
        };
        const hb = setInterval(() => {
          bc.postMessage({ k: 'pres', me: meInfo });
          let gone = false;
          for (const [id, m] of members) if (id !== selfId && Date.now() - m.seen > 4000) { members.delete(id); gone = true; }
          if (gone) emit();
        }, 1000);
        bc.postMessage({ k: 'pres', me: meInfo });
        return {
          selfId, ready: Promise.resolve(true),
          send(e, p) { bc.postMessage({ k: 'm', e, p: JSON.parse(JSON.stringify(p)), f: selfId }); },
          on(e, cb) { (handlers[e] = handlers[e] || []).push(cb); },
          onPresence(cb) { presenceCb = cb; emit(); },
          leave() { clearInterval(hb); bc.postMessage({ k: 'bye', id: selfId }); bc.close(); },
        };
      },
    };
  }

  // ---------- public API ----------
  const offline = async () => ({ ok: false, error: 'Online features are not connected yet.' });
  const api = {
    get mode() { return mode; },
    get available() { return mode !== 'off'; },
    get user() { return user; },
    // Why online is off: 'no-config' (keys missing) or 'failed: <reason>' (could not connect).
    get status() { return status; },
    onAuth(cb) { authCbs.push(cb); return () => authCbs.splice(authCbs.indexOf(cb), 1); },
    onRecovery(cb) { recoveryCbs.push(cb); },
    async init() {
      if (drv) return;
      const cfg = window.NS_CONFIG || {};
      let q;
      try { q = new URLSearchParams(location.search); } catch (e) { q = new URLSearchParams(); }
      const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
      try {
        if (local && q.get('backend') === 'mock') { drv = mockDriver(); mode = 'mock'; }
        else if (cfg.supabaseUrl && cfg.supabaseKey) { drv = supabaseDriver(cfg); mode = 'supabase'; }
        if (drv) { await drv.init(); status = 'ok'; }
      } catch (e) {
        // Server unreachable or library failed to load: keep playing offline.
        mode = 'off';
        drv = null;
        status = 'failed: ' + ((e && e.message) || 'could not load the online library');
      }
    },
    room(code, info) { return drv ? drv.room(code, info) : null; },
    watchOnline(cb) { return drv ? drv.watchOnline(cb) : () => {}; },
  };
  for (const name of ['signUp', 'signIn', 'signOut', 'resetPassword', 'updatePassword', 'setUsername', 'pushSave', 'deleteAccount', 'startRun', 'submitScore', 'raidHit', 'raidClaim', 'duelCreate', 'duelSubmit']) {
    api[name] = (...a) => (drv ? drv[name](...a).catch((e) => ({ ok: false, error: friendly(e && e.message) })) : offline());
  }
  for (const name of ['loadSave', 'myBest', 'raid', 'duelGet']) {
    api[name] = (...a) => (drv ? drv[name](...a).catch(() => null) : Promise.resolve(null));
  }
  for (const name of ['leaderboard', 'myDuels']) {
    api[name] = (...a) => (drv ? drv[name](...a).catch(() => []) : Promise.resolve([]));
  }
  return api;
})();
