'use strict';
/* Neon Swarm — one run of the game: simulation only, drawing lives in render.js */

const DEBUG = { bot: false, speed: 1, god: false, startAt: 0 };
const STEP = 1 / 60;
const MAX_PARTICLES = 400, MAX_TEXTS = 30, MAX_GEMS = 320;
const SPAWN_ROWS = SPAWN_TABLE.map(([t, w]) => [t, Object.entries(w)]);

class Game {
  constructor(opts) {
    this.hooks = opts.hooks || {};
    this.charId = opts.charId;
    this.char = CHARS[opts.charId];
    this.daily = !!opts.daily;
    this.mod = opts.daily ? (opts.resume && opts.resume.modId ? DAILY_MODS.find((m) => m.id === opts.resume.modId) : dailyMod()) : null;
    this.t = 0;
    this.clock = 0;
    this.acc = 0;
    this.kills = 0;
    this.goldRun = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForLevel(1);
    this.uid = 0;
    this.player = { x: 0, y: 0, vx: 0, vy: 0, r: 10, hp: 100, inv: 0, fx: 0, fy: -1, moving: false, hurtFlash: 0, trail: 0 };
    this.enemies = [];
    this.bullets = [];
    this.ebullets = [];
    this.pickups = [];
    this.particles = [];
    this.pPool = [];
    this.texts = [];
    this.fx = [];
    this.weapons = [];
    this.passives = [];
    this.hash = new SpatialHash(64);
    this.near = [];
    this.qbuf = [];
    this.ebuf = [];
    this.state = 'play';
    this.pendingLevels = 0;
    this.pendingChests = [];
    this.spawnAcc = 0;
    this.eventIdx = 0;
    this.nextElite = 200;
    this.boss = null;
    this.finalSpawned = false;
    this.shake = 0;
    this.flash = 0;
    this.timeScale = 1;
    this.endTimer = 0;
    this.banner = null;
    this.banners = [];
    this.gemCount = 0;
    this.gemStep = 0;
    this.gemStepT = 0;
    this.rerolls = 1 + shopRank('reroll');
    this.revives = shopRank('revival');
    this.lastHitT = 0;
    this.bestNoHit = 0;
    this.evolved = [];
    this.wardensKilled = 0;
    this.hint = save.seenTutorial ? 0 : 1;
    this.movedFor = 0;
    this.finished = false;
    this.cam = { x: 0, y: 0 };
    this.stats = null;
    this.recomputeStats();
    this.player.hp = this.stats.maxHp;
    if (opts.resume) {
      this.restore(opts.resume);
    } else {
      this.addWeapon(this.char.weapon);
      if (this.mod && this.mod.id === 'arsenal') {
        this.addWeapon(pick(Object.keys(WEAPONS).filter((id) => id !== this.char.weapon)));
        this.passives.push({ id: pick(Object.keys(PASSIVES)), level: 1 });
        this.recomputeStats();
      }
      if (DEBUG.startAt) this.skipTo(DEBUG.startAt);
      else this.openingWave();
    }
    this.cam.x = this.player.x;
    this.cam.y = this.player.y + View.h * 0.08;
  }

