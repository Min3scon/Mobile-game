'use strict';
/* Neon Swarm — one run of the game. Simulation only: drawing is in render.js, networking in coop.js.
   Every player is a "ship" with its own weapons, passives, stats and pets. Solo runs have one ship. */

const DEBUG = { bot: false, speed: 1, god: false, startAt: 0 };
const STEP = 1 / 60;
const MAX_PARTICLES = 400, MAX_TEXTS = 30, MAX_GEMS = 320;
const SPAWN_ROWS = SPAWN_TABLE.map(([t, w]) => [t, Object.entries(w)]);
const ENEMY_KEYS = Object.keys(ENEMIES).concat(Object.keys(BOSSES));

function baseStats() {
  return {
    might: 1, area: 1, cdMul: 1, amount: 0, speed: 1, magnet: 1, maxHp: 100, regen: 0, armor: 0,
    xpMul: 1, goldMul: 1, projSpeed: 1, crit: 0.06, critMul: 2, maxWeapons: MAX_WEAPONS, heartMul: 1,
    gameSpeed: 1, enemySpeed: 1, enemyHp: 1, enemyCount: 1, enemySize: 1, noHeal: false,
  };
}

class Game {
  constructor(opts) {
    this.hooks = opts.hooks || {};
    this.role = opts.role || 'solo'; // solo | host | client
    this.mode = opts.mode || 'normal'; // normal | daily | duel | coop
    this.daily = this.mode === 'daily';
    this.sector = clamp(opts.sector || 1, 1, SECTORS.length - 1);
    this.seed = opts.seed >>> 0 || (Math.random() * 4294967296) >>> 0;
    const modId = opts.resume ? opts.resume.modId : opts.modId;
    this.mod = this.daily ? DAILY_MODS.find((m) => m.id === modId) || dailyMod() : null;
    this.t = 0;
    this.clock = 0;
    this.acc = 0;
    this.kills = 0;
    this.spawned = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForLevel(1);
    this.sealSet();
    this.uid = 0;
    this.enemies = [];
    this.bullets = [];
    this.ebullets = [];
    this.pickups = [];
    this.mines = [];
    this.zones = [];
    this.particles = [];
    this.pPool = [];
    this.texts = [];
    this.fx = [];
    this.netEvents = [];
    this.hash = new SpatialHash(64);
    this.near = [];
    this.qbuf = [];
    this.ebuf = [];
    this.state = 'play';
    this.pendingLevels = 0;
    this.pickTimer = 0;
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
    this.rerollCount = 0;
    this.evolved = [];
    this.wardensKilled = 0;
    this.runStats = { chests: 0, elites: 0, dmg: 0, beacons: 0 };
    this.protoPool = opts.protocols || [];
    this.protoPicks = 0;
    this.protoOffers = null;
    this.pendingProto = false;
    this.beacon = null;
    this.nextBeacon = BEACON_FIRST;
    this.chainQ = [];
    this.hitstop = 0;
    this.level20At = 0;
    this.evoReady = new Set();
    this.supplyAt = 0;
    this.hint = save.seenTutorial ? 0 : 1;
    this.movedFor = 0;
    this.finished = false;
    this.cam = { x: 0, y: 0 };
    this.ships = (opts.ships || [{ id: 'p1', charId: 'volt' }]).map((s, i) => this.makeShip(s, i));
    this.local = this.ships.find((s) => s.id === opts.localId) || this.ships[0];
    this.world = this.makeWorld();
    for (const sh of this.ships) {
      this.recomputeStats(sh);
      sh.hp = sh.stats.maxHp;
    }
    if (opts.resume) {
      this.restore(opts.resume);
    } else {
      for (const sh of this.ships) {
        this.addWeapon(sh, sh.char.weapon);
        if (sh.char.passive) this.addPassive(sh, sh.char.passive);
        if (this.mod && this.mod.id === 'arsenal') {
          this.addWeapon(sh, pick(Object.keys(WEAPONS).filter((id) => id !== sh.char.weapon)));
          this.addPassive(sh, pick(Object.keys(PASSIVES).filter((id) => id !== sh.char.passive)));
        }
      }
      if (DEBUG.startAt) this.skipTo(DEBUG.startAt);
      else if (this.role !== 'client') this.openingWave();
      this.pendingProto = this.role === 'solo' && this.protoPool.length > 0;
    }
    this.sealSet();
    this.cam.x = this.local.x;
    this.cam.y = this.local.y + View.h * 0.08;
  }

  // Masked copies of the counters the server checks. Editing one in memory (debugger, extension)
  // leaves its copy behind, and the run is not posted.
  sealSet() {
    if (!this.seal) this.seal = { m: (Math.random() * 0x7fffffff) | 0 };
    const S = this.seal;
    S.k = this.kills ^ S.m;
    S.l = this.level ^ S.m;
    S.s = this.spawned ^ S.m;
  }

  sealOk() {
    const S = this.seal;
    return (S.k ^ S.m) === this.kills && (S.l ^ S.m) === this.level && (S.s ^ S.m) === this.spawned && this.kills <= this.spawned;
  }

  // Compatibility views of the local player for UI and rendering code.
  get player() { return this.local; }
  get weapons() { return this.local.weapons; }
  get passives() { return this.local.passives; }
  get stats() { return this.local.stats; }
  get char() { return this.local.char; }
  get rerolls() { return this.local.rerolls; }
  get goldRun() { return this.local.gold; }
  get coop() { return this.ships.length > 1; }

  makeShip(spec, i) {
    const char = CHARS[spec.charId] || CHARS.volt;
    const meta = spec.meta || { shop: {}, mastery: 1, pets: [] };
    const a = (i * TAU) / 4;
    return {
      id: spec.id, name: spec.name || char.name, charId: char === CHARS[spec.charId] ? spec.charId : 'volt', char, meta,
      x: i ? Math.cos(a) * 40 : 0, y: i ? Math.sin(a) * 40 : 0, vx: 0, vy: 0, r: 10,
      hp: 100, inv: 0, fx: 0, fy: -1, moving: false, hurtFlash: 0, trail: 0,
      weapons: [], passives: [], stats: null,
      rerolls: 1 + (meta.shop.reroll || 0), revives: meta.shop.revival || 0,
      input: { x: 0, y: 0 }, net: null, down: false, reviveT: 0, shield: 0, shieldT: 4,
      phoenix: (meta.pets || []).some((p) => p.id === 'phoenix') ? 1 : 0,
      gold: 0, dmgDealt: 0, lastHitT: 0, bestNoHit: 0, pick: null, chests: 0,
      protos: new Set(), banished: new Set(), banishes: 2, leechN: 0, pulseT: 10,
      pets: (meta.pets || []).filter((p) => PETS[p.id]).map((p, k) => ({ id: p.id, stars: clamp(p.stars || 1, 1, PET_MAX_STARS), x: 0, y: 0, cd: 1.5 + k, ang: k * Math.PI })),
    };
  }

  makeWorld() {
    const sec = SECTORS[this.sector];
    const w = { enemyHp: sec.hp, enemySpeed: sec.speed, enemyDmg: sec.dmg, enemyCount: 1, enemySize: 1, gameSpeed: 1, noHeal: false, reward: sec.reward };
    if (this.mod) {
      const s = baseStats();
      this.mod.apply(s);
      w.enemyHp *= s.enemyHp;
      w.enemySpeed *= s.enemySpeed;
      w.enemyCount = s.enemyCount;
      w.enemySize = s.enemySize;
      w.gameSpeed = s.gameSpeed;
      w.noHeal = s.noHeal;
    }
    const extra = this.ships.length - 1;
    if (extra > 0) {
      w.enemyCount *= 1 + 0.55 * extra;
      w.enemyHp *= 1 + 0.3 * extra;
    }
    return w;
  }

  // ---------- stats ----------
  recomputeStats(sh) {
    const s = baseStats();
    const R = (id) => sh.meta.shop[id] || 0;
    sh.char.stats(s);
    s.might += 0.05 * R('might');
    s.maxHp += 10 * R('vitality');
    s.armor += 0.03 * R('armor');
    s.regen += 0.1 * R('recovery');
    s.speed += 0.04 * R('haste');
    s.magnet += 0.1 * R('magnet');
    s.cdMul *= 1 - 0.025 * R('cooldown');
    s.xpMul += 0.06 * R('growth');
    s.goldMul += 0.1 * R('greed');
    s.crit += 0.02 * R('crit');
    s.projSpeed += 0.06 * R('velocity');
    s.maxWeapons += R('arsenal');
    s.heartMul += 0.5 * R('medic');
    const m = (sh.meta.mastery || 1) - 1;
    s.might += 0.02 * m;
    s.maxHp += 2 * m;
    for (const p of sh.pets) if (PETS[p.id].stat) PETS[p.id].stat(s, p.stars);
    for (const p of sh.passives) PASSIVES[p.id].apply(s, p.level);
    for (const id of sh.protos) if (PROTOCOLS[id].stats) PROTOCOLS[id].stats(s);
    if (this.mod) this.mod.apply(s);
    s.armor = Math.min(0.6, s.armor);
    s.crit = Math.min(0.6, s.crit);
    s.maxHp = Math.round(Math.max(20, s.maxHp));
    if (this.world.noHeal) s.regen = 0;
    const old = sh.stats ? sh.stats.maxHp : s.maxHp;
    sh.stats = s;
    if (s.maxHp > old) sh.hp += s.maxHp - old;
    sh.hp = Math.min(sh.hp, s.maxHp);
    this.qpad = 32 * this.world.enemySize;
  }

