'use strict';
/* Neon Swarm — run guard. Reports progress to the server every 30 seconds of play and checks the
   run locally for edited values, sped-up clocks and open developer tools. A run that fails a check
   still plays, but it is never posted online and the server is told why. */

const Guard = (() => {
  const CP_EVERY = 30;
  let g = null, busy = false;
  let win = null; // speed window: game time vs. two independent real clocks

  // Same cap as public.ns_max_kills in schema.sql.
  function maxKills(t, mode) {
    const a = Math.min(t, 480);
    return Math.ceil((2 * a + 3456 * Math.pow(a / 480, 2.5) + 8 * Math.max(t - 480, 0) + 300) * (mode === 'daily' ? 1.6 : 1) * 1.6);
  }

  function taint(game, why) {
    if (!game || game.tainted) return;
    game.tainted = why;
  }

  function start(game) {
    g = game;
    busy = false;
    if (!g.cp) g.cp = { seq: 0, lastT: Math.floor(g.t / CP_EVERY) * CP_EVERY, off: false };
    win = null;
  }

  function stop() {
    g = null;
    win = null;
  }

  // Game time can only run as fast as real time times the daily speed modifier.
  function speedCheck() {
    const now = Date.now(), perf = performance.now();
    if (!win || g.state !== 'play') { win = { t: g.t, now, perf }; return; }
    const real = Math.max(now - win.now, perf - win.perf) / 1000;
    if (real < 10) return;
    const ran = g.t - win.t, limit = real * g.world.gameSpeed * 1.2 + 1;
    if (ran > limit) taint(g, 'game ran faster than real time');
    win = { t: g.t, now, perf };
  }

  function checkpoint() {
    if (!g.runId || g.cp.off || busy || g.tainted || !Online.available || !Online.user) return;
    if (g.t - g.cp.lastT < CP_EVERY) return;
    const game = g, c = { runId: game.runId, seq: game.cp.seq + 1, t: Math.floor(game.t), kills: game.kills, level: game.level };
    busy = true;
    Online.checkpoint(c).then((res) => {
      busy = false;
      if (res.ok) { game.cp.seq = c.seq; game.cp.lastT = c.t; return; }
      const e = res.error || '';
      if (/reach the server|connection/i.test(e)) game.cp.lastT = c.t - CP_EVERY + 10; // try again soon
      else if (/ahead|Impossible|backwards|out of order/i.test(e)) taint(game, 'server rejected a checkpoint: ' + e);
      else game.cp.off = true; // older server, banned, or the run is gone: stop reporting
    });
  }

  function tick() {
    if (!g || g.finished || g.role !== 'solo' || DEBUG.speed > 1) return;
    speedCheck();
    checkpoint();
  }

  // Final checks on a finished run. Returns null when it looks clean, or the reason it does not.
  function verify(game, r) {
    if (!game || game.role !== 'solo') return null;
    if (game.tainted) return game.tainted;
    if (!game.sealOk()) return 'run values were edited';
    const score = Math.floor((r.time * 10 + r.kills * 2 + r.level * 50 + (r.won ? 5000 : 0)) * game.world.reward);
    if (score !== r.score) return 'score was edited';
    if (r.kills > maxKills(r.time, game.mode)) return 'impossible kill count';
    if (r.level > 10 + r.time / 10) return 'impossible level';
    if (r.won && r.time < 485) return 'impossible win';
    if (r.weapons.length > MAX_WEAPONS || r.passives.length > MAX_PASSIVES) return 'too many upgrades';
    if (r.weapons.some((w) => !WEAPONS[w.id] || w.level > weaponMax(w.id))) return 'impossible weapon';
    return null;
  }

  // Open developer tools pause on this statement; a long pause means someone is inspecting the game.
  function trapDevtools() {
    setInterval(() => {
      const a = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      if (performance.now() - a > 150 && g && !g.finished) taint(g, 'developer tools were open');
    }, 1500);
  }

  return { start, stop, tick, verify, taint, trapDevtools, maxKills };
})();