  // A loose ring of drones just off screen so the first kill happens within seconds.
  openingWave() {
    const R = Math.min(View.w, View.h) * 0.62;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rand(-0.2, 0.2);
      this.spawnEnemy('drone', { x: Math.cos(a) * R, y: Math.sin(a) * R + View.h * 0.08 });
    }
  }

  // ---------- stats ----------
  recomputeStats() {
    const s = {
      might: 1, area: 1, cdMul: 1, amount: 0, speed: 1, magnet: 1, maxHp: 100, regen: 0, armor: 0,
      xpMul: 1, goldMul: 1, projSpeed: 1, gameSpeed: 1, enemySpeed: 1, enemyHp: 1, enemyCount: 1, enemySize: 1, noHeal: false,
    };
    this.char.stats(s);
    s.might += 0.05 * shopRank('might');
    s.maxHp += 10 * shopRank('vitality');
    s.armor += 0.03 * shopRank('armor');
    s.regen += 0.1 * shopRank('recovery');
    s.speed += 0.04 * shopRank('haste');
    s.magnet += 0.1 * shopRank('magnet');
    s.cdMul *= 1 - 0.03 * shopRank('cooldown');
    s.xpMul += 0.06 * shopRank('growth');
    s.goldMul += 0.1 * shopRank('greed');
    for (const p of this.passives) PASSIVES[p.id].apply(s, p.level);
    if (this.mod) this.mod.apply(s);
    s.armor = Math.min(0.6, s.armor);
    s.maxHp = Math.round(s.maxHp);
    if (s.noHeal) s.regen = 0;
    const old = this.stats ? this.stats.maxHp : s.maxHp;
    this.stats = s;
    this.qpad = 32 * s.enemySize;
    if (s.maxHp > old) this.player.hp += s.maxHp - old;
    this.player.hp = Math.min(this.player.hp, s.maxHp);
  }

  ws(w) {
    const b = weaponStats(w.id, w.level, w.evo), s = this.stats;
    return {
      dmg: b.dmg * s.might, cd: (b.cd || 1) * s.cdMul, amount: (b.amount || 1) + s.amount, area: s.area,
      speed: (b.speed || 0) * s.projSpeed, pierce: b.pierce || 0, chains: b.chains || 0, range: b.range || 0,
      radius: b.radius || 0, kb: b.kb || 0, spin: b.spin || 0, bladeR: b.bladeR || 0, hitCd: b.hitCd || 0.4,
      width: b.width || 0, length: b.length || 0, size: b.size || 1, splash: b.splash || 0, heal: b.heal || 0,
    };
  }

  addWeapon(id) {
    this.weapons.push({ id, level: 1, evo: false, cd: 0.3, angle: 0, pos: null, br: 9 });
  }

  // ---------- loop ----------
  frame(dt) {
    this.clock += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.dur) this.banner = null;
    }
    if (!this.banner && this.banners.length) this.banner = this.banners.shift();
    if (this.hint > 0 && this.movedFor > 0.8) this.hint -= dt * 1.5;
    if (!this.running()) return;
    this.acc += dt * this.timeScale * this.stats.gameSpeed * DEBUG.speed;
    const maxSteps = 8 * Math.max(1, DEBUG.speed);
    let n = 0;
    while (this.acc >= STEP && n < maxSteps) {
      this.update(STEP);
      this.acc -= STEP;
      n++;
      if (!this.running()) {
        this.acc = 0;
        break;
      }
    }
    if (n >= maxSteps) this.acc = 0;
    if (this.state === 'dying' || this.state === 'victory') {
      this.endTimer -= dt * Math.max(1, DEBUG.speed);
      if (this.endTimer <= 0) this.finish(this.state === 'victory');
    }
  }

  running() {
    return this.state === 'play' || this.state === 'dying' || this.state === 'victory';
  }

  update(dt) {
    const playing = this.state === 'play';
    if (playing) this.t += dt;
    this.updatePlayer(dt, playing);
    this.rebuildHash();
    if (playing) {
      this.director(dt);
      this.updateWeapons(dt);
    }
    this.updateEnemies(dt, playing);
    this.updateBullets(dt);
    this.updateEBullets(dt, playing);
    this.updatePickups(dt, playing);
    this.updateFx(dt);
    this.sweep();
    const k = 1 - Math.exp(-dt * 9);
    this.cam.x += (this.player.x - this.cam.x) * k;
    this.cam.y += (this.player.y + View.h * 0.08 - this.cam.y) * k;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
    if (this.flash > 0) this.flash -= dt * 2.5;
    if (playing) {
      const clean = this.t - this.lastHitT;
      if (clean > this.bestNoHit) this.bestNoHit = clean;
      if (this.pendingChests.length) this.openChest();
      else if (this.pendingLevels > 0) this.openLevelUp();
    }
  }

  updatePlayer(dt, playing) {
    const p = this.player;
    let mx = 0, my = 0;
    if (playing) {
      if (DEBUG.bot) [mx, my] = this.botMove();
      else {
        const v = Input.vector();
        mx = v.x;
        my = v.y;
      }
    }
    const sp = PLAYER_SPEED * this.stats.speed;
    const k = 1 - Math.exp(-dt * 16);
    p.vx += (mx * sp - p.vx) * k;
    p.vy += (my * sp - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const m = Math.hypot(mx, my);
    p.moving = m > 0.15;
    if (p.moving) {
      p.fx = mx / m;
      p.fy = my / m;
      this.movedFor += dt;
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.035;
        this.particle(p.x - p.fx * 9, p.y - p.fy * 9, -p.fx * 40 + rand(-15, 15), -p.fy * 40 + rand(-15, 15), 0.3, 5, this.char.color);
      }
    }
    if (p.inv > 0) p.inv -= dt;
    if (p.hurtFlash > 0) p.hurtFlash -= dt;
    if (playing && this.stats.regen > 0) p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.regen * dt);
  }

  rebuildHash() {
    this.hash.clear();
    for (const e of this.enemies) if (!e.dead && !e.boss) this.hash.insert(e);
  }

  // Broad-phase query; bosses are not in the hash so they are always appended.
  query(x, y, r, buf) {
    this.hash.query(x, y, r + this.qpad, buf);
    if (this.boss && !this.boss.dead) buf.push(this.boss);
    return buf;
  }

  // ---------- spawning ----------
  director(dt) {
    const t = this.t;
    while (this.eventIdx < EVENTS.length && t >= EVENTS[this.eventIdx].t) this.runEvent(EVENTS[this.eventIdx++]);
    let rate, cap;
    if (this.finalSpawned) {
      rate = 1.5;
      cap = 40;
    } else {
      // Gentle start, steep finish: ~2.8/s at 1:00, ~8.4/s at 4:00, 20/s at 8:00.
      rate = (2 + 18 * Math.pow(Math.min(1, t / RUN_LENGTH), 1.5)) * this.stats.enemyCount;
      cap = Math.min(MAX_ENEMIES, (50 + t * 0.6) * this.stats.enemyCount);
      if (t >= this.nextElite) {
        this.nextElite += 30;
        this.spawnEnemy(this.pickType(), { elite: true });
      }
    }
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length < cap) this.spawnEnemy(this.finalSpawned ? 'drone' : this.pickType());
    }
  }

  pickType() {
    let row = SPAWN_ROWS[0][1];
    for (const [t0, entries] of SPAWN_ROWS) if (this.t >= t0) row = entries;
    return weightedPick(row);
  }

  spawnPoint(margin = 40) {
    const p = this.player, hw = View.w / 2 + margin, hh = View.h / 2 + margin;
    let side;
    if (p.moving && Math.random() < 0.55) {
      side = Math.abs(p.fx) > Math.abs(p.fy) ? (p.fx > 0 ? 1 : 3) : (p.fy > 0 ? 2 : 0);
    } else {
      side = randInt(0, 3);
    }
    let x, y;
    if (side === 0) { x = rand(-hw, hw); y = -hh; }
    else if (side === 1) { x = hw; y = rand(-hh, hh); }
    else if (side === 2) { x = rand(-hw, hw); y = hh; }
    else { x = -hw; y = rand(-hh, hh); }
    return [this.cam.x + x, this.cam.y + y];
  }

  spawnEnemy(type, o = {}) {
    const d = ENEMIES[type], s = this.stats, t = this.t;
    let x = o.x, y = o.y;
    if (x === undefined) [x, y] = this.spawnPoint();
    const elite = !!o.elite;
    const hp = d.hp * enemyHpMul(t) * s.enemyHp * (elite ? 8 : 1);
    const e = {
      id: ++this.uid, type, d, x, y, kx: 0, ky: 0,
      r: d.r * s.enemySize * (elite ? 1.5 : 1), hp, maxHp: hp,
      speed: d.speed * s.enemySpeed * (1 + t / 1600) * rand(0.9, 1.1) * (elite ? 0.9 : 1),
      dmg: d.dmg * (1 + t / 400) * (elite ? 1.5 : 1),
      xp: d.xp * (elite ? 12 : 1),
      flash: 0, elite, boss: false, tier: 0, dead: false, ang: rand(0, TAU), st: rand(0.6, 2.2), state: 0,
      tele: 0, charge: 0, dx: 0, dy: 0, bladeCd: 0, spin: SPINNERS.has(d.shape), fire: 0, spiral: 0,
    };
    this.enemies.push(e);
    return e;
  }

  spawnBoss(id, tier) {
    const d = BOSSES[id];
    const [x, y] = this.spawnPoint(20);
    const hp = d.hp[tier] * this.stats.enemyHp;
    const e = {
      id: ++this.uid, type: id, d, x, y, kx: 0, ky: 0, r: d.r, hp, maxHp: hp,
      speed: d.speed * this.stats.enemySpeed, dmg: d.dmg, xp: d.xp, flash: 0, elite: false, boss: true, tier,
      dead: false, ang: 0, st: 2.5, state: 0, tele: 0, charge: 0, dx: 0, dy: 0, bladeCd: 0, spin: true, fire: 0, spiral: 0,
    };
    this.enemies.push(e);
    this.boss = e;
    return e;
  }

  runEvent(ev) {
    if (ev.type === 'pack') {
      const [cx, cy] = this.spawnPoint(60);
      for (let i = 0; i < ev.n; i++) this.spawnEnemy(ev.enemy, { x: cx + rand(-45, 45), y: cy + rand(-45, 45) });
      if (ev.text) this.say(ev.text, { color: '#ff8a3c', small: true });
    } else if (ev.type === 'ring') {
      const p = this.player, R = Math.hypot(View.w, View.h) * 0.48;
      for (let i = 0; i < ev.n; i++) {
        const a = (i * TAU) / ev.n;
        this.spawnEnemy(ev.enemy, { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R });
      }
      if (ev.text) this.say(ev.text, { color: '#ff3d8b', small: true });
    } else if (ev.type === 'boss') {
      this.spawnBoss(ev.id, ev.tier);
      this.say(ev.tier ? 'THE WARDEN RETURNS' : 'THE WARDEN APPROACHES', { color: '#ff3d5a', sub: 'Defeat it for a chest' });
      Sound.play.warning();
      Sound.setIntensity(1);
    } else if (ev.type === 'final') {
      for (const e of this.enemies) if (!e.dead && !e.boss) this.poof(e);
      if (this.boss && !this.boss.dead) this.poof(this.boss);
      this.boss = null;
      this.spawnBoss('queen', 0);
      this.finalSpawned = true;
      this.flash = 0.5;
      this.say('THE HIVE QUEEN', { color: '#ffd447', sub: 'Destroy her to win', dur: 3 });
      Sound.play.warning();
      Sound.setIntensity(2);
    }
  }

  poof(e) {
    e.dead = true;
    for (let i = 0; i < 5; i++) this.particle(e.x, e.y, rand(-80, 80), rand(-80, 80), 0.4, 6, e.d.color);
  }

  // ---------- enemies ----------
  updateEnemies(dt, playing) {
    const p = this.player, near = this.near;
    const far = Math.hypot(View.w, View.h) * 0.75;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.bladeCd > 0) e.bladeCd -= dt;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      let mx = dx / d, my = dy / d, sp = playing ? e.speed : e.speed * 0.3;
      const ai = e.d.ai;
      if (ai === 'dash') {
        e.st -= dt;
        if (e.state === 0) {
          if (d < 240 && e.st <= 0 && playing) { e.state = 1; e.st = 0.6; e.dx = mx; e.dy = my; e.tele = 1; }
        } else if (e.state === 1) {
          sp = 0; mx = e.dx; my = e.dy;
          if (e.st <= 0) { e.state = 2; e.st = 0.42; e.tele = 0; }
        } else if (e.state === 2) {
          mx = e.dx; my = e.dy; sp = 250 * this.stats.enemySpeed;
          if (e.st <= 0) { e.state = 3; e.st = 0.6; }
        } else {
          sp *= 0.25;
          if (e.st <= 0) { e.state = 0; e.st = rand(1, 2); }
        }
      } else if (ai === 'shoot') {
        if (d < 140) { mx = -mx; my = -my; sp *= 0.7; }
        else if (d < 200) { const side = e.id % 2 ? 1 : -1, tx = -my * side; my = mx * side; mx = tx; sp *= 0.45; }
        e.st -= dt;
        if (e.st <= 0) {
          if (playing && d < 420) {
            this.enemyShoot(e.x, e.y, Math.atan2(dy, dx), 135, e.dmg);
            e.st = 2.8;
          } else e.st = 0.6;
        }
      } else if (ai === 'warden') {
        e.st -= dt;
        if (e.state === 0) {
          if (e.st <= 0 && playing) {
            if (e.tier >= 1 && Math.random() < 0.5) { e.state = 2; e.st = 0.8; e.charge = 1; }
            else { e.state = 1; e.st = 0.85; e.dx = mx; e.dy = my; e.tele = 1; }
          }
        } else if (e.state === 1) {
          sp = 0; mx = e.dx; my = e.dy;
          if (e.st <= 0) { e.state = 3; e.st = 0.65; e.tele = 0; }
        } else if (e.state === 3) {
          mx = e.dx; my = e.dy; sp = e.speed * 5.5;
          if (e.st <= 0) { e.state = 0; e.st = rand(2.2, 3.2); }
        } else if (e.state === 2) {
          sp *= 0.2;
          if (e.st <= 0) {
            const n = 8 + e.tier * 5, off = rand(0, TAU);
            for (let k = 0; k < n; k++) this.enemyShoot(e.x, e.y, off + (k * TAU) / n, 115, e.dmg * 0.7);
            e.state = 0; e.st = rand(2, 3); e.charge = 0;
          }
        }
      } else if (ai === 'queen') {
        const ph = e.hp / e.maxHp, rage = ph < 0.33 ? 2 : ph < 0.66 ? 1 : 0;
        e.fightT = (e.fightT || 0) + dt;
        if (rage > (e.phase || 0)) {
          // Phase change: shield up and call in the swarm.
          e.phase = rage;
          e.shieldT = 2.5;
          const n = 10 + rage * 4;
          for (let k = 0; k < n; k++) {
            const a = (k * TAU) / n;
            this.spawnEnemy(rage > 1 ? 'swarmer' : 'drone', { x: e.x + Math.cos(a) * 90, y: e.y + Math.sin(a) * 90 });
          }
          this.say(rage > 1 ? 'SHE IS ENRAGED' : 'THE SWARM ANSWERS', { color: '#ffd447', small: true });
          Sound.play.warning();
        }
        if (e.shieldT > 0) e.shieldT -= dt;
        // She keeps her distance at first, then closes in so short-range builds can reach her.
        const keep = Math.max(60, 170 - e.fightT * 1.6);
        if (e.state !== 3 && e.state !== 4) {
          if (d < keep) { mx = -mx; my = -my; }
          else if (d < keep + 60) { const tx = -my; my = mx; mx = tx; }
        }
        e.st -= dt;
        if (e.state === 0) {
          if (e.st <= 0 && playing) {
            const r = Math.random();
            if (r < 0.3) { e.state = 1; e.st = 2.2; e.spiral = rand(0, TAU); e.fire = 0; }
            else if (r < 0.5) { e.state = 2; e.st = 0.7; e.charge = 1; }
            else if (r < 0.75) { e.state = 5; e.st = 0.55; e.charge = 1; }
            else { e.state = 3; e.st = 0.9; e.dx = mx; e.dy = my; e.tele = 1; }
          }
        } else if (e.state === 1) {
          sp *= 0.4;
          e.fire -= dt;
          if (e.fire <= 0) {
            e.fire = 0.1 - rage * 0.02;
            const arms = 2 + rage;
            for (let k = 0; k < arms; k++) this.enemyShoot(e.x, e.y, e.spiral + (k * TAU) / arms, 110, e.dmg * 0.6);
            e.spiral += 0.32;
          }
          if (e.st <= 0) { e.state = 0; e.st = 1.6 - rage * 0.3; }
        } else if (e.state === 2) {
          sp = 0;
          if (e.st <= 0) {
            const n = 8 + rage * 4;
            for (let k = 0; k < n; k++) {
              const a = (k * TAU) / n;
              this.spawnEnemy(rage ? 'swarmer' : 'drone', { x: e.x + Math.cos(a) * 70, y: e.y + Math.sin(a) * 70 });
            }
            e.state = 0; e.st = 1.8; e.charge = 0;
          }
        } else if (e.state === 5) {
          sp *= 0.3;
          if (e.st <= 0) {
            const base = Math.atan2(dy, dx), n = 5 + rage * 2;
            for (let k = 0; k < n; k++) this.enemyShoot(e.x, e.y, base + (k - (n - 1) / 2) * 0.16, 160, e.dmg * 0.7);
            e.state = 0; e.st = 1.4 - rage * 0.25; e.charge = 0;
          }
        } else if (e.state === 3) {
          sp = 0; mx = e.dx; my = e.dy;
          if (e.st <= 0) { e.state = 4; e.st = 0.7; e.tele = 0; }
        } else if (e.state === 4) {
          mx = e.dx; my = e.dy; sp = e.speed * 6;
          if (e.st <= 0) { e.state = 0; e.st = 1.5; }
        }
      }

      if (!e.boss) {
        this.hash.query(e.x, e.y, e.r + 20, near);
        let sx = 0, sy = 0, n = 0;
        for (let j = 0; j < near.length && n < 6; j++) {
          const o = near[j];
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oy = e.y - o.y, rr = e.r + o.r, d2 = ox * ox + oy * oy;
          if (d2 < rr * rr) {
            const dd = Math.sqrt(d2) || 0.01, push = (rr - dd) / rr;
            sx += (ox / dd) * push;
            sy += (oy / dd) * push;
            n++;
          }
        }
        e.x += sx * 70 * dt;
        e.y += sy * 70 * dt;
      }
      e.x += (mx * sp + e.kx) * dt;
      e.y += (my * sp + e.ky) * dt;
      const kd = Math.exp(-dt * 7);
      e.kx *= kd;
      e.ky *= kd;
      e.ang = e.spin ? e.ang + dt * (e.boss ? 0.8 : 1.3) : Math.atan2(my, mx);
      if (d > far) this.relocate(e);
      else if (playing && d < e.r + p.r * 0.85 && p.inv <= 0) this.hurtPlayer(e.dmg);
    }
  }

  relocate(e) {
    const [x, y] = this.spawnPoint(e.boss ? 10 : 40);
    e.x = x;
    e.y = y;
    e.kx = e.ky = 0;
    if (e.d.ai !== 'chase') {
      e.state = 0;
      e.tele = 0;
      e.charge = 0;
      e.st = Math.max(e.st, 1);
    }
  }

  enemyShoot(x, y, ang, speed, dmg) {
    if (this.ebullets.length > 240) return;
    this.ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 5.5, life: 7, dmg });
    Sound.play.enemyShot();
  }

  updateEBullets(dt, playing) {
    const p = this.player, far = Math.hypot(View.w, View.h) * 0.8;
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const dx = b.x - p.x, dy = b.y - p.y, rr = b.r + p.r * 0.7;
      if (playing && p.inv <= 0 && dx * dx + dy * dy < rr * rr) {
        this.hurtPlayer(b.dmg);
        b.life = 0;
      }
      if (b.life <= 0 || Math.abs(dx) > far || Math.abs(dy) > far) removeAt(this.ebullets, i);
    }
  }

  // ---------- player damage ----------
  hurtPlayer(dmg) {
    const p = this.player;
    if (p.inv > 0 || this.state !== 'play' || DEBUG.god) return;
    p.hp -= dmg * (1 - this.stats.armor);
    p.inv = 0.55;
    p.hurtFlash = 0.18;
    this.lastHitT = this.t;
    this.shake = Math.min(14, this.shake + 7);
    Sound.play.hurt();
    for (let i = 0; i < 8; i++) this.particle(p.x, p.y, rand(-120, 120), rand(-120, 120), 0.35, 6, '#ff4b5c');
    if (p.hp <= 0) this.playerDown();
  }

  playerDown() {
    const p = this.player;
    if (this.revives > 0) {
      this.revives--;
      p.hp = this.stats.maxHp * 0.5;
      p.inv = 2.5;
      this.flash = 0.8;
      this.pushWave(p.x, p.y, 260, 600, '#6dff9a', 500);
      this.say('REVIVED', { color: '#6dff9a' });
      Sound.play.evolve();
      return;
    }
    p.hp = 0;
    this.state = 'dying';
    this.timeScale = 0.3;
    this.endTimer = 1.6;
    this.shake = 16;
    Input.reset();
    Sound.play.death();
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), v = rand(60, 260);
      this.particle(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, rand(0.5, 1.1), rand(5, 10), i % 3 ? this.char.color : '#ffffff');
    }
  }

  // ---------- weapons ----------
  updateWeapons(dt) {
    for (const w of this.weapons) WEAPON_FIRE[w.id](this, w, dt);
  }

  nearestEnemy(range = 1e9) {
    const p = this.player;
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  nearestTo(x, y, range, exclude) {
    const buf = this.query(x, y, range, this.qbuf);
    let best = null, bd = range * range;
    for (const e of buf) {
      if (e.dead || (exclude && exclude.includes(e))) continue;
      const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  randomEnemyNear(range) {
    const p = this.player, n = this.enemies.length;
    if (!n) return null;
    for (let tries = 0; tries < 14; tries++) {
      const e = this.enemies[(Math.random() * n) | 0];
      if (!e.dead && Math.abs(e.x - p.x) < View.w * 0.5 && Math.abs(e.y - p.y) < View.h * 0.42) return e;
    }
    return this.nearestEnemy(range);
  }

  fireBolt(x, y, ang, s, big) {
    const sp = s.speed;
    this.bullets.push({
      kind: 'bolt', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, sp, ang,
      r: 4 * s.size * Math.sqrt(s.area), dmg: s.dmg, pierce: s.pierce, life: 1.3, hit: [],
      color: big ? '#c8fbff' : '#39f3ff', big, size: Math.sqrt(s.area),
    });
  }

  damage(e, dmg, nx, ny, kb) {
    if (e.dead || e.shieldT > 0) return;
    const crit = Math.random() < 0.06;
    if (crit) dmg *= 2;
    e.hp -= dmg;
    e.flash = 0.08;
    if (kb && !e.boss) {
      const m = (e.d.kbRes || 1) * (e.elite ? 0.3 : 1);
      e.kx += nx * kb * m;
      e.ky += ny * kb * m;
    }
    if (save.settings.dmgNums && this.texts.length < MAX_TEXTS) {
      this.texts.push({ x: e.x + rand(-5, 5), y: e.y - e.r, s: String(Math.round(dmg)), crit, life: 0.6, max: 0.6 });
    }
    Sound.play.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  explode(x, y, radius, dmg, color, silent) {
    const buf = this.query(x, y, radius, this.ebuf);
    for (const e of buf) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, rr = radius + e.r;
      if (dx * dx + dy * dy < rr * rr) {
        const d = Math.hypot(dx, dy) || 1;
        this.damage(e, dmg, dx / d, dy / d, 90);
      }
    }
    this.fx.push({ kind: 'blast', x, y, r: radius, life: 0.3, max: 0.3, color });
    if (!silent) {
      Sound.play.boom();
      this.shake = Math.min(14, this.shake + 1.5);
    }
  }

  pushWave(x, y, radius, kb, color, dmg) {
    const buf = this.query(x, y, radius, this.ebuf);
    for (const e of buf) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > radius + e.r) continue;
      if (dmg) this.damage(e, dmg, dx / d, dy / d, kb);
      else if (!e.boss) {
        e.kx += (dx / d) * kb;
        e.ky += (dy / d) * kb;
      }
    }
    this.fx.push({ kind: 'ring', x, y, r: radius, life: 0.45, max: 0.45, color });
  }

  killEnemy(e) {
    e.dead = true;
    this.kills++;
    const n = e.boss ? 40 : e.elite ? 18 : Math.min(10, 4 + e.r * 0.3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(40, 180) * (e.boss ? 1.8 : 1);
      this.particle(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, rand(0.3, 0.6), rand(4, 8), e.d.color);
    }
    Sound.play.kill();
    if (e.boss) {
      this.killBoss(e);
      return;
    }
    this.dropGem(e.x, e.y, e.xp);
    if (Math.random() < 0.04) this.dropPickup('coin', e.x, e.y, 1);
    const r = Math.random();
    if (r < 0.004) { if (!this.stats.noHeal) this.dropPickup('heart', e.x, e.y, 0); }
    else if (r < 0.0065) this.dropPickup('vortex', e.x, e.y, 0);
    else if (r < 0.0078) this.dropPickup('bomb', e.x, e.y, 0);
    if (e.d.split) for (let i = 0; i < 3; i++) this.spawnEnemy(e.d.split, { x: e.x + rand(-10, 10), y: e.y + rand(-10, 10) });
    if (e.elite) {
      this.dropPickup('chest', e.x, e.y, 0);
      for (let i = 0; i < 5; i++) this.dropPickup('coin', e.x, e.y, 1);
    }
  }

  killBoss(e) {
    this.boss = null;
    this.shake = 18;
    this.flash = 0.6;
    Sound.play.boom();
    this.fx.push({ kind: 'ring', x: e.x, y: e.y, r: 160, life: 0.6, max: 0.6, color: e.d.color });
    if (e.d.ai === 'warden') {
      this.wardensKilled++;
      this.dropPickup('chest', e.x, e.y, 1);
      this.dropGem(e.x, e.y, e.xp);
      for (let i = 0; i < 8 + e.tier * 6; i++) this.dropPickup('coin', e.x, e.y, 1);
      Sound.setIntensity(0);
      this.say('WARDEN DESTROYED', { color: '#ffd447', small: true });
    } else {
      this.state = 'victory';
      this.timeScale = 0.35;
      this.endTimer = 2.8;
      for (const o of this.enemies) if (!o.dead) this.poof(o);
      for (let i = 0; i < 60; i++) {
        const a = rand(0, TAU), v = rand(80, 360);
        this.particle(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, rand(0.6, 1.4), rand(6, 12), i % 2 ? '#ffd447' : '#ffffff');
      }
      this.say('QUEEN SLAIN', { color: '#ffd447', dur: 3 });
      Sound.play.victory();
    }
  }

  // ---------- shots ----------
  updateBullets(dt) {
    const buf = this.qbuf;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.kind === 'missile') {
        if (!b.target || b.target.dead) b.target = this.nearestTo(b.x, b.y, 420, null);
        if (b.target) {
          const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
          let da = want - b.ang;
          da = (((da + Math.PI) % TAU) + TAU) % TAU - Math.PI;
          b.ang += clamp(da, -7 * dt, 7 * dt);
        }
        b.sp = Math.min(b.maxSp, b.sp + 600 * dt);
        b.x += Math.cos(b.ang) * b.sp * dt;
        b.y += Math.sin(b.ang) * b.sp * dt;
        b.trail = (b.trail || 0) - dt;
        if (b.trail <= 0) {
          b.trail = 0.03;
          this.particle(b.x, b.y, rand(-10, 10), rand(-10, 10), 0.25, 4, '#ffa94d');
        }
        let boom = b.life <= 0;
        if (!boom) {
          this.query(b.x, b.y, b.r, buf);
          for (const e of buf) {
            if (e.dead) continue;
            const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.r;
            if (dx * dx + dy * dy < rr * rr) { boom = true; break; }
          }
        }
        if (boom) {
          this.explode(b.x, b.y, b.radius, b.dmg, '#ffa94d');
          removeAt(this.bullets, i);
        }
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life > 0) {
        this.query(b.x, b.y, b.r, buf);
        for (const e of buf) {
          if (e.dead || b.hit.includes(e.id)) continue;
          const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.r;
          if (dx * dx + dy * dy < rr * rr) {
            b.hit.push(e.id);
            this.damage(e, b.dmg, b.vx / b.sp, b.vy / b.sp, 40);
            this.particle(b.x, b.y, -b.vx * 0.15 + rand(-30, 30), -b.vy * 0.15 + rand(-30, 30), 0.18, 4, b.color);
            if (--b.pierce < 0) { b.life = 0; break; }
          }
        }
      }
      if (b.life <= 0) removeAt(this.bullets, i);
    }
  }

  // ---------- pickups ----------
  dropGem(x, y, v) {
    if (this.gemCount >= MAX_GEMS) {
      for (let tries = 0; tries < 12; tries++) {
        const k = this.pickups[(Math.random() * this.pickups.length) | 0];
        if (k && k.kind === 'gem' && !k.attract) { k.v += v; return; }
      }
    }
    this.pickups.push({ kind: 'gem', x, y, v, vx: rand(-30, 30), vy: rand(-30, 30), attract: false, sp: 0, seed: rand(0, TAU) });
    this.gemCount++;
  }

  dropPickup(kind, x, y, v) {
    this.pickups.push({ kind, x: x + rand(-6, 6), y: y + rand(-6, 6), v, vx: rand(-70, 70), vy: rand(-70, 70), attract: false, sp: 0, seed: rand(0, TAU) });
  }

  updatePickups(dt, playing) {
    const p = this.player, pr = PICKUP_RADIUS * this.stats.magnet;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.vx || k.vy) {
        k.x += k.vx * dt;
        k.y += k.vy * dt;
        const d = Math.exp(-dt * 6);
        k.vx *= d;
        k.vy *= d;
        if (Math.abs(k.vx) < 2 && Math.abs(k.vy) < 2) k.vx = k.vy = 0;
      }
      if (!playing) continue;
      const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
      if (!k.attract) {
        const reach = k.kind === 'gem' || k.kind === 'coin' ? pr : 28;
        if (d2 < reach * reach) {
          k.attract = true;
          k.sp = -70;
        }
      } else {
        k.sp = Math.min(900, k.sp + 1500 * dt);
        const d = Math.sqrt(d2) || 1;
        k.x += (dx / d) * k.sp * dt;
        k.y += (dy / d) * k.sp * dt;
        if (d < p.r + 7) {
          removeAt(this.pickups, i);
          this.collect(k);
        }
      }
    }
  }

  collect(k) {
    const p = this.player;
    if (k.kind === 'gem') {
      this.gemCount--;
      this.addXp(k.v);
      if (this.clock - this.gemStepT > 0.5) this.gemStep = 0;
      this.gemStepT = this.clock;
      Sound.play.gem(this.gemStep++);
    } else if (k.kind === 'coin') {
      this.goldRun += k.v * this.stats.goldMul;
      Sound.play.coin();
    } else if (k.kind === 'heart') {
      p.hp = Math.min(this.stats.maxHp, p.hp + 30);
      this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: 50, life: 0.4, max: 0.4, color: '#6dff9a' });
      Sound.play.pickup();
    } else if (k.kind === 'vortex') {
      for (const q of this.pickups) {
        if (q.kind === 'gem' || q.kind === 'coin') {
          q.attract = true;
          q.sp = 150;
        }
      }
      this.say('VORTEX', { color: '#39f3ff', small: true, dur: 1.2 });
      Sound.play.pickup();
    } else if (k.kind === 'bomb') {
      this.flash = 0.8;
      this.shake = 14;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.abs(e.x - p.x) < View.w * 0.6 && Math.abs(e.y - p.y) < View.h * 0.6) this.damage(e, e.boss ? 250 : 1e6, 0, 0, 0);
      }
      Sound.play.boom();
    } else if (k.kind === 'chest') {
      this.pendingChests.push(k.v);
    }
  }

  addXp(v) {
    this.xp += v * this.stats.xpMul;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpForLevel(this.level);
      this.pendingLevels++;
    }
  }

  particle(x, y, vx, vy, life, size, color) {
    let q;
    if (this.particles.length >= MAX_PARTICLES) q = this.particles[(Math.random() * this.particles.length) | 0];
    else {
      q = this.pPool.pop() || {};
      this.particles.push(q);
    }
    q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.max = life; q.size = size; q.color = color;
  }

  updateFx(dt) {
    const drag = Math.exp(-dt * 3);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.pPool.push(q);
        removeAt(this.particles, i);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= drag;
      q.vy *= drag;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      if ((this.texts[i].life -= dt) <= 0) removeAt(this.texts, i);
    }
    const p = this.player;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (f.kind === 'nova') {
        f.x = p.x;
        f.y = p.y;
        f.r += f.speed * dt;
        const buf = this.query(f.x, f.y, f.r, this.ebuf);
        for (const e of buf) {
          if (e.dead || f.hit.has(e.id)) continue;
          const dx = e.x - f.x, dy = e.y - f.y, d = Math.hypot(dx, dy) || 1;
          if (d <= f.r + e.r) {
            f.hit.add(e.id);
            this.damage(e, f.dmg, dx / d, dy / d, f.kb);
            if (f.heal && f.healed < 15 && !this.stats.noHeal) {
              p.hp = Math.min(this.stats.maxHp, p.hp + f.heal);
              f.healed++;
            }
          }
        }
        if (f.r >= f.maxR) removeAt(this.fx, i);
      } else if ((f.life -= dt) <= 0) {
        removeAt(this.fx, i);
      }
    }
  }

  sweep() {
    for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) removeAt(this.enemies, i);
  }

  say(text, o = {}) {
    if (this.banners.length > 3) return;
    this.banners.push({ text, sub: o.sub || '', color: o.color, small: !!o.small, dur: o.dur || 2.2, t: 0 });
  }

  // ---------- level ups & chests ----------
  openLevelUp() {
    this.state = 'levelup';
    Input.reset();
    Sound.play.levelup();
    const choices = this.rollChoices();
    if (this.hooks.levelUp) this.hooks.levelUp(this, choices);
  }

  rollChoices(n = 3) {
    const pool = [];
    const ownedW = new Set(this.weapons.map((w) => w.id));
    const ownedP = new Map(this.passives.map((p) => [p.id, p]));
    for (const w of this.weapons) {
      if (w.evo) continue;
      if (w.level < weaponMax(w.id)) pool.push([{ kind: 'weapon', id: w.id, level: w.level + 1 }, 10]);
      else if (ownedP.has(WEAPONS[w.id].evo.with)) pool.push([{ kind: 'evo', id: w.id }, 16]);
    }
    if (this.weapons.length < MAX_WEAPONS) {
      for (const id in WEAPONS) if (!ownedW.has(id)) pool.push([{ kind: 'weapon', id, level: 1 }, 5]);
    }
    const wanted = new Set(this.weapons.filter((w) => !w.evo).map((w) => WEAPONS[w.id].evo.with));
    for (const p of this.passives) {
      if (p.level < PASSIVES[p.id].max) pool.push([{ kind: 'passive', id: p.id, level: p.level + 1 }, 8]);
    }
    if (this.passives.length < MAX_PASSIVES) {
      for (const id in PASSIVES) if (!ownedP.has(id)) pool.push([{ kind: 'passive', id, level: 1 }, wanted.has(id) ? 7 : 4]);
    }
    const out = [];
    while (out.length < n && pool.length) {
      const o = weightedPick(pool);
      out.push(o);
      pool.splice(pool.findIndex((e) => e[0] === o), 1);
    }
    if (out.length < n) out.push({ kind: 'heal' });
    if (out.length < n) out.push({ kind: 'gold' });
    return out;
  }

  applyChoice(o) {
    if (o.kind === 'weapon') {
      const w = this.weapons.find((x) => x.id === o.id);
      if (w) w.level++;
      else this.addWeapon(o.id);
    } else if (o.kind === 'passive') {
      const p = this.passives.find((x) => x.id === o.id);
      if (p) p.level++;
      else this.passives.push({ id: o.id, level: 1 });
      this.recomputeStats();
    } else if (o.kind === 'evo') {
      this.evolve(o.id);
    } else if (o.kind === 'heal') {
      if (this.stats.noHeal) this.goldRun += 20 * this.stats.goldMul;
      else this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.maxHp * 0.3);
    } else if (o.kind === 'gold') {
      this.goldRun += 25 * this.stats.goldMul;
    }
  }

  choose(o) {
    if (this.state !== 'levelup') return;
    this.applyChoice(o);
    this.pendingLevels--;
    this.pushWave(this.player.x, this.player.y, 150, 320, '#ffffff', 0);
    Sound.play.pick();
    this.state = 'play';
  }

  reroll() {
    if (this.state !== 'levelup' || this.rerolls <= 0) return null;
    this.rerolls--;
    return this.rollChoices();
  }

  evolve(id) {
    const w = this.weapons.find((x) => x.id === id);
    if (!w || w.evo) return;
    w.evo = true;
    w.level = weaponMax(id);
    w.cd = 0;
    this.evolved.push(id);
    if (!save.codex[id]) {
      save.codex[id] = true;
      writeSave();
    }
    this.flash = 0.7;
    this.say('EVOLUTION', { color: '#ffd447', sub: WEAPONS[id].evo.name });
    Sound.play.evolve();
  }

  canEvolve() {
    return this.weapons.filter((w) => !w.evo && w.level >= weaponMax(w.id) && this.passives.some((p) => p.id === WEAPONS[w.id].evo.with));
  }

  openChest() {
    const tier = this.pendingChests.shift();
    const reward = { evo: null, ups: [], gold: 0 };
    const eligible = this.canEvolve();
    if (eligible.length) {
      const w = pick(eligible);
      reward.evo = w.id;
      this.evolve(w.id);
    } else {
      const n = tier >= 1 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const c = this.rollChoices(1)[0];
        if (c.kind === 'heal' || c.kind === 'gold') break;
        this.applyChoice(c);
        reward.ups.push(c);
      }
    }
    reward.gold = Math.round((tier >= 1 ? 30 : 15) * this.stats.goldMul);
    this.goldRun += reward.gold;
    this.state = 'chest';
    Input.reset();
    Sound.play.chest();
    if (this.hooks.chest) this.hooks.chest(this, reward);
  }

  closeChest() {
    if (this.state === 'chest') this.state = 'play';
  }

  pause() {
    if (this.state === 'play') {
      this.state = 'paused';
      Input.reset();
      return true;
    }
    return false;
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'play';
      this.player.inv = Math.max(this.player.inv, 0.6);
    }
  }

  // ---------- end of run ----------
  finish(won, quit = false) {
    if (this.finished) return;
    this.finished = true;
    this.state = won ? 'won' : 'dead';
    const S = save.stats;
    const survival = Math.floor((this.t / 60) * 10 * this.stats.goldMul);
    let gold = Math.floor(this.goldRun) + survival + (won ? Math.round(150 * this.stats.goldMul) : 0);
    let dailyBonus = 0;
    if (this.daily) {
      dailyBonus = Math.round(gold * (0.5 + 0.1 * Math.min(5, Math.max(0, save.daily.streak - 1))));
      gold += dailyBonus;
      S.dailyRuns++;
      const k = todayKey();
      save.daily.best[k] = Math.max(save.daily.best[k] || 0, this.t);
    }
    const score = Math.floor(this.t * 10 + this.kills * 2 + this.level * 50 + (won ? 5000 : 0));
    const newBest = score > S.bestScore && S.runs > 0;
    S.kills += this.kills;
    S.runs++;
    S.totalGold += gold;
    S.wardens += this.wardensKilled;
    S.evolutions += this.evolved.length;
    if (won) S.queens++;
    S.bestTime = Math.max(S.bestTime, this.t);
    S.bestLevel = Math.max(S.bestLevel, this.level);
    S.bestKills = Math.max(S.bestKills, this.kills);
    S.bestNoHit = Math.max(S.bestNoHit, this.bestNoHit);
    S.bestScore = Math.max(S.bestScore, score);
    let unlockedPrism = false;
    if (won && !save.chars.prism) {
      save.chars.prism = true;
      unlockedPrism = true;
    }
    save.gold += gold;
    save.run = null;
    save.seenTutorial = true;
    writeSave();
    this.result = {
      won, quit, time: this.t, kills: this.kills, level: this.level, gold, dailyBonus, score, newBest, unlockedPrism,
      weapons: this.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })),
      passives: this.passives.map((p) => ({ id: p.id, level: p.level })),
    };
    if (this.hooks.over) this.hooks.over(this.result);
  }

  quit() {
    this.finish(false, true);
  }

  // ---------- resume support ----------
  snapshot() {
    if (this.finished || this.state === 'dying' || this.state === 'victory') return null;
    const b = this.boss && !this.boss.dead ? this.boss : null;
    return {
      charId: this.charId, daily: this.daily, modId: this.mod ? this.mod.id : null,
      t: this.t, kills: this.kills, goldRun: this.goldRun, level: this.level, xp: this.xp, hp: this.player.hp,
      weapons: this.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })),
      passives: this.passives.map((p) => ({ id: p.id, level: p.level })),
      rerolls: this.rerolls, revives: this.revives, eventIdx: this.eventIdx, nextElite: this.nextElite,
      wardens: this.wardensKilled, evolved: this.evolved.slice(), pendingLevels: this.pendingLevels,
      pendingChests: this.pendingChests.slice(), final: this.finalSpawned, bestNoHit: this.bestNoHit,
      boss: b ? { kind: b.type, tier: b.tier, hp: b.hp / b.maxHp } : null,
    };
  }

  restore(s) {
    this.t = s.t;
    this.kills = s.kills;
    this.goldRun = s.goldRun;
    this.level = s.level;
    this.xp = s.xp;
    this.xpNext = xpForLevel(s.level);
    this.weapons = [];
    for (const w of s.weapons) {
      this.addWeapon(w.id);
      const nw = this.weapons[this.weapons.length - 1];
      nw.level = w.level;
      nw.evo = w.evo;
    }
    this.passives = s.passives.map((p) => ({ id: p.id, level: p.level }));
    this.recomputeStats();
    this.player.hp = clamp(s.hp, 1, this.stats.maxHp);
    this.player.inv = 2;
    this.rerolls = s.rerolls;
    this.revives = s.revives;
    this.eventIdx = s.eventIdx;
    this.nextElite = s.nextElite;
    this.wardensKilled = s.wardens;
    this.evolved = s.evolved || [];
    this.pendingLevels = s.pendingLevels || 0;
    this.pendingChests = s.pendingChests || [];
    this.finalSpawned = !!s.final;
    this.bestNoHit = s.bestNoHit || 0;
    this.lastHitT = s.t;
    this.hint = 0;
    if (s.boss) {
      const b = this.spawnBoss(s.boss.kind, s.boss.tier);
      b.hp = b.maxHp * clamp(s.boss.hp, 0.05, 1);
      Sound.setIntensity(s.boss.kind === 'queen' ? 2 : 1);
    }
  }

  // Debug: jump ahead with a plausible build (used by ?t=minutes).
  skipTo(sec) {
    this.t = sec;
    while (this.eventIdx < EVENTS.length && EVENTS[this.eventIdx].t < sec) this.eventIdx++;
    this.nextElite = Math.max(200, sec + 5);
    const levels = Math.floor(sec / 18);
    for (let i = 0; i < levels; i++) {
      this.level++;
      this.applyChoice(this.botChoose(this.rollChoices()));
    }
    this.xpNext = xpForLevel(this.level);
    this.player.hp = this.stats.maxHp;
  }

  // ---------- autopilot for balance tests ----------
  botMove() {
    const p = this.player;
    let fx = 0, fy = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy, R = e.boss ? 260 : 170;
      if (d2 < R * R) {
        const w = ((e.boss ? 3 : 1) * (e.r / 10)) / (d2 + 50);
        fx += dx * w;
        fy += dy * w;
      }
    }
    for (const b of this.ebullets) {
      const dx = p.x - b.x, dy = p.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120) {
        const w = 2.5 / (d2 + 30);
        fx += dx * w;
        fy += dy * w;
      }
    }
    let best = null, bd = 320 * 320;
    for (const k of this.pickups) {
      const d2 = (k.x - p.x) ** 2 + (k.y - p.y) ** 2;
      if (d2 < bd) { bd = d2; best = k; }
    }
    if (best) {
      const d = Math.sqrt(bd) || 1;
      fx += ((best.x - p.x) / d) * 0.02;
      fy += ((best.y - p.y) / d) * 0.02;
    }
    const m = Math.hypot(fx, fy);
    return m < 1e-4 ? [0, 0] : [fx / m, fy / m];
  }

  botChoose(choices) {
    const rank = (c) => (c.kind === 'evo' ? 5 : c.kind === 'weapon' && c.level > 1 ? 4 : c.kind === 'weapon' && this.weapons.length < 3 ? 3.5 : c.kind === 'passive' ? 3 : c.kind === 'weapon' ? 2 : 1);
    return choices.slice().sort((a, b) => rank(b) - rank(a))[0];
  }
}