  ws(sh, w) {
    const b = weaponStats(w.id, w.level, w.evo), s = sh.stats;
    return {
      dmg: b.dmg * s.might, cd: (b.cd || 1) * s.cdMul, amount: (b.amount || 1) + s.amount, area: s.area,
      speed: (b.speed || 0) * s.projSpeed, pierce: b.pierce || 0, chains: b.chains || 0, range: b.range || 0,
      radius: b.radius || 0, kb: b.kb || 0, spin: b.spin || 0, bladeR: b.bladeR || 0, hitCd: b.hitCd || 0.4,
      width: b.width || 0, length: b.length || 0, size: b.size || 1, splash: b.splash || 0, heal: b.heal || 0,
      life: b.life || 0, tick: b.tick || 0.5, maxMines: b.maxMines || 8, chain: b.chain || 0, ring: b.ring || 0,
    };
  }

  addWeapon(sh, id) {
    sh.weapons.push({ id, level: 1, evo: false, cd: 0.3, angle: 0, pos: null, br: 9 });
  }

  addPassive(sh, id) {
    if (!id || sh.passives.some((p) => p.id === id)) return;
    sh.passives.push({ id, level: 1 });
    this.recomputeStats(sh);
  }

  // A loose ring of drones just off screen so the first kill happens within seconds.
  openingWave() {
    const R = Math.min(View.w, View.h) * 0.62;
    for (let i = 0; i < 8 * this.ships.length; i++) {
      const a = (i / 8) * TAU + rand(-0.2, 0.2);
      this.spawnEnemy('drone', { x: Math.cos(a) * R, y: Math.sin(a) * R + View.h * 0.08 });
    }
  }

  ev(...a) {
    if (this.role === 'host') this.netEvents.push(a);
  }

