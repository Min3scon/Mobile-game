'use strict';
/* Neon Swarm — live co-op. The host's phone runs the whole simulation; everyone else moves their own
   ship locally (no input lag), reports its position, and renders the host's world from snapshots. */

const Coop = (() => {
  const SNAP_HZ = 10, POS_HZ = 15, TIMEOUT = 12, MAX_PLAYERS = 4;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const state = { code: null, isHost: false, selfId: null, members: [], error: '', inGame: false };
  let room = null, infos = {}, snapT = 0, posT = 0, lastSnapAt = 0, lastState = 'play', silence = 0;
  const E_FLAGS = { elite: 1, flash: 2, tele: 4, charge: 8, shield: 16, slow: 32, aim: 64 };

  function notify() {
    if (UI.current() === 'scr-coop') UI.renderCoop();
  }

  function myInfo() {
    return { name: myName(), charId: save.selChar, meta: localMeta(save.selChar) };
  }

  function refreshMembers(list) {
    state.members = list.slice(0, MAX_PLAYERS).map((m) => ({ id: m.id, name: (infos[m.id] && infos[m.id].name) || m.name || 'Pilot', host: !!m.host, charId: (infos[m.id] && infos[m.id].charId) || 'volt' }));
  }

  function open(code, host) {
    leave();
    if (!Online.room) { state.error = 'Co-op needs the online server.'; notify(); return; }
    state.code = code;
    state.isHost = host;
    state.error = '';
    state.members = [];
    infos = {};
    room = Online.room(code, { name: myName(), host });
    state.selfId = room.selfId;
    infos[room.selfId] = myInfo();
    room.onPresence((list) => {
      refreshMembers(list);
      const g = game;
      if (g && g.role === 'client' && !list.some((m) => m.host)) lostHost();
      if (g && g.role === 'host') {
        for (const sh of g.ships) {
          if (sh !== g.local && !sh.left && !list.some((m) => m.id === sh.id)) dropShip(g, sh);
        }
      }
      if (!state.inGame && !host && list.length && !list.some((m) => m.host)) state.error = 'Waiting for the host…';
      notify();
    });
    room.on('hello', (p, from) => {
      infos[from] = p;
      if (!p.reply) room.send('hello', Object.assign(myInfo(), { reply: true }));
      for (const m of state.members) if (m.id === from) { m.name = p.name; m.charId = p.charId; }
      notify();
    });
    room.on('start', (p) => { if (!state.isHost) startClient(p); });
    room.on('snap', (p) => { if (game && game.role === 'client') applySnap(game, p); });
    room.on('lvl', (p) => { if (game && game.role === 'client' && p.to === state.selfId) clientLevelUp(game, p); });
    room.on('chest', (p) => {
      if (!game || game.role !== 'client' || p.to !== state.selfId) return;
      if (p.evo && !save.codex[p.evo]) { save.codex[p.evo] = true; writeSave(); }
      if (p.evo) game.evolved.push(p.evo);
      game.runStats.chests++;
    });
    room.on('over', (p) => { if (game && game.role === 'client') clientOver(game, p); });
    room.on('pos', (p, from) => {
      const sh = game && game.role === 'host' && game.ships.find((s) => s.id === from);
      if (sh) sh.net = { x: p.x, y: p.y, fx: p.fx, fy: p.fy, moving: !!p.m };
    });
    room.on('pick', (p, from) => {
      const g = game, sh = g && g.role === 'host' && g.ships.find((s) => s.id === from);
      if (sh) g.choose(p.c, sh);
    });
    room.on('reroll', (p, from) => {
      const g = game, sh = g && g.role === 'host' && g.ships.find((s) => s.id === from);
      if (sh && g.reroll(sh)) sendLevelUp(g, sh);
    });
    room.ready.then((ok) => {
      if (!ok) { state.error = 'Could not connect. Check your internet and the code.'; notify(); return; }
      room.send('hello', myInfo());
      notify();
    });
    notify();
  }

  function create() {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    open(code, true);
  }

  function join(code) {
    open(code, false);
  }

  function leave() {
    if (room) room.leave();
    room = null;
    state.code = null;
    state.isHost = false;
    state.members = [];
    state.inGame = false;
  }

  // ---------- host ----------
  function start() {
    if (!room || !state.isHost || state.members.length < 2) return;
    const ids = [state.selfId].concat(state.members.map((m) => m.id).filter((id) => id !== state.selfId)).slice(0, MAX_PLAYERS);
    const ships = ids.map((id) => {
      const inf = infos[id] || { name: 'Pilot', charId: 'volt', meta: { shop: {}, mastery: 1, pets: [] } };
      return { id, name: inf.name, charId: CHARS[inf.charId] ? inf.charId : 'volt', meta: sanitizeMeta(inf.meta) };
    });
    const seed = (Math.random() * 4294967296) >>> 0;
    room.send('start', { seed, ships });
    game = new Game({
      role: 'host', mode: 'coop', seed, ships, localId: state.selfId,
      hooks: { levelUp: UI.showLevelUp, over: hostOver, netLevelUp: (g) => { for (const sh of g.ships) if (sh !== g.local && sh.pick) sendLevelUp(g, sh); }, netChest },
    });
    state.inGame = true;
    lastState = 'play';
    beginGame();
    getTicket(seed);
  }

  // Each player asks the server for their own run ticket so raid damage and quests count.
  function getTicket(seed) {
    if (!Online.user) return;
    const g = game;
    Online.startRun({ mode: 'coop', sector: 1, seed }).then((res) => { if (res.ok && game === g) g.runId = res.runId; });
  }

  // Remote players report their own shop/pets; clamp them so nobody brings a broken build.
  function sanitizeMeta(m) {
    const shop = {};
    for (const it of SHOP) shop[it.id] = clamp((m && m.shop && +m.shop[it.id]) || 0, 0, it.max);
    const pets = ((m && m.pets) || []).filter((p) => PETS[p.id]).slice(0, 2).map((p) => ({ id: p.id, stars: clamp(+p.stars || 1, 1, PET_MAX_STARS) }));
    return { shop, mastery: clamp((m && +m.mastery) || 1, 1, 10), pets, trail: m && TRAILS[m.trail] ? m.trail : '' };
  }

  function sendLevelUp(g, sh) {
    room.send('lvl', {
      to: sh.id, choices: sh.pick, level: g.level, pending: g.pendingLevels, rerolls: sh.rerolls,
      w: sh.weapons.map((w) => [w.id, w.level, w.evo ? 1 : 0]), p: sh.passives.map((p) => [p.id, p.level]),
    });
  }

  function netChest(g, sh, reward) {
    if (sh === g.local) {
      if (reward.evo) UI.toast('Evolution: ' + WEAPONS[reward.evo].evo.name);
      return;
    }
    room.send('chest', { to: sh.id, evo: reward.evo, ups: reward.ups.length, gold: reward.gold });
  }

  function dropShip(g, sh) {
    sh.left = true;
    sh.down = true;
    sh.revives = sh.phoenix = 0;
    sh.reviveT = -1e9;
    g.say(sh.name + ' left', { color: '#a7a2d6', small: true });
    if (sh.pick && g.state === 'levelup') g.choose(sh.pick[0], sh);
    if (!g.alive().length && g.state === 'play') g.shipDown(g.local.down ? g.local : sh);
  }

  function hostOver(r) {
    const g = game;
    if (room) {
      room.send('over', {
        won: r.won, time: r.time, kills: r.kills, level: r.level, wardens: r.wardens, score: r.score, seed: g.seed,
        ships: g.ships.map((sh) => ({
          id: sh.id, gold: Math.floor(sh.gold), chests: sh.chests, dmg: Math.round(sh.dmgDealt), bestNoHit: sh.bestNoHit, evolutions: sh.weapons.filter((w) => w.evo).length,
          weapons: sh.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })), passives: sh.passives.map((p) => ({ id: p.id, level: p.level })),
        })),
      });
    }
    state.inGame = false;
    onRunOver(r);
  }

  function buildSnap(g) {
    const e = [];
    for (const en of g.enemies) {
      if (en.dead) continue;
      let f = 0;
      if (en.elite) f |= E_FLAGS.elite;
      if (en.flash > 0) f |= E_FLAGS.flash;
      if (en.tele) f |= E_FLAGS.tele;
      if (en.charge) f |= E_FLAGS.charge;
      if (en.shieldT > 0) f |= E_FLAGS.shield;
      if (en.slowT > 0) f |= E_FLAGS.slow;
      if (en.d.ai === 'shoot' && en.st < 0.45) f |= E_FLAGS.aim;
      e.push(en.id, ENEMY_KEYS.indexOf(en.type), Math.round(en.x), Math.round(en.y), Math.round(en.ang * 100), f, Math.round(en.r), en.tele ? Math.round(Math.atan2(en.dy, en.dx) * 100) : 0);
    }
    const bl = [];
    for (const sh of g.ships) {
      const w = sh.weapons.find((x) => x.id === 'blades');
      if (w && w.pos) {
        const s = g.ws(sh, w);
        bl.push([sh.id, +w.angle.toFixed(2), +s.spin.toFixed(2), Math.round(s.radius * s.area), +w.br.toFixed(1), s.amount, w.evo ? 1 : 0]);
      }
    }
    const b = g.boss && !g.boss.dead ? [g.boss.id, Math.round(g.boss.hp), Math.round(g.boss.maxHp)] : 0;
    const ev = g.netEvents;
    g.netEvents = [];
    return {
      t: +g.t.toFixed(2), st: g.state, lv: g.level, xp: Math.round(g.xp), xn: g.xpNext, k: g.kills, fin: g.finalSpawned ? 1 : 0,
      s: g.ships.map((sh) => [sh.id, Math.round(sh.x), Math.round(sh.y), Math.round(sh.hp), sh.stats.maxHp, sh.down ? 1 : 0, sh.inv > 0 ? 1 : 0,
        Math.round(sh.fx * 100), Math.round(sh.fy * 100), Math.floor(sh.gold), Math.round(sh.reviveT * 10), sh.shield ? 1 : 0, Math.round(PICKUP_RADIUS * sh.stats.magnet), sh.moving ? 1 : 0]),
      e, b, bl, ev,
    };
  }

  // ---------- client ----------
  function startClient(p) {
    if (!p.ships.some((s) => s.id === state.selfId)) { state.error = 'The game started without you. Ask the host for a new room.'; notify(); return; }
    game = new Game({ role: 'client', mode: 'coop', seed: p.seed, ships: p.ships, localId: state.selfId, hooks: { levelUp: UI.showLevelUp, over: onRunOver } });
    game.cEnemies = new Map();
    game.cPick = new Map();
    for (const sh of game.ships) { sh.px = sh.tx = sh.x; sh.py = sh.ty = sh.y; }
    state.inGame = true;
    lastSnapAt = performance.now();
    silence = 0;
    lastState = 'play';
    beginGame();
    getTicket(p.seed);
  }

  function applySnap(g, p) {
    const now = performance.now();
    lastSnapAt = now;
    silence = 0;
    g.t = p.t;
    g.level = p.lv;
    g.xp = p.xp;
    g.xpNext = p.xn;
    g.kills = p.k;
    g.finalSpawned = !!p.fin;
    if (p.st !== lastState) {
      if (lastState === 'levelup' && p.st === 'play' && ['scr-level'].includes(UI.current())) UI.show(null);
      lastState = p.st;
    }
    g.state = p.st === 'levelup' ? 'levelup' : p.st === 'play' ? 'play' : g.state;
    for (const row of p.s) {
      const sh = g.ships.find((s) => s.id === row[0]);
      if (!sh) continue;
      const wasDown = sh.down;
      sh.hp = row[3];
      sh.stats.maxHp = row[4];
      sh.down = !!row[5];
      sh.inv = row[6] ? Math.max(sh.inv, 0.15) : 0;
      sh.gold = row[9];
      sh.reviveT = row[10] / 10;
      sh.shield = row[11];
      sh.magnetR = row[12];
      if (sh === g.local) {
        if (sh.down && !wasDown) Sound.play.death();
        continue;
      }
      sh.px = sh.x; sh.py = sh.y; sh.tx = row[1]; sh.ty = row[2];
      sh.fx = row[7] / 100; sh.fy = row[8] / 100; sh.moving = !!row[13];
    }
    // enemies
    const seen = new Set();
    const map = g.cEnemies;
    for (let i = 0; i < p.e.length; i += 8) {
      const id = p.e[i];
      seen.add(id);
      let en = map.get(id);
      const key = ENEMY_KEYS[p.e[i + 1]], f = p.e[i + 5];
      if (!en) {
        const d = ENEMIES[key] || BOSSES[key];
        en = { id, type: key, d, x: p.e[i + 2], y: p.e[i + 3], px: p.e[i + 2], py: p.e[i + 3], tx: p.e[i + 2], ty: p.e[i + 3], boss: !!BOSSES[key], dead: false, flash: 0, st: 9, hp: 1, maxHp: 1 };
        map.set(id, en);
        g.enemies.push(en);
      }
      en.px = en.x; en.py = en.y; en.tx = p.e[i + 2]; en.ty = p.e[i + 3];
      en.ang = p.e[i + 4] / 100;
      en.r = p.e[i + 6];
      en.elite = !!(f & E_FLAGS.elite);
      if (f & E_FLAGS.flash) en.flash = 0.08;
      en.tele = f & E_FLAGS.tele ? 1 : 0;
      if (en.tele) { const a = p.e[i + 7] / 100; en.dx = Math.cos(a); en.dy = Math.sin(a); }
      en.charge = f & E_FLAGS.charge ? 1 : 0;
      en.shieldT = f & E_FLAGS.shield ? 1 : 0;
      en.slowT = f & E_FLAGS.slow ? 1 : 0;
      en.st = f & E_FLAGS.aim ? 0.2 : 9;
    }
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const en = g.enemies[i];
      if (!seen.has(en.id)) { map.delete(en.id); removeAt(g.enemies, i); }
    }
    g.boss = null;
    if (p.b) {
      const b = map.get(p.b[0]);
      if (b) { b.hp = p.b[1]; b.maxHp = p.b[2]; g.boss = b; }
    }
    // blades
    for (const sh of g.ships) sh.blade = null;
    for (const r of p.bl) {
      const sh = g.ships.find((s) => s.id === r[0]);
      if (sh) sh.blade = { angle: r[1], spin: r[2], R: r[3], br: r[4], n: r[5], evo: r[6] };
    }
    for (const ev of p.ev) applyEvent(g, ev);
  }

  function applyEvent(g, ev) {
    const [type, ...a] = ev;
    const ship = (id) => g.ships.find((s) => s.id === id);
    switch (type) {
      case 'b': g.bullets.push({ kind: 'bolt', x: a[0], y: a[1], vx: a[2], vy: a[3], sp: Math.hypot(a[2], a[3]) || 1, ang: Math.atan2(a[3], a[2]), color: a[4], big: !!a[5], size: a[6], r: 4 * a[6], life: 1.3 }); break;
      case 'm': g.bullets.push({ kind: 'missile', x: a[0], y: a[1], ang: a[2], sp: 90, maxSp: a[3], life: 2.6, trail: 0 }); break;
      case 'gl': { const sh = ship(a[0]); if (sh) g.bullets.push({ kind: 'glaive', sh, x: a[1], y: a[2], vx: Math.cos(a[3]) * a[4], vy: Math.sin(a[3]) * a[4], sp: a[4], range: a[5], dist: 0, out: true, r: a[6], big: !!a[7], ang: 0, life: 4 }); break; }
      case 'l': g.fx.push({ kind: 'bolt', pts: a[0], life: a[1], max: a[1], color: a[2] }); break;
      case 'n': { const sh = ship(a[0]); if (sh) g.fx.push({ kind: 'nova', sh, x: sh.x, y: sh.y, r: 8, maxR: a[1], speed: 420, color: a[2], life: 1, max: 1 }); break; }
      case 'bm': g.fx.push({ kind: 'beam', x: a[0], y: a[1], ang: a[2], len: a[3], w: a[4], color: a[5], life: 0.25, max: 0.25 }); break;
      case 'x': g.fx.push({ kind: 'blast', x: a[0], y: a[1], r: a[2], color: a[3], life: 0.3, max: 0.3 }); Sound.play.boom(); break;
      case 'r': g.fx.push({ kind: 'ring', x: a[0], y: a[1], r: a[2], color: a[3], life: 0.45, max: 0.45 }); break;
      case 'k':
        for (let i = 0; i < a[2]; i++) {
          const ang = rand(0, TAU), v = rand(a[4] * 0.3, a[4]);
          g.particle(a[0], a[1], Math.cos(ang) * v, Math.sin(ang) * v, rand(0.3, 0.6), rand(4, 8), a[3]);
        }
        Sound.play.kill();
        break;
      case 'h': {
        const sh = ship(a[0]);
        if (!sh) break;
        for (let i = 0; i < 8; i++) g.particle(sh.x, sh.y, rand(-120, 120), rand(-120, 120), 0.35, 6, '#ff4b5c');
        if (sh === g.local) { g.shake = Math.min(14, g.shake + 7); sh.hurtFlash = 0.18; Sound.play.hurt(); }
        break;
      }
      case 'eb': g.ebullets.push({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: 5.5, life: 7 }); break;
      case 'p+': g.pickups.push({ id: a[0], kind: a[1], x: a[2], y: a[3], v: a[4], vx: a[5], vy: a[6], attract: null, sp: 0, seed: rand(0, TAU) }); break;
      case 'p-': {
        const i = g.pickups.findIndex((k) => k.id === a[0]);
        if (i >= 0) {
          const k = g.pickups[i];
          removeAt(g.pickups, i);
          if (k.kind === 'gem' && Math.hypot(k.x - g.local.x, k.y - g.local.y) < 80) {
            if (g.clock - g.gemStepT > 0.5) g.gemStep = 0;
            g.gemStepT = g.clock;
            Sound.play.gem(g.gemStep++);
          }
        }
        break;
      }
      case 'gv': { const k = g.pickups.find((q) => q.id === a[0]); if (k) k.v = a[1]; break; }
      case 'mi': g.mines.push({ id: a[0], x: a[1], y: a[2], evo: !!a[3], arm: 0.4 }); break;
      case 'mx': { const i = g.mines.findIndex((m) => m.id === a[0]); if (i >= 0) removeAt(g.mines, i); break; }
      case 'z': g.zones.push({ x: a[0], y: a[1], r: a[2], life: a[3], max: a[3], color: a[4] }); break;
      case 'say': g.banners.length < 4 && g.banners.push({ text: a[0], sub: a[1], color: a[2] || undefined, small: !!a[3], dur: a[4], t: 0 }); break;
      case 'snd': if (Sound.play[a[0]]) Sound.play[a[0]](); break;
    }
  }

  function clientLevelUp(g, p) {
    const L = g.local;
    L.weapons = p.w.map(([id, level, evo]) => ({ id, level, evo: !!evo, cd: 0, angle: 0, pos: null, br: 9 }));
    L.passives = p.p.map(([id, level]) => ({ id, level }));
    L.rerolls = p.rerolls;
    L.pick = p.choices;
    g.level = p.level;
    g.pendingLevels = p.pending;
    g.state = 'levelup';
    lastState = 'levelup';
    Input.reset();
    Sound.play.levelup();
    UI.showLevelUp(g, p.choices);
  }

  // Runs every frame on non-host phones instead of the simulation.
  function clientFrame(g, dt) {
    const L = g.local;
    if (g.state === 'play' && !L.down) {
      const v = Input.vector();
      g.moveShip(L, v.x, v.y, dt);
    } else {
      L.vx = L.vy = 0;
      L.moving = false;
    }
    posT += dt;
    if (room && posT >= 1 / POS_HZ) {
      posT = 0;
      room.send('pos', { x: Math.round(L.x), y: Math.round(L.y), fx: +L.fx.toFixed(2), fy: +L.fy.toFixed(2), m: L.moving ? 1 : 0 });
    }
    const a = clamp((performance.now() - lastSnapAt) / (1000 / SNAP_HZ), 0, 1);
    for (const sh of g.ships) {
      if (sh !== L && sh.tx !== undefined) {
        sh.x = lerp(sh.px, sh.tx, a);
        sh.y = lerp(sh.py, sh.ty, a);
      }
      g.shipTrail(sh, dt);
      if (sh.inv > 0) sh.inv -= dt;
      if (sh.hurtFlash > 0) sh.hurtFlash -= dt;
      for (const pet of sh.pets) petFollow(sh, pet, dt);
      const b = sh.blade;
      const w = sh.weapons.find((x) => x.id === 'blades');
      if (b && !sh.down) {
        b.angle += b.spin * dt;
        const ww = w || { id: 'blades' };
        ww.angle = b.angle;
        ww.br = b.br;
        ww.evo = !!b.evo;
        ww.pos = [];
        for (let i = 0; i < b.n; i++) {
          const ang = b.angle + (i * TAU) / b.n;
          ww.pos.push(sh.x + Math.cos(ang) * b.R, sh.y + Math.sin(ang) * b.R);
        }
        if (!w) sh.weapons.push(Object.assign(ww, { level: 1, cd: 0 }));
      } else if (w) w.pos = null;
    }
    for (const en of g.enemies) {
      en.x = lerp(en.px, en.tx, a);
      en.y = lerp(en.py, en.ty, a);
      if (en.flash > 0) en.flash -= dt;
    }
    // Cosmetic copies of shots and pickups; the host decides every hit.
    for (let i = g.bullets.length - 1; i >= 0; i--) {
      const b = g.bullets[i];
      b.life -= dt;
      if (b.kind === 'missile') {
        const t = g.nearestEnemy(b, 420);
        if (t) {
          let da = Math.atan2(t.y - b.y, t.x - b.x) - b.ang;
          da = (((da + Math.PI) % TAU) + TAU) % TAU - Math.PI;
          b.ang += clamp(da, -7 * dt, 7 * dt);
          if (Math.hypot(t.x - b.x, t.y - b.y) < t.r + 5) b.life = 0;
        }
        b.sp = Math.min(b.maxSp, b.sp + 600 * dt);
        b.x += Math.cos(b.ang) * b.sp * dt;
        b.y += Math.sin(b.ang) * b.sp * dt;
      } else if (b.kind === 'glaive') {
        if (b.out) {
          b.x += b.vx * dt; b.y += b.vy * dt; b.dist += b.sp * dt;
          if (b.dist >= b.range) b.out = false;
        } else {
          const dx = b.sh.x - b.x, dy = b.sh.y - b.y, d = Math.hypot(dx, dy) || 1;
          b.x += (dx / d) * b.sp * 1.25 * dt; b.y += (dy / d) * b.sp * 1.25 * dt;
          if (d < 16) b.life = 0;
        }
        b.ang += dt * 14;
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const t = g.nearestEnemy(b, 30);
        if (t && Math.hypot(t.x - b.x, t.y - b.y) < t.r + b.r) b.life = 0;
      }
      if (b.life <= 0) removeAt(g.bullets, i);
    }
    for (let i = g.ebullets.length - 1; i >= 0; i--) {
      const b = g.ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || g.ships.some((s) => !s.down && Math.hypot(s.x - b.x, s.y - b.y) < b.r + s.r * 0.7)) removeAt(g.ebullets, i);
    }
    for (const k of g.pickups) {
      if (k.vx || k.vy) {
        k.x += k.vx * dt; k.y += k.vy * dt;
        const d = Math.exp(-dt * 6);
        k.vx *= d; k.vy *= d;
        if (Math.abs(k.vx) < 2 && Math.abs(k.vy) < 2) k.vx = k.vy = 0;
      }
      const sh = g.nearestShip(k.x, k.y);
      const reach = k.kind === 'gem' || k.kind === 'coin' ? sh.magnetR || PICKUP_RADIUS : 28;
      const dx = sh.x - k.x, dy = sh.y - k.y, d = Math.hypot(dx, dy) || 1;
      if (k.attract || d < reach) {
        k.attract = sh;
        k.sp = Math.min(900, k.sp + 1500 * dt);
        if (d > sh.r + 4) { k.x += (dx / d) * Math.min(k.sp * dt, d); k.y += (dy / d) * Math.min(k.sp * dt, d); }
      }
    }
    for (const m of g.mines) m.arm -= dt;
    for (let i = g.zones.length - 1; i >= 0; i--) if ((g.zones[i].life -= dt) <= 0) removeAt(g.zones, i);
    g.updateFx(dt);
    g.follow(dt);
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 40);
    if (g.flash > 0) g.flash -= dt * 2.5;
    silence += dt;
    if (silence > TIMEOUT && !g.finished) lostHost();
  }

  function lostHost() {
    const g = game;
    if (!g || g.finished || g.role !== 'client') return;
    g.say('Lost the host', { color: '#ff4b5c' });
    clientOver(g, { won: false, quit: true, time: g.t, kills: g.kills, level: g.level, wardens: 0, ships: [] });
  }

  function clientOver(g, p) {
    if (g.finished) return;
    g.finished = true;
    g.state = p.won ? 'won' : 'dead';
    const L = g.local, mine = (p.ships || []).find((s) => s.id === L.id) || {};
    const score = Math.floor(p.score || (p.time * 10 + p.kills * 2 + p.level * 50 + (p.won ? 5000 : 0)));
    const gold = (mine.gold || Math.floor(L.gold)) + Math.floor((p.time / 60) * 10) + (p.won ? 150 : 0);
    state.inGame = false;
    onRunOver({
      won: p.won, quit: !!p.quit, mode: 'coop', sector: 1, seed: g.seed, daily: false, coop: true,
      time: p.time, kills: p.kills, level: p.level, gold, score, charId: L.charId,
      chests: mine.chests || g.runStats.chests, elites: 0, dmg: mine.dmg || 0, runId: g.runId || null, wardens: p.wardens || 0, evolutions: mine.evolutions || g.evolved.length, bestNoHit: mine.bestNoHit || 0,
      weapons: mine.weapons || L.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })), passives: mine.passives || L.passives.map((x) => ({ id: x.id, level: x.level })),
    });
  }

  // ---------- per-frame hook for hosts ----------
  function tick(dt) {
    const g = game;
    if (!g || g.role !== 'host' || !room) return;
    if (g.state !== lastState) {
      if (lastState === 'levelup' && g.state === 'play' && UI.current() === 'scr-level') UI.show(null);
      lastState = g.state;
    }
    snapT += dt;
    if (snapT >= 1 / SNAP_HZ && !g.finished) {
      snapT = 0;
      room.send('snap', buildSnap(g));
    }
  }

  return {
    state, create, join, leave, start, tick, clientFrame,
    sendPick(c) { if (room) room.send('pick', { c }); },
    sendReroll() { if (room) room.send('reroll', {}); },
  };
})();