function jag(x1, y1, x2, y2, segs) {
  const pts = [x1, y1], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs, off = rand(-1, 1) * Math.min(18, len * 0.12);
    pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
  }
  pts.push(x2, y2);
  return pts;
}

const WEAPON_FIRE = {
  blaster(g, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const p = g.player, tgt = g.nearestEnemy(340);
    if (!tgt) { w.cd = 0.1; return; }
    const s = g.ws(w);
    let ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    if (w.evo) ang += rand(-0.07, 0.07);
    for (let i = 0; i < s.amount; i++) g.fireBolt(p.x, p.y, ang + (i - (s.amount - 1) / 2) * 0.14, s, w.evo);
    w.cd = s.cd;
    Sound.play.shoot();
  },

  blades(g, w, dt) {
    const s = g.ws(w), p = g.player;
    w.angle += s.spin * dt;
    const n = s.amount, R = s.radius * s.area, br = s.bladeR * Math.sqrt(s.area);
    w.br = br;
    if (!w.pos || w.pos.length !== n * 2) w.pos = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = w.angle + (i * TAU) / n, bx = p.x + Math.cos(a) * R, by = p.y + Math.sin(a) * R;
      w.pos[i * 2] = bx;
      w.pos[i * 2 + 1] = by;
      const buf = g.query(bx, by, br, g.qbuf);
      for (const e of buf) {
        if (e.dead || e.bladeCd > 0) continue;
        const dx = e.x - bx, dy = e.y - by, rr = e.r + br;
        if (dx * dx + dy * dy < rr * rr) {
          e.bladeCd = s.hitCd;
          const ex = e.x - p.x, ey = e.y - p.y, el = Math.hypot(ex, ey) || 1;
          g.damage(e, s.dmg, ex / el, ey / el, s.kb);
        }
      }
    }
  },

  lightning(g, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(w);
    let any = false;
    for (let k = 0; k < s.amount; k++) {
      const first = g.randomEnemyNear(420);
      if (!first) break;
      any = true;
      const hit = [first];
      g.fx.push({ kind: 'bolt', pts: jag(first.x + rand(-40, 40), first.y - 260, first.x, first.y, 7), life: 0.2, max: 0.2, color: '#7db8ff' });
      g.damage(first, s.dmg, 0, 0, 0);
      if (s.splash) g.explode(first.x, first.y, s.splash * s.area, s.dmg * 0.5, '#7db8ff', true);
      let cur = first;
      for (let c = 0; c < s.chains; c++) {
        const next = g.nearestTo(cur.x, cur.y, s.range * s.area, hit);
        if (!next) break;
        hit.push(next);
        g.fx.push({ kind: 'bolt', pts: jag(cur.x, cur.y, next.x, next.y, 5), life: 0.18, max: 0.18, color: '#7db8ff' });
        g.damage(next, s.dmg * 0.8, 0, 0, 0);
        cur = next;
      }
    }
    w.cd = any ? s.cd : 0.2;
    if (any) Sound.play.zap();
  },

  missiles(g, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const p = g.player, tgt = g.randomEnemyNear(500);
    if (!tgt) { w.cd = 0.2; return; }
    const s = g.ws(w), base = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    for (let i = 0; i < s.amount; i++) {
      g.bullets.push({
        kind: 'missile', x: p.x, y: p.y, ang: base + (i - (s.amount - 1) / 2) * 0.7 + rand(-0.15, 0.15),
        sp: 90, maxSp: s.speed, r: 5, dmg: s.dmg, radius: s.radius * s.area, life: 2.6,
        target: i === 0 ? tgt : g.randomEnemyNear(500), trail: 0,
      });
    }
    w.cd = s.cd;
    Sound.play.launch();
  },

  nova(g, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(w), p = g.player;
    g.fx.push({
      kind: 'nova', x: p.x, y: p.y, r: 8, maxR: s.radius * s.area, speed: 420, dmg: s.dmg, kb: s.kb,
      heal: s.heal, healed: 0, hit: new Set(), color: w.evo ? '#ffd0f5' : '#ff7ae0', life: 1, max: 1,
    });
    w.cd = s.cd;
    g.shake = Math.min(14, g.shake + 2);
    Sound.play.nova();
  },

  laser(g, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const p = g.player, tgt = g.nearestEnemy(600);
    if (!tgt) { w.cd = 0.2; return; }
    const s = g.ws(w), base = Math.atan2(tgt.y - p.y, tgt.x - p.x), half = (s.width * Math.sqrt(s.area)) / 2;
    for (let i = 0; i < s.amount; i++) {
      const a = base + (i * TAU) / s.amount, ca = Math.cos(a), sa = Math.sin(a);
      const ex = p.x + ca * s.length, ey = p.y + sa * s.length;
      for (const e of g.enemies) {
        if (e.dead) continue;
        const rr = half + e.r;
        if (distToSegment2(e.x, e.y, p.x, p.y, ex, ey) < rr * rr) g.damage(e, s.dmg, ca, sa, 60);
      }
      g.fx.push({ kind: 'beam', x: p.x, y: p.y, ang: a, len: s.length, w: half * 2, life: 0.25, max: 0.25, color: w.evo ? '#ffffff' : '#e9e4ff' });
    }
    w.cd = s.cd;
    g.shake = Math.min(14, g.shake + 1.5);
    Sound.play.laser();
  },
};