  alive() {
    return this.ships.filter((s) => !s.down);
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
    if (this.role === 'client') {
      Coop.clientFrame(this, dt);
      return;
    }
    if (this.state === 'levelup' && this.coop) {
      this.pickTimer -= dt;
      if (this.pickTimer <= 0) for (const sh of this.ships) if (sh.pick) this.choose(sh.pick[0], sh);
    }
    if (!this.running()) return;
    // A few frames of freeze sell the big hits (elite and boss kills, evolutions).
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    this.acc += dt * this.timeScale * this.world.gameSpeed * DEBUG.speed;
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
    for (const sh of this.ships) this.updateShip(sh, dt, playing);
    this.rebuildHash();
    if (playing) {
      this.director(dt);
      for (const sh of this.ships) {
        if (sh.down) continue;
        for (const w of sh.weapons) WEAPON_FIRE[w.id](this, sh, w, dt);
        for (const pet of sh.pets) PET_ACT[pet.id](this, sh, pet, dt);
        if (sh.protos.size) this.protoTick(sh, dt);
      }
      for (let n = 0; n < 8 && this.chainQ.length; n++) {
        const c = this.chainQ.shift();
        this.explode(c.x, c.y, c.r, c.dmg, '#ff8a3c', true, c.sh);
      }
      if (this.role === 'solo') this.updateBeacon(dt);
      if (this.supplyAt && this.t >= this.supplyAt) this.supplyDrop();
    }
    this.updateEnemies(dt, playing);
    this.updateBullets(dt);
    this.updateEBullets(dt, playing);
    this.updateMines(dt);
    this.updateZones(dt);
    this.updatePickups(dt, playing);
    this.updateFx(dt);
    this.sweep();
    this.follow(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
    if (this.flash > 0) this.flash -= dt * 2.5;
    if (playing) {
      for (const sh of this.ships) {
        const clean = this.t - sh.lastHitT;
        if (clean > sh.bestNoHit) sh.bestNoHit = clean;
      }
      if (this.pendingProto) this.openProtocol();
      else if (this.pendingChest) this.openChest();
      else if (this.pendingLevels > 0) this.openLevelUp();
    }
  }

  // ---------- protocols ----------
  openProtocol() {
    this.pendingProto = false;
    const sh = this.local, pool = this.protoPool.filter((id) => PROTOCOLS[id] && !sh.protos.has(id));
    if (!pool.length || !this.hooks.protocol) return;
    // Seeded like level-ups, so duel opponents get the same offers.
    const rng = mulberry32(this.seed ^ 0x51ed27 ^ Math.imul(this.protoPicks + 1, 40503));
    const offers = [];
    while (offers.length < 3 && pool.length) offers.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    this.protoOffers = offers;
    this.state = 'proto';
    Input.reset();
    Sound.play.levelup();
    this.hooks.protocol(this, offers);
  }

  chooseProtocol(id) {
    if (this.state !== 'proto') return;
    if (!this.protoOffers.includes(id)) id = this.protoOffers[0];
    this.protoOffers = null;
    this.protoPicks++;
    this.addProtocol(this.local, id);
    const d = PROTOCOLS[id];
    this.say(d.name.toUpperCase(), { color: d.color, sub: 'Protocol online', small: true });
    Sound.play.pick();
    this.state = 'play';
  }

  addProtocol(sh, id) {
    if (!PROTOCOLS[id] || sh.protos.has(id)) return;
    sh.protos.add(id);
    if (id === 'heart') sh.revives++;
    if (id === 'midas') this.world.enemyHp *= 1.15;
    this.recomputeStats(sh);
  }

  protoTick(sh, dt) {
    if (sh.protos.has('pulse') && (sh.pulseT -= dt) <= 0) {
      sh.pulseT = 10;
      for (const q of this.pickups) {
        if (q.kind === 'gem' && !q.attract && Math.abs(q.x - sh.x) < View.w * 0.75 && Math.abs(q.y - sh.y) < View.h * 0.75) {
          q.attract = sh;
          q.sp = 150;
        }
      }
      this.pushWave(sh.x, sh.y, 150, 260, PROTOCOLS.pulse.color, 25 * sh.stats.might * (1 + this.t / 240), sh);
    }
  }

  // ---------- beacons ----------
  updateBeacon(dt) {
    const L = this.local;
    if (!this.beacon) {
      if (this.t >= this.nextBeacon && this.t < RUN_LENGTH - 30 && !this.boss && !L.down) this.spawnBeacon();
      return;
    }
    const b = this.beacon, inside = !L.down && (L.x - b.x) ** 2 + (L.y - b.y) ** 2 < b.r * b.r;
    b.t += dt;
    if (b.kind === 'uplink') {
      b.prog = clamp(b.prog + (inside ? dt / BEACON_HOLD : -dt / (BEACON_HOLD * 2)), 0, 1);
      if (b.prog >= 1) this.beaconReward(b);
      else if (b.t > 35 && b.prog === 0) this.endBeacon();
    } else if (!b.active) {
      if (inside) {
        b.active = true;
        b.left = BEACON_PURGE_TIME;
        b.kills0 = this.kills;
        this.say('PURGE', { color: '#ff4b5c', sub: `Destroy ${b.need} enemies in ${BEACON_PURGE_TIME} seconds`, small: true });
        Sound.play.levelup();
      } else if (b.t > 35) this.endBeacon();
    } else {
      b.left -= dt;
      b.got = this.kills - b.kills0;
      if (b.got >= b.need) {
        this.dropPickup('chest', L.x + rand(-40, 40), L.y - 60, 0);
        this.say('PURGE COMPLETE', { color: '#ffd447', sub: 'A chest dropped', small: true });
        this.runStats.beacons++;
        Sound.play.chest();
        this.endBeacon();
      } else if (b.left <= 0) {
        this.say('PURGE FAILED', { color: '#ff4b5c', small: true, dur: 1.4 });
        this.endBeacon();
      }
    }
  }

  spawnBeacon() {
    const L = this.local, a = rand(0, TAU), d = rand(320, 440);
    const kind = this.t > 90 && Math.random() < 0.45 ? 'purge' : 'uplink';
    this.beacon = { kind, x: L.x + Math.cos(a) * d, y: L.y + Math.sin(a) * d, r: kind === 'uplink' ? 62 : 48, t: 0, prog: 0, active: false, left: 0, got: 0, need: Math.round(25 + this.t * 0.2) };
    this.say(kind === 'uplink' ? 'UPLINK DETECTED' : 'PURGE BEACON', { color: kind === 'uplink' ? '#39f3ff' : '#ff4b5c', sub: kind === 'uplink' ? 'Hold position inside it for a reward' : 'Touch it to start a challenge', small: true, dur: 1.8 });
  }

  beaconReward(b) {
    const L = this.local, gifts = ['xp', 'gold', 'reroll', 'magnet'];
    if (!this.world.noHeal && L.hp < L.stats.maxHp * 0.7) gifts.push('heal', 'heal');
    const g = pick(gifts);
    let sub = '';
    if (g === 'heal') { L.hp = Math.min(L.stats.maxHp, L.hp + L.stats.maxHp * 0.4); sub = 'Hull repaired'; }
    else if (g === 'gold') { const n = Math.round(25 * L.stats.goldMul * this.world.reward); L.gold += n; sub = `+${n} gold`; }
    else if (g === 'reroll') { L.rerolls++; sub = '+1 reroll'; }
    else if (g === 'magnet') { this.collect({ kind: 'vortex' }, L); sub = 'Every gem is coming to you'; }
    else { for (let i = 0; i < 6; i++) this.dropGem(b.x + rand(-30, 30), b.y + rand(-30, 30), Math.ceil(this.xpNext * 0.12)); sub = 'Data cache: XP'; }
    this.pushWave(b.x, b.y, 170, 400, '#39f3ff', 0);
    this.say('UPLINK COMPLETE', { color: '#39f3ff', sub, small: true });
    this.runStats.beacons++;
    Sound.play.evolve();
    this.endBeacon();
  }

  endBeacon() {
    this.beacon = null;
    this.nextBeacon = this.t + rand(BEACON_GAP[0], BEACON_GAP[1]);
  }

  // Tell the player when a weapon is ready to evolve, and send an elite their way soon.
  checkEvoReady(sh) {
    if (sh !== this.local) return;
    for (const w of this.canEvolve(sh)) {
      if (this.evoReady.has(w.id)) continue;
      this.evoReady.add(w.id);
      this.say('EVOLUTION READY', { color: '#ffd447', sub: `A supply chest is on its way`, small: true, dur: 2.6 });
      if (!this.supplyAt) this.supplyAt = this.t + 5;
    }
  }

  // A chest lands near you a few seconds after a weapon is ready to evolve.
  supplyDrop() {
    this.supplyAt = 0;
    if (!this.canEvolve(this.local).length || this.finished) return;
    const L = this.local, a = rand(0, TAU);
    this.addPickup('chest', L.x + Math.cos(a) * 150, L.y + Math.sin(a) * 150, 0, 0);
    this.ring(L.x + Math.cos(a) * 150, L.y + Math.sin(a) * 150, 60, '#ffd447');
    this.say('SUPPLY DROP', { color: '#ffd447', sub: 'Grab the chest to evolve', small: true, dur: 1.8 });
    Sound.play.chest();
  }

  updateShip(sh, dt, playing) {
    let mx = 0, my = 0;
    if (playing && !sh.down) {
      if (sh === this.local) {
        if (DEBUG.bot) [mx, my] = this.botMove(sh);
        else {
          const v = Input.vector();
          mx = v.x;
          my = v.y;
        }
      } else if (sh.net) {
        // Remote players own their position; ease toward the last reported spot.
        const k = 1 - Math.exp(-dt * 14);
        sh.x += (sh.net.x - sh.x) * k;
        sh.y += (sh.net.y - sh.y) * k;
        sh.fx = sh.net.fx;
        sh.fy = sh.net.fy;
        sh.moving = sh.net.moving;
      }
    }
    if (sh === this.local || !sh.net) this.moveShip(sh, mx, my, dt);
    this.shipTrail(sh, dt);
    if (sh.inv > 0) sh.inv -= dt;
    if (sh.hurtFlash > 0) sh.hurtFlash -= dt;
    if (!playing) return;
    if (sh.down) {
      // Teammates revive a downed ship by standing next to it.
      const helper = this.ships.some((o) => o !== sh && !o.down && Math.hypot(o.x - sh.x, o.y - sh.y) < 48);
      sh.reviveT = helper ? sh.reviveT + dt : Math.max(0, sh.reviveT - dt * 0.5);
      if (sh.reviveT >= 2.5) {
        sh.down = false;
        sh.reviveT = 0;
        sh.hp = sh.stats.maxHp * 0.4;
        sh.inv = 2;
        this.ring(sh.x, sh.y, 60, '#6dff9a');
        this.say(sh.name + ' is back!', { color: '#6dff9a', small: true });
      }
      return;
    }
    if (sh.stats.regen > 0) sh.hp = Math.min(sh.stats.maxHp, sh.hp + sh.stats.regen * dt);
    if (sh.pets.some((p) => p.id === 'shieldbit') && !sh.shield) {
      sh.shieldT -= dt;
      if (sh.shieldT <= 0) sh.shield = 1;
    }
  }

  moveShip(sh, mx, my, dt) {
    const sp = PLAYER_SPEED * sh.stats.speed;
    const k = 1 - Math.exp(-dt * 16);
    sh.vx += (mx * sp - sh.vx) * k;
    sh.vy += (my * sp - sh.vy) * k;
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    const m = Math.hypot(mx, my);
    sh.moving = m > 0.15;
    if (sh.moving) {
      sh.fx = mx / m;
      sh.fy = my / m;
      if (sh === this.local) this.movedFor += dt;
    }
  }

  shipTrail(sh, dt) {
    if (!sh.moving || sh.down) return;
    sh.trail -= dt;
    if (sh.trail <= 0) {
      sh.trail = 0.035;
      const tr = TRAILS[sh.meta.trail], color = tr ? tr.colors[(sh.trailK = (sh.trailK || 0) + 1) % tr.colors.length] : sh.char.color;
      this.particle(sh.x - sh.fx * 9, sh.y - sh.fy * 9, -sh.fx * 40 + rand(-15, 15), -sh.fy * 40 + rand(-15, 15), 0.3, 5, color);
    }
  }

  // The camera follows you, or a living teammate while you are down.
  follow(dt) {
    const L = this.local, alive = this.alive();
    const t = L.down && alive.length ? alive[0] : L;
    const k = 1 - Math.exp(-dt * 9);
    this.cam.x += (t.x - this.cam.x) * k;
    this.cam.y += (t.y + View.h * 0.08 - this.cam.y) * k;
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

  nearestShip(x, y) {
    let best = null, bd = Infinity;
    for (const sh of this.ships) {
      if (sh.down) continue;
      const d = (sh.x - x) ** 2 + (sh.y - y) ** 2;
      if (d < bd) { bd = d; best = sh; }
    }
    return best || this.ships[0];
  }

  // ---------- spawning ----------
  director(dt) {
    const t = this.t, W = this.world;
    while (this.eventIdx < EVENTS.length && t >= EVENTS[this.eventIdx].t) this.runEvent(EVENTS[this.eventIdx++]);
    let rate, cap;
    if (this.finalSpawned) {
      rate = 1.5 * W.enemyCount;
      cap = 40 * W.enemyCount;
    } else {
      // Gentle start, steep finish: ~2.8/s at 1:00, ~8.4/s at 4:00, 20/s at 8:00.
      rate = (2 + 18 * Math.pow(Math.min(1, t / RUN_LENGTH), 1.5)) * W.enemyCount;
      cap = Math.min(MAX_ENEMIES, (50 + t * 0.6) * W.enemyCount);
      if (t >= this.nextElite) {
        this.nextElite += this.ships.some((sh) => sh.protos.has('hunter')) ? 15 : 30;
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

  spawnPoint(margin = 40, sh) {
    const alive = this.alive();
    const p = sh || (alive.length ? alive[(Math.random() * alive.length) | 0] : this.ships[0]);
    const cx = p.x, cy = p.y + View.h * 0.08;
    const hw = View.w / 2 + margin, hh = View.h / 2 + margin;
    let side;
    if (p.moving && Math.random() < 0.55) side = Math.abs(p.fx) > Math.abs(p.fy) ? (p.fx > 0 ? 1 : 3) : (p.fy > 0 ? 2 : 0);
    else side = randInt(0, 3);
    let x, y;
    if (side === 0) { x = rand(-hw, hw); y = -hh; }
    else if (side === 1) { x = hw; y = rand(-hh, hh); }
    else if (side === 2) { x = rand(-hw, hw); y = hh; }
    else { x = -hw; y = rand(-hh, hh); }
    return [cx + x, cy + y];
  }

  spawnEnemy(type, o = {}) {
    const d = ENEMIES[type], W = this.world, t = this.t;
    let x = o.x, y = o.y;
    if (x === undefined) [x, y] = this.spawnPoint();
    const elite = !!o.elite;
    const hp = d.hp * enemyHpMul(t) * W.enemyHp * (elite ? 8 : 1);
    const e = {
      id: ++this.uid, type, d, x, y, kx: 0, ky: 0,
      r: d.r * W.enemySize * (elite ? 1.5 : 1), hp, maxHp: hp,
      speed: d.speed * W.enemySpeed * (1 + t / 1600) * rand(0.9, 1.1) * (elite ? 0.9 : 1),
      dmg: d.dmg * (1 + t / 400) * W.enemyDmg * (elite ? 1.5 : 1),
      xp: d.xp * (elite ? 12 : 1),
      flash: 0, elite, boss: false, tier: 0, dead: false, ang: rand(0, TAU), st: rand(0.6, 2.2), state: 0,
      tele: 0, charge: 0, dx: 0, dy: 0, bladeCd: 0, slowT: 0, spin: SPINNERS.has(d.shape), fire: 0, spiral: 0, shieldT: 0,
    };
    this.enemies.push(e);
    this.spawned++;
    this.seal.s = this.spawned ^ this.seal.m;
    return e;
  }

  spawnBoss(id, tier) {
    const d = BOSSES[id];
    const [x, y] = this.spawnPoint(20);
    const hp = d.hp[tier] * this.world.enemyHp;
    const e = {
      id: ++this.uid, type: id, d, x, y, kx: 0, ky: 0, r: d.r, hp, maxHp: hp,
      speed: d.speed * this.world.enemySpeed, dmg: d.dmg * this.world.enemyDmg, xp: d.xp, flash: 0, elite: false, boss: true, tier,
      dead: false, ang: 0, st: 2.5, state: 0, tele: 0, charge: 0, dx: 0, dy: 0, bladeCd: 0, slowT: 0, spin: true, fire: 0, spiral: 0,
      phase: 0, shieldT: 0, fightT: 0,
    };
    this.enemies.push(e);
    this.spawned++;
    this.seal.s = this.spawned ^ this.seal.m;
    this.boss = e;
    return e;
  }

  runEvent(ev) {
    if (ev.type === 'pack') {
      const [cx, cy] = this.spawnPoint(60);
      const n = Math.round(ev.n * this.world.enemyCount);
      for (let i = 0; i < n; i++) this.spawnEnemy(ev.enemy, { x: cx + rand(-45, 45), y: cy + rand(-45, 45) });
      if (ev.text) this.say(ev.text, { color: '#ff8a3c', small: true });
    } else if (ev.type === 'ring') {
      const alive = this.alive(), p = alive.length ? pick(alive) : this.local, R = Math.hypot(View.w, View.h) * 0.48;
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
      this.ev('snd', 'warning');
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
      this.ev('snd', 'warning');
    }
  }

  poof(e) {
    e.dead = true;
    this.burst(e.x, e.y, 5, e.d.color, 80);
  }

  burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(speed * 0.3, speed);
      this.particle(x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.3, 0.6), rand(4, 8), color);
    }
    this.ev('k', Math.round(x), Math.round(y), n, color, speed);
  }

  ring(x, y, r, color) {
    this.fx.push({ kind: 'ring', x, y, r, life: 0.45, max: 0.45, color });
    this.ev('r', Math.round(x), Math.round(y), r, color);
  }

  // ---------- enemies ----------
  updateEnemies(dt, playing) {
    const near = this.near;
    const far = Math.hypot(View.w, View.h) * 0.75;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.bladeCd > 0) e.bladeCd -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      const p = this.nearestShip(e.x, e.y);
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      let mx = dx / d, my = dy / d, sp = playing ? e.speed : e.speed * 0.3;
      if (e.slowT > 0) sp *= 0.5;
      const ai = e.d.ai;
      if (ai === 'dash') {
        e.st -= dt;
        if (e.state === 0) {
          if (d < 240 && e.st <= 0 && playing) { e.state = 1; e.st = 0.6; e.dx = mx; e.dy = my; e.tele = 1; }
        } else if (e.state === 1) {
          sp = 0; mx = e.dx; my = e.dy;
          if (e.st <= 0) { e.state = 2; e.st = 0.42; e.tele = 0; }
        } else if (e.state === 2) {
          mx = e.dx; my = e.dy; sp = 250 * this.world.enemySpeed;
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
        e.fightT += dt;
        if (rage > e.phase) {
          // Phase change: shield up and call in the swarm.
          e.phase = rage;
          e.shieldT = 2.5;
          const n = (10 + rage * 4) * this.ships.length;
          for (let k = 0; k < n; k++) {
            const a = (k * TAU) / n;
            this.spawnEnemy(rage > 1 ? 'swarmer' : 'drone', { x: e.x + Math.cos(a) * 90, y: e.y + Math.sin(a) * 90 });
          }
          this.say(rage > 1 ? 'SHE IS ENRAGED' : 'THE SWARM ANSWERS', { color: '#ffd447', small: true });
          Sound.play.warning();
          this.ev('snd', 'warning');
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
      if (d > far && this.ships.every((s) => Math.hypot(s.x - e.x, s.y - e.y) > far)) this.relocate(e);
      else if (playing && !p.down && d < e.r + p.r * 0.85 && p.inv <= 0) this.hurtShip(p, e.dmg);
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
    const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    this.ebullets.push({ x, y, vx, vy, r: 5.5, life: 7, dmg });
    this.ev('eb', Math.round(x), Math.round(y), Math.round(vx), Math.round(vy));
    Sound.play.enemyShot();
  }

  updateEBullets(dt, playing) {
    const far = Math.hypot(View.w, View.h) * 0.8;
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let gone = b.life <= 0, nearAny = false;
      for (const sh of this.ships) {
        const dx = b.x - sh.x, dy = b.y - sh.y;
        if (Math.abs(dx) < far && Math.abs(dy) < far) nearAny = true;
        const rr = b.r + sh.r * 0.7;
        if (playing && !gone && !sh.down && sh.inv <= 0 && dx * dx + dy * dy < rr * rr) {
          this.hurtShip(sh, b.dmg);
          gone = true;
        }
      }
      if (gone || !nearAny) removeAt(this.ebullets, i);
    }
  }

  // ---------- player damage ----------
  hurtShip(sh, dmg) {
    if (sh.inv > 0 || sh.down || this.state !== 'play' || DEBUG.god) return;
    if (sh.shield) {
      sh.shield = 0;
      sh.shieldT = 13 - (sh.pets.find((p) => p.id === 'shieldbit') || { stars: 1 }).stars;
      sh.inv = 0.5;
      this.ring(sh.x, sh.y, 30, '#7db8ff');
      return;
    }
    sh.hp -= dmg * (1 - sh.stats.armor);
    sh.inv = sh.protos.has('ghost') ? 1.1 : 0.55;
    sh.hurtFlash = 0.18;
    sh.lastHitT = this.t;
    if (sh === this.local) {
      this.shake = Math.min(14, this.shake + 7);
      Sound.play.hurt();
    }
    this.ev('h', sh.id);
    for (let i = 0; i < 8; i++) this.particle(sh.x, sh.y, rand(-120, 120), rand(-120, 120), 0.35, 6, '#ff4b5c');
    if (sh.hp <= 0) this.shipDown(sh);
  }

  shipDown(sh) {
    if (sh.phoenix > 0 || sh.revives > 0) {
      if (sh.phoenix > 0) sh.phoenix--;
      else sh.revives--;
      sh.hp = sh.stats.maxHp * (sh.phoenix >= 0 && sh.revives >= 0 ? 0.6 : 0.5);
      sh.inv = 2.5;
      if (sh === this.local) this.flash = 0.8;
      const big = sh.protos.has('heart');
      this.pushWave(sh.x, sh.y, big ? 640 : 260, 600, '#6dff9a', big ? 3000 : 500, sh);
      this.say(this.coop ? sh.name + ' revived' : 'REVIVED', { color: '#6dff9a' });
      Sound.play.evolve();
      return;
    }
    sh.hp = 0;
    sh.down = true;
    sh.reviveT = 0;
    this.burst(sh.x, sh.y, 30, sh.char.color, 260);
    if (this.alive().length) {
      this.say(sh.name + ' is down! Stand next to them', { color: '#ff4b5c', small: true, dur: 3 });
      return;
    }
    this.state = 'dying';
    this.timeScale = 0.3;
    this.endTimer = 1.6;
    this.shake = 16;
    Input.reset();
    Sound.play.death();
    this.ev('snd', 'death');
  }

  // ---------- targeting helpers ----------
  nearestEnemy(sh, range = 1e9) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - sh.x, dy = e.y - sh.y, d2 = dx * dx + dy * dy;
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

  randomEnemyNear(sh, range) {
    const n = this.enemies.length;
    if (!n) return null;
    for (let tries = 0; tries < 14; tries++) {
      const e = this.enemies[(Math.random() * n) | 0];
      if (!e.dead && Math.abs(e.x - sh.x) < View.w * 0.5 && Math.abs(e.y - sh.y) < View.h * 0.42) return e;
    }
    return this.nearestEnemy(sh, range);
  }

  fireBolt(sh, ang, s, big, color) {
    const sp = s.speed, c = color || (big ? '#c8fbff' : '#39f3ff');
    const b = {
      kind: 'bolt', x: sh.x, y: sh.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, sp, ang,
      r: 4 * s.size * Math.sqrt(s.area), dmg: s.dmg, pierce: s.pierce, life: 1.3, hit: [], color: c, big, size: Math.sqrt(s.area), sh,
    };
    this.bullets.push(b);
    this.ev('b', Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), c, big ? 1 : 0, +b.size.toFixed(2));
    if (sh.protos && sh.protos.has('echo') && !this.echoing && Math.random() < 0.25) {
      this.echoing = true;
      this.fireBolt(sh, ang + rand(-0.22, 0.22), s, big, color);
      this.echoing = false;
    }
  }

  damage(e, dmg, nx, ny, kb, sh) {
    if (e.dead || e.shieldT > 0) return;
    const st = sh ? sh.stats : null;
    const crit = Math.random() < (st ? st.crit : 0.06);
    if (crit) dmg *= st ? st.critMul : 2;
    // The Queen cracks the longer she fights, so weak builds still finish in a few minutes.
    if (e.d.ai === 'queen') dmg *= 1 + Math.pow(e.fightT / 40, 1.5);
    const real = Math.min(dmg, e.hp);
    e.hp -= dmg;
    e.flash = 0.08;
    if (sh) {
      sh.dmgDealt += real;
      if (sh === this.local) this.runStats.dmg += real;
    }
    if (kb && !e.boss) {
      const m = (e.d.kbRes || 1) * (e.elite ? 0.3 : 1);
      e.kx += nx * kb * m;
      e.ky += ny * kb * m;
    }
    if (save.settings.dmgNums && this.texts.length < MAX_TEXTS && (!sh || sh === this.local)) {
      this.texts.push({ x: e.x + rand(-5, 5), y: e.y - e.r, s: String(Math.round(dmg)), crit, life: 0.6, max: 0.6 });
    }
    Sound.play.hit();
    if (e.hp <= 0) this.killEnemy(e, sh);
  }

  explode(x, y, radius, dmg, color, silent, sh) {
    const buf = this.query(x, y, radius, this.ebuf);
    for (let i = 0; i < buf.length; i++) {
      const e = buf[i];
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, rr = radius + e.r;
      if (dx * dx + dy * dy < rr * rr) {
        const d = Math.hypot(dx, dy) || 1;
        this.damage(e, dmg, dx / d, dy / d, 90, sh);
      }
    }
    this.fx.push({ kind: 'blast', x, y, r: radius, life: 0.3, max: 0.3, color });
    this.ev('x', Math.round(x), Math.round(y), Math.round(radius), color);
    if (!silent) {
      Sound.play.boom();
      this.shake = Math.min(14, this.shake + 1.5);
    }
  }

  pushWave(x, y, radius, kb, color, dmg, sh) {
    const buf = this.query(x, y, radius, this.ebuf).slice();
    for (const e of buf) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d > radius + e.r) continue;
      if (dmg) this.damage(e, dmg, dx / d, dy / d, kb, sh);
      else if (!e.boss) {
        e.kx += (dx / d) * kb;
        e.ky += (dy / d) * kb;
      }
    }
    this.ring(x, y, radius, color);
  }

  killEnemy(e, sh) {
    e.dead = true;
    this.kills++;
    this.seal.k = this.kills ^ this.seal.m;
    this.burst(e.x, e.y, e.boss ? 40 : e.elite ? 18 : Math.min(10, Math.round(4 + e.r * 0.3)), e.d.color, e.boss ? 320 : 180);
    Sound.play.kill();
    if (e.boss) {
      this.killBoss(e);
      return;
    }
    this.dropGem(e.x, e.y, e.xp);
    const owner = sh || this.local, P = owner.protos;
    if (Math.random() < (P.has('midas') ? 0.08 : 0.04)) this.dropPickup('coin', e.x, e.y, 1);
    if (P.has('chain') && Math.random() < 0.3 && this.chainQ.length < 24) {
      this.chainQ.push({ x: e.x, y: e.y, r: 34 + e.r * 1.5, dmg: Math.min(e.maxHp * 0.6, 40 + this.t * 0.6) * owner.stats.might, sh: owner });
    }
    if (P.has('leech') && ++owner.leechN >= 50) {
      owner.leechN = 0;
      if (!this.world.noHeal && !owner.down) {
        owner.hp = Math.min(owner.stats.maxHp, owner.hp + 5);
        this.ring(owner.x, owner.y, 34, PROTOCOLS.leech.color);
      }
    }
    const r = Math.random(), heart = 0.004 * (sh ? sh.stats.heartMul : 1);
    if (r < heart) { if (!this.world.noHeal) this.dropPickup('heart', e.x, e.y, 0); }
    else if (r < heart + 0.0025) this.dropPickup('vortex', e.x, e.y, 0);
    else if (r < heart + 0.0038) this.dropPickup('bomb', e.x, e.y, 0);
    if (e.d.split) for (let i = 0; i < 3; i++) this.spawnEnemy(e.d.split, { x: e.x + rand(-10, 10), y: e.y + rand(-10, 10) });
    if (e.elite) {
      this.runStats.elites++;
      this.hitstop = 0.06;
      this.dropPickup('chest', e.x, e.y, 0);
      for (let i = 0; i < 5; i++) this.dropPickup('coin', e.x, e.y, 1);
    }
  }

  killBoss(e) {
    this.boss = null;
    this.hitstop = 0.12;
    this.shake = 18;
    this.flash = 0.6;
    Sound.play.boom();
    this.ring(e.x, e.y, 160, e.d.color);
    if (e.d.ai === 'warden') {
      this.wardensKilled++;
      this.dropPickup('chest', e.x, e.y, 1);
      if (e.tier === 1 && this.role === 'solo' && this.protoPool.length) this.pendingProto = true;
      this.dropGem(e.x, e.y, e.xp);
      for (let i = 0; i < 8 + e.tier * 6; i++) this.dropPickup('coin', e.x, e.y, 1);
      Sound.setIntensity(0);
      this.say('WARDEN DESTROYED', { color: '#ffd447', small: true });
    } else {
      this.state = 'victory';
      this.timeScale = 0.35;
      this.endTimer = 2.8;
      for (const o of this.enemies) if (!o.dead) this.poof(o);
      this.burst(e.x, e.y, 60, '#ffd447', 360);
      this.say('QUEEN SLAIN', { color: '#ffd447', dur: 3 });
      Sound.play.victory();
      this.ev('snd', 'victory');
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
        b.trail -= dt;
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
          this.explode(b.x, b.y, b.radius, b.dmg, '#ffa94d', false, b.sh);
          removeAt(this.bullets, i);
        }
        continue;
      }
      if (b.kind === 'glaive') {
        const sh = b.sh;
        if (b.out) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.dist += b.sp * dt;
          if (b.dist >= b.range) { b.out = false; b.hit.length = 0; }
        } else {
          const dx = sh.x - b.x, dy = sh.y - b.y, d = Math.hypot(dx, dy) || 1;
          const sp = b.sp * 1.25;
          b.x += (dx / d) * sp * dt;
          b.y += (dy / d) * sp * dt;
          if (d < 16 || b.life <= 0) { removeAt(this.bullets, i); continue; }
        }
        b.ang += dt * 14;
        this.query(b.x, b.y, b.r, buf);
        for (const e of buf) {
          if (e.dead || b.hit.includes(e.id)) continue;
          const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.r;
          if (dx * dx + dy * dy < rr * rr) {
            b.hit.push(e.id);
            this.damage(e, b.dmg, dx / (Math.hypot(dx, dy) || 1), dy / (Math.hypot(dx, dy) || 1), 70, sh);
          }
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
            this.damage(e, b.dmg, b.vx / b.sp, b.vy / b.sp, 40, b.sh);
            this.particle(b.x, b.y, -b.vx * 0.15 + rand(-30, 30), -b.vy * 0.15 + rand(-30, 30), 0.18, 4, b.color);
            if (--b.pierce < 0) { b.life = 0; break; }
          }
        }
      }
      if (b.life <= 0) removeAt(this.bullets, i);
    }
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.arm -= dt;
      m.life -= dt;
      let boom = m.life <= 0 || m.trip;
      if (!boom && m.arm <= 0) {
        const buf = this.query(m.x, m.y, 24, this.qbuf);
        for (const e of buf) {
          if (!e.dead && (e.x - m.x) ** 2 + (e.y - m.y) ** 2 < (24 + e.r) ** 2) { boom = true; break; }
        }
      }
      if (!boom) continue;
      removeAt(this.mines, i);
      this.ev('mx', m.id);
      this.explode(m.x, m.y, m.radius, m.dmg, '#ffe066', this.mines.length > 6, m.sh);
      if (m.chain) {
        for (const o of this.mines) if (o.sh === m.sh && (o.x - m.x) ** 2 + (o.y - m.y) ** 2 < (m.radius * 1.2) ** 2) o.trip = true;
      }
    }
  }

  addZone(x, y, r, life, dmg, tick, color, sh) {
    if (this.zones.length > 160) return;
    this.zones.push({ x, y, r, life, max: life, dmg, tick, tickT: 0, color, sh });
    this.ev('z', Math.round(x), Math.round(y), Math.round(r), +life.toFixed(2), color);
  }

  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      if (z.life <= 0) { removeAt(this.zones, i); continue; }
      z.tickT -= dt;
      if (z.tickT > 0) continue;
      z.tickT = z.tick;
      const buf = this.query(z.x, z.y, z.r, this.qbuf);
      for (let k = 0; k < buf.length; k++) {
        const e = buf[k];
        if (!e.dead && (e.x - z.x) ** 2 + (e.y - z.y) ** 2 < (z.r + e.r) ** 2) this.damage(e, z.dmg, 0, 0, 0, z.sh);
      }
    }
  }

  // ---------- pickups ----------
  dropGem(x, y, v) {
    if (this.gemCount >= MAX_GEMS) {
      for (let tries = 0; tries < 12; tries++) {
        const k = this.pickups[(Math.random() * this.pickups.length) | 0];
        if (k && k.kind === 'gem' && !k.attract) {
          k.v += v;
          this.ev('gv', k.id, k.v);
          return;
        }
      }
    }
    this.addPickup('gem', x, y, v, 30);
    this.gemCount++;
  }

  dropPickup(kind, x, y, v) {
    this.addPickup(kind, x + rand(-6, 6), y + rand(-6, 6), v, 70);
  }

  addPickup(kind, x, y, v, spread) {
    const k = { id: ++this.uid, kind, x, y, v, vx: rand(-spread, spread), vy: rand(-spread, spread), attract: null, sp: 0, seed: rand(0, TAU) };
    this.pickups.push(k);
    this.ev('p+', k.id, kind, Math.round(x), Math.round(y), v, Math.round(k.vx), Math.round(k.vy));
  }

  updatePickups(dt, playing) {
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
      if (!k.attract) {
        const sh = this.nearestShip(k.x, k.y);
        if (sh.down) continue;
        const reach = k.kind === 'gem' || k.kind === 'coin' ? PICKUP_RADIUS * sh.stats.magnet : 28;
        if ((sh.x - k.x) ** 2 + (sh.y - k.y) ** 2 < reach * reach) {
          k.attract = sh;
          k.sp = -70;
        }
      } else {
        const sh = k.attract.down ? this.nearestShip(k.x, k.y) : k.attract;
        k.sp = Math.min(900, k.sp + 1500 * dt);
        const dx = sh.x - k.x, dy = sh.y - k.y, d = Math.hypot(dx, dy) || 1;
        k.x += (dx / d) * k.sp * dt;
        k.y += (dy / d) * k.sp * dt;
        if (d < sh.r + 7) {
          removeAt(this.pickups, i);
          this.ev('p-', k.id);
          this.collect(k, sh);
        }
      }
    }
  }

  collect(k, sh) {
    if (k.kind === 'gem') {
      this.gemCount--;
      this.addXp(k.v);
      if (sh === this.local) {
        if (this.clock - this.gemStepT > 0.5) this.gemStep = 0;
        this.gemStepT = this.clock;
        Sound.play.gem(this.gemStep++);
      }
    } else if (k.kind === 'coin') {
      // Coins are shared: every player gets the gold.
      for (const s of this.ships) s.gold += k.v * s.stats.goldMul * this.world.reward;
      if (sh === this.local) Sound.play.coin();
    } else if (k.kind === 'heart') {
      sh.hp = Math.min(sh.stats.maxHp, sh.hp + 30);
      this.ring(sh.x, sh.y, 50, '#6dff9a');
      if (sh === this.local) Sound.play.pickup();
    } else if (k.kind === 'vortex') {
      for (const q of this.pickups) {
        if (q.kind === 'gem' || q.kind === 'coin') {
          q.attract = this.nearestShip(q.x, q.y);
          q.sp = 150;
        }
      }
      this.say('VORTEX', { color: '#39f3ff', small: true, dur: 1.2 });
      Sound.play.pickup();
    } else if (k.kind === 'bomb') {
      this.flash = 0.8;
      this.shake = 14;
      for (const e of this.enemies.slice()) {
        if (e.dead) continue;
        if (Math.abs(e.x - sh.x) < View.w * 0.6 && Math.abs(e.y - sh.y) < View.h * 0.6) this.damage(e, e.boss ? 250 : 1e6, 0, 0, 0, sh);
      }
      Sound.play.boom();
      this.ev('snd', 'boom');
    } else if (k.kind === 'chest') {
      this.pendingChest = { tier: k.v, sh };
    }
  }

  addXp(v) {
    let mul = 1;
    for (const s of this.ships) mul = Math.max(mul, s.stats.xpMul);
    this.xp += v * mul;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.seal.l = this.level ^ this.seal.m;
      if (this.level === 20 && !this.level20At) this.level20At = this.t;
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
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (f.kind === 'nova') {
        const sh = f.sh;
        if (sh) { f.x = sh.x; f.y = sh.y; }
        f.r += f.speed * dt;
        if (this.role !== 'client' && f.hit) {
          const buf = this.query(f.x, f.y, f.r, this.ebuf);
          for (let k = 0; k < buf.length; k++) {
            const e = buf[k];
            if (e.dead || f.hit.has(e.id)) continue;
            const dx = e.x - f.x, dy = e.y - f.y, d = Math.hypot(dx, dy) || 1;
            if (d <= f.r + e.r) {
              f.hit.add(e.id);
              this.damage(e, f.dmg, dx / d, dy / d, f.kb, sh);
              if (f.heal && f.healed < 15 && !this.world.noHeal) {
                sh.hp = Math.min(sh.stats.maxHp, sh.hp + f.heal);
                f.healed++;
              }
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
    this.ev('say', text, o.sub || '', o.color || '', o.small ? 1 : 0, o.dur || 2.2);
  }

  // ---------- level ups & chests ----------
  openLevelUp() {
    this.state = 'levelup';
    Input.reset();
    Sound.play.levelup();
    this.pickTimer = 20;
    for (const sh of this.ships) sh.pick = this.rollChoices(sh);
    if (this.hooks.levelUp) this.hooks.levelUp(this, this.local.pick);
    if (this.hooks.netLevelUp) this.hooks.netLevelUp(this);
  }

  // Offers are seeded by run seed, level and reroll count so duel opponents see the same cards.
  rollChoices(sh, n = 3) {
    const rng = mulberry32(this.seed ^ Math.imul(this.level, 7919) ^ Math.imul(this.rerollCount + 1, 104729) ^ hashStr(sh.id));
    const pool = [];
    const ownedW = new Set(sh.weapons.map((w) => w.id));
    const ownedP = new Map(sh.passives.map((p) => [p.id, p]));
    const banned = (kind, id) => sh.banished.has(kind + ':' + id);
    // Evolutions only come from chests; level-ups build toward them.
    for (const w of sh.weapons) {
      if (w.evo || banned('weapon', w.id)) continue;
      if (w.level < weaponMax(w.id)) pool.push([{ kind: 'weapon', id: w.id, level: w.level + 1 }, 10]);
    }
    if (sh.weapons.length < sh.stats.maxWeapons) {
      for (const id in WEAPONS) if (!ownedW.has(id) && !banned('weapon', id)) pool.push([{ kind: 'weapon', id, level: 1 }, 4]);
    }
    const wanted = new Set(sh.weapons.filter((w) => !w.evo).map((w) => WEAPONS[w.id].evo.with));
    for (const p of sh.passives) {
      if (p.level < PASSIVES[p.id].max && !banned('passive', p.id)) pool.push([{ kind: 'passive', id: p.id, level: p.level + 1 }, 8]);
    }
    if (sh.passives.length < MAX_PASSIVES) {
      for (const id in PASSIVES) if (!ownedP.has(id) && !banned('passive', id)) pool.push([{ kind: 'passive', id, level: 1 }, wanted.has(id) ? 7 : 3.5]);
    }
    const out = [];
    while (out.length < n && pool.length) {
      const o = weightedPick(pool, rng);
      out.push(o);
      pool.splice(pool.findIndex((e) => e[0] === o), 1);
    }
    if (out.length < n) out.push({ kind: 'heal' });
    if (out.length < n) out.push({ kind: 'gold' });
    return out;
  }

  applyChoice(o, sh) {
    if (o.kind === 'weapon') {
      const w = sh.weapons.find((x) => x.id === o.id);
      if (w) w.level = Math.min(weaponMax(w.id), w.level + 1);
      else if (sh.weapons.length < sh.stats.maxWeapons) this.addWeapon(sh, o.id);
    } else if (o.kind === 'passive') {
      const p = sh.passives.find((x) => x.id === o.id);
      if (p) p.level = Math.min(PASSIVES[p.id].max, p.level + 1);
      else if (sh.passives.length < MAX_PASSIVES) sh.passives.push({ id: o.id, level: 1 });
      this.recomputeStats(sh);
    } else if (o.kind === 'evo') {
      this.evolve(sh, o.id);
    } else if (o.kind === 'heal') {
      if (this.world.noHeal) sh.gold += 20 * sh.stats.goldMul;
      else sh.hp = Math.min(sh.stats.maxHp, sh.hp + sh.stats.maxHp * 0.3);
    } else if (o.kind === 'gold') {
      sh.gold += 25 * sh.stats.goldMul;
    } else if (o.kind === 'skip') {
      sh.gold += 10 * sh.stats.goldMul;
    }
  }

  // Pick a card. In co-op the run resumes once every player has picked.
  choose(o, sh = this.local) {
    if (this.state !== 'levelup' || !sh.pick) return;
    const valid = o.kind === 'skip' && !this.coop ? o : sh.pick.find((c) => c.kind === o.kind && c.id === o.id) || sh.pick[0];
    sh.pick = null;
    this.applyChoice(valid, sh);
    if (sh.protos.has('stasis')) for (const e of this.enemies) if (!e.boss) e.slowT = Math.max(e.slowT, 3);
    if (sh.protos.has('overflow') && !this.world.noHeal) sh.hp = Math.min(sh.stats.maxHp, sh.hp + sh.stats.maxHp * 0.1);
    this.checkEvoReady(sh);
    if (sh === this.local) Sound.play.pick();
    if (this.ships.some((s) => s.pick)) return;
    this.pendingLevels--;
    for (const s of this.ships) if (!s.down) this.pushWave(s.x, s.y, 150, 320, '#ffffff', 0);
    this.state = 'play';
  }

  // Remove a card from this run's pool for good, and deal a fresh hand.
  banish(o, sh = this.local) {
    if (this.state !== 'levelup' || this.coop || !sh.pick || sh.banishes <= 0) return null;
    if (o.kind !== 'weapon' && o.kind !== 'passive') return null;
    sh.banishes--;
    sh.banished.add(o.kind + ':' + o.id);
    this.rerollCount++;
    sh.pick = this.rollChoices(sh);
    return sh.pick;
  }

  reroll(sh = this.local) {
    if (this.state !== 'levelup' || sh.rerolls <= 0 || !sh.pick) return null;
    sh.rerolls--;
    this.rerollCount++;
    sh.pick = this.rollChoices(sh);
    return sh.pick;
  }

  evolve(sh, id) {
    const w = sh.weapons.find((x) => x.id === id);
    if (!w || w.evo) return;
    w.evo = true;
    w.level = weaponMax(id);
    w.cd = 0;
    if (sh === this.local) {
      this.evolved.push(id);
      if (!save.codex[id]) {
        save.codex[id] = true;
        writeSave();
      }
      this.flash = 0.7;
      this.hitstop = 0.1;
    }
    this.say(this.coop ? `${sh.name}: ${WEAPONS[id].evo.name}` : 'EVOLUTION', { color: '#ffd447', sub: this.coop ? 'Evolution!' : WEAPONS[id].evo.name });
    Sound.play.evolve();
  }

  canEvolve(sh) {
    return sh.weapons.filter((w) => !w.evo && w.level >= weaponMax(w.id) && sh.passives.some((p) => p.id === WEAPONS[w.id].evo.with));
  }

  // A chest holds 1, 3 or 5 rewards. Ready evolutions always come first.
  chestReward(sh, tier) {
    const reward = { evo: null, evos: [], ups: [], gold: 0, n: 1 };
    const odds = CHEST_ODDS[tier >= 1 ? 1 : 0], luck = (sh.protos.has('hunter') ? 0.12 : 0) + (this.sector - 1) * 0.02;
    const r = Math.random();
    reward.n = r < odds[0] + luck / 2 ? 5 : r < odds[0] + odds[1] + luck ? 3 : 1;
    let spare = 0;
    for (let i = 0; i < reward.n; i++) {
      const eligible = this.canEvolve(sh);
      if (eligible.length) {
        const w = pick(eligible);
        this.evolve(sh, w.id);
        reward.evos.push(w.id);
        continue;
      }
      const c = this.rollChoices(sh, 1)[0];
      this.rerollCount++;
      if (c.kind === 'heal' || c.kind === 'gold') { spare++; continue; }
      this.applyChoice(c, sh);
      reward.ups.push(c);
    }
    reward.evo = reward.evos[0] || null;
    reward.gold = Math.round(((tier >= 1 ? 20 : 10) * (1 + (reward.n - 1) * 0.25) + spare * 5) * sh.stats.goldMul * this.world.reward);
    this.checkEvoReady(sh);
    sh.gold += reward.gold;
    sh.chests++;
    if (sh === this.local) this.runStats.chests++;
    return reward;
  }

  openChest() {
    const { tier, sh } = this.pendingChest;
    this.pendingChest = null;
    const reward = this.chestReward(sh, tier);
    if (this.coop) {
      // No pause in co-op; the opener sees a banner instead of the overlay.
      if (!reward.evo) this.say(`${sh.name} opened a chest`, { color: '#ffd447', small: true, dur: 1.6 });
      if (this.hooks.netChest) this.hooks.netChest(this, sh, reward);
      return;
    }
    this.state = 'chest';
    Input.reset();
    Sound.play.chest();
    if (this.hooks.chest) this.hooks.chest(this, reward);
  }

  closeChest() {
    if (this.state === 'chest') this.state = 'play';
  }

  pause() {
    if (this.state === 'play' && !this.coop) {
      this.state = 'paused';
      Input.reset();
      return true;
    }
    return false;
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'play';
      this.local.inv = Math.max(this.local.inv, 0.6);
    }
  }

  // ---------- end of run ----------
  finish(won, quit = false) {
    if (this.finished) return;
    this.finished = true;
    this.state = won ? 'won' : 'dead';
    const L = this.local;
    const reward = this.world.reward;
    const survival = Math.floor((this.t / 60) * 10 * L.stats.goldMul * reward);
    let gold = Math.floor(L.gold) + survival + (won ? Math.round(150 * L.stats.goldMul * reward) : 0);
    const score = Math.floor((this.t * 10 + this.kills * 2 + this.level * 50 + (won ? 5000 : 0)) * reward);
    this.result = {
      won, quit, mode: this.mode, sector: this.sector, seed: this.seed, daily: this.daily, coop: this.coop,
      time: this.t, kills: this.kills, level: this.level, gold, score, charId: L.charId,
      chests: this.runStats.chests, elites: this.runStats.elites, dmg: Math.round(this.runStats.dmg), runId: this.runId || null,
      beacons: this.runStats.beacons, wardens: this.wardensKilled, evolutions: this.evolved.length, bestNoHit: L.bestNoHit,
      protocols: [...L.protos], level20At: this.level20At,
      weapons: L.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })),
      passives: L.passives.map((p) => ({ id: p.id, level: p.level })),
    };
    if (this.hooks.over) this.hooks.over(this.result);
  }

  quit() {
    this.finish(false, true);
  }

  // ---------- resume support (solo only) ----------
  snapshot() {
    if (this.finished || this.coop || this.state === 'dying' || this.state === 'victory') return null;
    const b = this.boss && !this.boss.dead ? this.boss : null, L = this.local;
    return {
      charId: L.charId, mode: this.mode, daily: this.daily, modId: this.mod ? this.mod.id : null, sector: this.sector, seed: this.seed,
      t: this.t, kills: this.kills, goldRun: L.gold, level: this.level, xp: this.xp, hp: L.hp,
      weapons: L.weapons.map((w) => ({ id: w.id, level: w.level, evo: w.evo })),
      passives: L.passives.map((p) => ({ id: p.id, level: p.level })),
      rerolls: L.rerolls, revives: L.revives, phoenix: L.phoenix, eventIdx: this.eventIdx, nextElite: this.nextElite,
      wardens: this.wardensKilled, evolved: this.evolved.slice(), pendingLevels: this.pendingLevels,
      final: this.finalSpawned, bestNoHit: L.bestNoHit, runStats: Object.assign({}, this.runStats), rerollCount: this.rerollCount,
      boss: b ? { kind: b.type, tier: b.tier, hp: b.hp / b.maxHp } : null, runId: this.runId || null,
      spawned: this.spawned, cp: this.cp ? Object.assign({}, this.cp) : null, tainted: this.tainted || null,
      protos: [...L.protos], protoPicks: this.protoPicks, pendingProto: this.pendingProto || this.state === 'proto',
      banished: [...L.banished], banishes: L.banishes, level20At: this.level20At, nextBeacon: this.nextBeacon,
    };
  }

  restore(s) {
    const L = this.local;
    this.t = s.t;
    this.kills = s.kills;
    this.spawned = Math.max(s.spawned || 0, s.kills);
    if (s.cp) this.cp = Object.assign({}, s.cp);
    if (s.tainted) this.tainted = s.tainted;
    L.gold = s.goldRun;
    this.level = s.level;
    this.xp = s.xp;
    this.xpNext = xpForLevel(s.level);
    L.weapons = [];
    for (const w of s.weapons) {
      if (!WEAPONS[w.id]) continue;
      this.addWeapon(L, w.id);
      const nw = L.weapons[L.weapons.length - 1];
      nw.level = w.level;
      nw.evo = w.evo;
    }
    L.passives = s.passives.filter((p) => PASSIVES[p.id]).map((p) => ({ id: p.id, level: p.level }));
    for (const id of s.protos || []) {
      if (!PROTOCOLS[id]) continue;
      L.protos.add(id);
      if (id === 'midas') this.world.enemyHp *= 1.15;
    }
    this.protoPicks = s.protoPicks || 0;
    this.pendingProto = !!s.pendingProto && this.protoPool.length > 0;
    L.banished = new Set(s.banished || []);
    if (s.banishes !== undefined) L.banishes = s.banishes;
    this.level20At = s.level20At || 0;
    if (s.nextBeacon) this.nextBeacon = s.nextBeacon;
    this.recomputeStats(L);
    L.hp = clamp(s.hp, 1, L.stats.maxHp);
    L.inv = 2;
    L.rerolls = s.rerolls;
    L.revives = s.revives;
    if (s.phoenix !== undefined) L.phoenix = s.phoenix;
    this.eventIdx = s.eventIdx;
    this.nextElite = s.nextElite;
    this.wardensKilled = s.wardens;
    this.evolved = s.evolved || [];
    this.pendingLevels = s.pendingLevels || 0;
    this.finalSpawned = !!s.final;
    L.bestNoHit = s.bestNoHit || 0;
    L.lastHitT = s.t;
    this.rerollCount = s.rerollCount || 0;
    if (s.runStats) Object.assign(this.runStats, s.runStats);
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
      for (const sh of this.ships) this.applyChoice(this.botChoose(sh, this.rollChoices(sh)), sh);
    }
    this.xpNext = xpForLevel(this.level);
    for (const sh of this.ships) sh.hp = sh.stats.maxHp;
    this.spawned = Math.max(this.spawned, this.kills);
    this.sealSet();
  }

  // ---------- autopilot for balance tests ----------
  botMove(sh) {
    let fx = 0, fy = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = sh.x - e.x, dy = sh.y - e.y, d2 = dx * dx + dy * dy, R = e.boss ? 260 : 170;
      if (d2 < R * R) {
        const w = ((e.boss ? 3 : 1) * (e.r / 10)) / (d2 + 50);
        fx += dx * w;
        fy += dy * w;
      }
    }
    for (const b of this.ebullets) {
      const dx = sh.x - b.x, dy = sh.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120) {
        const w = 2.5 / (d2 + 30);
        fx += dx * w;
        fy += dy * w;
      }
    }
    let best = null, bd = 320 * 320;
    for (const k of this.pickups) {
      const d2 = (k.x - sh.x) ** 2 + (k.y - sh.y) ** 2;
      if (k.kind === 'chest' && d2 < 600 * 600) { best = k; bd = d2; break; }
      if (d2 < bd) { bd = d2; best = k; }
    }
    if (best) {
      const d = Math.sqrt(bd) || 1, pull = best.kind === 'chest' ? 0.08 : 0.02;
      fx += ((best.x - sh.x) / d) * pull;
      fy += ((best.y - sh.y) / d) * pull;
    }
    const m = Math.hypot(fx, fy);
    return m < 1e-4 ? [0, 0] : [fx / m, fy / m];
  }

  botChoose(sh, choices) {
    const rank = (c) => (c.kind === 'evo' ? 5 : c.kind === 'weapon' && c.level > 1 ? 4 : c.kind === 'weapon' && sh.weapons.length < 3 ? 3.5 : c.kind === 'passive' ? 3 : c.kind === 'weapon' ? 2 : 1);
    return choices.slice().sort((a, b) => rank(b) - rank(a))[0];
  }
}

function jag(x1, y1, x2, y2, segs) {
  const pts = [x1, y1], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs, off = rand(-1, 1) * Math.min(18, len * 0.12);
    pts.push(Math.round(x1 + dx * t + nx * off), Math.round(y1 + dy * t + ny * off));
  }
  pts.push(Math.round(x2), Math.round(y2));
  return pts;
}

function addBolt(g, pts, life, color) {
  g.fx.push({ kind: 'bolt', pts, life, max: life, color });
  g.ev('l', pts, life, color);
}

const WEAPON_FIRE = {
  blaster(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const tgt = g.nearestEnemy(sh, 340);
    if (!tgt) { w.cd = 0.1; return; }
    const s = g.ws(sh, w);
    let ang = Math.atan2(tgt.y - sh.y, tgt.x - sh.x);
    if (w.evo) ang += rand(-0.07, 0.07);
    for (let i = 0; i < s.amount; i++) g.fireBolt(sh, ang + (i - (s.amount - 1) / 2) * 0.14, s, w.evo);
    w.cd = s.cd;
    if (sh === g.local) Sound.play.shoot();
  },

  blades(g, sh, w, dt) {
    const s = g.ws(sh, w);
    w.angle += s.spin * dt;
    const n = s.amount, R = s.radius * s.area, br = s.bladeR * Math.sqrt(s.area);
    w.br = br;
    if (!w.pos || w.pos.length !== n * 2) w.pos = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = w.angle + (i * TAU) / n, bx = sh.x + Math.cos(a) * R, by = sh.y + Math.sin(a) * R;
      w.pos[i * 2] = bx;
      w.pos[i * 2 + 1] = by;
      const buf = g.query(bx, by, br, g.qbuf);
      for (let k = 0; k < buf.length; k++) {
        const e = buf[k];
        if (e.dead || e.bladeCd > 0) continue;
        const dx = e.x - bx, dy = e.y - by, rr = e.r + br;
        if (dx * dx + dy * dy < rr * rr) {
          e.bladeCd = s.hitCd;
          const ex = e.x - sh.x, ey = e.y - sh.y, el = Math.hypot(ex, ey) || 1;
          g.damage(e, s.dmg, ex / el, ey / el, s.kb, sh);
        }
      }
    }
  },

  lightning(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(sh, w);
    let any = false;
    for (let k = 0; k < s.amount; k++) {
      const first = g.randomEnemyNear(sh, 420);
      if (!first) break;
      any = true;
      const hit = [first];
      addBolt(g, jag(first.x + rand(-40, 40), first.y - 260, first.x, first.y, 7), 0.2, '#7db8ff');
      g.damage(first, s.dmg, 0, 0, 0, sh);
      if (s.splash) g.explode(first.x, first.y, s.splash * s.area, s.dmg * 0.5, '#7db8ff', true, sh);
      let cur = first;
      for (let c = 0; c < s.chains; c++) {
        const next = g.nearestTo(cur.x, cur.y, s.range * s.area, hit);
        if (!next) break;
        hit.push(next);
        addBolt(g, jag(cur.x, cur.y, next.x, next.y, 5), 0.18, '#7db8ff');
        g.damage(next, s.dmg * 0.8, 0, 0, 0, sh);
        cur = next;
      }
    }
    w.cd = any ? s.cd : 0.2;
    if (any) Sound.play.zap();
  },

  missiles(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const tgt = g.randomEnemyNear(sh, 500);
    if (!tgt) { w.cd = 0.2; return; }
    const s = g.ws(sh, w), base = Math.atan2(tgt.y - sh.y, tgt.x - sh.x);
    for (let i = 0; i < s.amount; i++) {
      const ang = base + (i - (s.amount - 1) / 2) * 0.7 + rand(-0.15, 0.15);
      g.bullets.push({
        kind: 'missile', x: sh.x, y: sh.y, ang, sp: 90, maxSp: s.speed, r: 5, dmg: s.dmg, radius: s.radius * s.area, life: 2.6,
        target: i === 0 ? tgt : g.randomEnemyNear(sh, 500), trail: 0, sh,
      });
      g.ev('m', Math.round(sh.x), Math.round(sh.y), +ang.toFixed(2), Math.round(s.speed));
    }
    w.cd = s.cd;
    Sound.play.launch();
  },

  nova(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(sh, w), color = w.evo ? '#ffd0f5' : '#ff7ae0', maxR = s.radius * s.area;
    g.fx.push({ kind: 'nova', x: sh.x, y: sh.y, r: 8, maxR, speed: 420, dmg: s.dmg, kb: s.kb, heal: s.heal, healed: 0, hit: new Set(), color, life: 1, max: 1, sh });
    g.ev('n', sh.id, Math.round(maxR), color);
    w.cd = s.cd;
    if (sh === g.local) g.shake = Math.min(14, g.shake + 2);
    Sound.play.nova();
  },

  laser(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const tgt = g.nearestEnemy(sh, 600);
    if (!tgt) { w.cd = 0.2; return; }
    const s = g.ws(sh, w), base = Math.atan2(tgt.y - sh.y, tgt.x - sh.x), half = (s.width * Math.sqrt(s.area)) / 2;
    const color = w.evo ? '#ffffff' : '#e9e4ff';
    for (let i = 0; i < s.amount; i++) {
      const a = base + (i * TAU) / s.amount, ca = Math.cos(a), sa = Math.sin(a);
      const ex = sh.x + ca * s.length, ey = sh.y + sa * s.length;
      for (let k = 0; k < g.enemies.length; k++) {
        const e = g.enemies[k];
        if (e.dead) continue;
        const rr = half + e.r;
        if (distToSegment2(e.x, e.y, sh.x, sh.y, ex, ey) < rr * rr) g.damage(e, s.dmg, ca, sa, 60, sh);
      }
      g.fx.push({ kind: 'beam', x: sh.x, y: sh.y, ang: a, len: s.length, w: half * 2, life: 0.25, max: 0.25, color });
      g.ev('bm', Math.round(sh.x), Math.round(sh.y), +a.toFixed(3), Math.round(s.length), +(half * 2).toFixed(1), color);
    }
    w.cd = s.cd;
    if (sh === g.local) g.shake = Math.min(14, g.shake + 1.5);
    Sound.play.laser();
  },

  mines(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(sh, w);
    for (let i = 0; i < s.amount; i++) {
      const a = rand(0, TAU), d = i ? rand(14, 34) : 0;
      const m = { x: sh.x + Math.cos(a) * d, y: sh.y + Math.sin(a) * d, arm: 0.4, life: s.life, dmg: s.dmg, radius: s.radius * s.area, chain: s.chain, sh, evo: w.evo, id: ++g.uid };
      g.mines.push(m);
      g.ev('mi', m.id, Math.round(m.x), Math.round(m.y), w.evo ? 1 : 0);
      const mine = g.mines.filter((o) => o.sh === sh);
      if (mine.length > s.maxMines) mine[0].trip = true;
    }
    w.cd = s.cd;
  },

  glaive(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const tgt = g.nearestEnemy(sh, 360);
    if (!tgt) { w.cd = 0.15; return; }
    const s = g.ws(sh, w), base = Math.atan2(tgt.y - sh.y, tgt.x - sh.x);
    for (let i = 0; i < s.amount; i++) {
      const a = base + (i - (s.amount - 1) / 2) * (s.amount > 3 ? 0.9 : 0.45);
      const b = {
        kind: 'glaive', x: sh.x, y: sh.y, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, sp: s.speed, ang: 0,
        out: true, dist: 0, range: s.range, r: 9 * s.size * Math.sqrt(s.area), dmg: s.dmg, life: 4, hit: [], sh, big: w.evo,
      };
      g.bullets.push(b);
      g.ev('gl', sh.id, Math.round(b.x), Math.round(b.y), +a.toFixed(2), Math.round(s.speed), Math.round(s.range), +b.r.toFixed(1), w.evo ? 1 : 0);
    }
    w.cd = s.cd;
    Sound.play.launch();
  },

  wake(g, sh, w, dt) {
    w.cd -= dt;
    if (w.cd > 0) return;
    const s = g.ws(sh, w), color = w.evo ? '#ffd0a0' : '#ff9f43', r = s.radius * Math.sqrt(s.area);
    if (sh.moving) g.addZone(sh.x - sh.fx * 8, sh.y - sh.fy * 8, r, s.life, s.dmg, s.tick, color, sh);
    else if (s.ring) {
      const a = rand(0, TAU);
      g.addZone(sh.x + Math.cos(a) * 30, sh.y + Math.sin(a) * 30, r, s.life * 0.7, s.dmg, s.tick, color, sh);
    }
    w.cd = s.cd;
  },
};

// Pets follow their pilot and act on their own timers.
function petFollow(sh, pet, dt) {
  pet.ang += dt * 1.1;
  const tx = sh.x + Math.cos(pet.ang) * 30, ty = sh.y + Math.sin(pet.ang) * 30 - 6;
  const k = 1 - Math.exp(-dt * 6);
  pet.x += (tx - pet.x) * k;
  pet.y += (ty - pet.y) * k;
}

const PET_ACT = {
  spark(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 1;
    const tgt = g.nearestEnemy(pet, 320);
    if (!tgt) return;
    const s = { speed: 480, size: 0.8, area: 1, dmg: (8 + 4 * pet.stars) * sh.stats.might, pierce: 0 };
    const b = { x: pet.x, y: pet.y };
    g.fireBolt(Object.assign({}, sh, b), Math.atan2(tgt.y - pet.y, tgt.x - pet.x), s, false, PETS.spark.color);
    g.bullets[g.bullets.length - 1].sh = sh;
  },
  mite(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 8;
    for (const k of g.pickups) if (k.kind === 'gem' && (k.x - sh.x) ** 2 + (k.y - sh.y) ** 2 < 160 * 160) { k.attract = sh; k.sp = 100; }
  },
  beetle(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
  },
  medibot(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 4;
    if (g.world.noHeal || sh.hp >= sh.stats.maxHp) return;
    sh.hp = Math.min(sh.stats.maxHp, sh.hp + 2 + pet.stars);
    g.ring(sh.x, sh.y, 22, '#6dff9a');
  },
  shieldbit(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
  },
  ember(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 0.3;
    g.addZone(pet.x, pet.y, 13, 1.4, (5 + 3 * pet.stars) * sh.stats.might, 0.5, PETS.ember.color, sh);
  },
  owl(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 6;
    const R = 110 + 15 * pet.stars;
    for (const e of g.query(sh.x, sh.y, R, g.qbuf)) if (!e.dead && (e.x - sh.x) ** 2 + (e.y - sh.y) ** 2 < R * R) e.slowT = 2.5;
    g.ring(sh.x, sh.y, R, PETS.owl.color);
  },
  pup(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 3;
    let cur = pet;
    const hit = [];
    for (let i = 0; i < 2 + pet.stars; i++) {
      const next = g.nearestTo(cur.x, cur.y, 150, hit);
      if (!next) break;
      hit.push(next);
      addBolt(g, jag(cur.x, cur.y, next.x, next.y, 4), 0.16, PETS.pup.color);
      g.damage(next, (14 + 6 * pet.stars) * sh.stats.might, 0, 0, 0, sh);
      cur = next;
    }
    if (hit.length) Sound.play.zap();
  },
  cat(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
    if ((pet.cd -= dt) > 0) return;
    pet.cd = 5;
    const tgt = g.randomEnemyNear(sh, 300);
    if (!tgt) return;
    g.pushWave(tgt.x, tgt.y, 75, -260, PETS.cat.color, 0);
    g.explode(tgt.x, tgt.y, 70, (40 + 25 * pet.stars) * sh.stats.might, PETS.cat.color, false, sh);
  },
  phoenix(g, sh, pet, dt) {
    petFollow(sh, pet, dt);
  },
};
