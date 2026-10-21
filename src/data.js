'use strict';
/* Neon Swarm — game content and tuning */

const VERSION = '1.0.0';
const RUN_LENGTH = 480; // the Hive Queen arrives at 8:00
const MAX_WEAPONS = 4;
const MAX_PASSIVES = 4;
const MAX_ENEMIES = 260;
const PLAYER_SPEED = 122;
const PICKUP_RADIUS = 50;

// 24x24 stroke icons (currentColor)
const ICONS = {
  blaster: '<path d="M3 12h11"/><path d="M14 7l7 5-7 5z"/><path d="M3 8h5M3 16h5"/>',
  blades: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 7.8 4.5M21 12a9 9 0 0 1-4.5 7.8M12 21a9 9 0 0 1-7.8-4.5M3 12a9 9 0 0 1 4.5-7.8"/><path d="M19.8 7.5l.9-3M16.5 19.8l3 .9M4.2 16.5l-.9 3M7.5 4.2l-3-.9"/>',
  lightning: '<path d="M13 2L5 13.5h6L9.5 22 19 9.5h-6.2z"/>',
  missiles: '<path d="M14.5 3.5c3 0 6 3 6 6l-8.5 8.5-6-6z"/><path d="M6 12l-3 1 2 2M12 18l-1 3-2-2M15 9h.01"/>',
  nova: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  laser: '<path d="M2 12h20"/><path d="M2 8.5h13M9 15.5h13"/><circle cx="4" cy="12" r="1.6"/>',
  core: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M10 12h4"/>',
  overclock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5M19 5l1.5-1.5"/>',
  amplifier: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"/>',
  splitter: '<path d="M3 12h6l9-6M9 12l9 6M9 12h11"/><circle cx="19.5" cy="5.5" r="1.3"/><circle cx="19.5" cy="18.5" r="1.3"/><circle cx="21" cy="12" r="1"/>',
  boots: '<path d="M3 5l7 7-7 7M11 5l7 7-7 7"/>',
  magnet: '<path d="M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0z"/><path d="M5 7h4M15 7h4"/>',
  plating: '<path d="M12 2L4 5.5v6c0 5 3.4 8.7 8 10.5 4.6-1.8 8-5.5 8-10.5v-6z"/><path d="M12 8v7M8.5 11.5h7"/>',
  armor: '<path d="M12 2L4 5.5v6c0 5 3.4 8.7 8 10.5 4.6-1.8 8-5.5 8-10.5v-6z"/><path d="M8 10l4 3 4-3M8 14l4 3 4-3"/>',
  heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
  plus: '<path d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="10"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/><path d="M5 21h14"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M15 9c-.5-1-1.6-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3.1 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.5 0-2.6-.6-3.1-1.6"/>',
  reroll: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  revive: '<path d="M12 21s-7-4.2-7-9.6A4 4 0 0 1 12 9a4 4 0 0 1 7 2.4c0 5.4-7 9.6-7 9.6z"/><path d="M12 3v4M10 5h4"/>',
  gold: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.8 0-4.5-4-6.7-4.6-11.2-2.7 1.6-4.4 4.4-4.4 7-1.2-.7-2-2-2.2-3.4C6.3 9.3 5 11.7 5 15.2 5 19.3 8 22 12 22z"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.3 3 5.3V20h10v-3.7c1.7-1 3-2.7 3-5.3a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10.5 20v-2M13.5 20v-2"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6"/>',
  ship: '<path d="M21 12L5 4l3.5 8L5 20z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  chest: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M5 9V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2M12 11.5v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Level ups are deltas: plain keys add, keys ending in Mul multiply.
const WEAPONS = {
  blaster: {
    name: 'Pulse Blaster', color: '#39f3ff', icon: 'blaster',
    desc: 'Fires energy bolts at the nearest enemy.',
    base: { dmg: 12, cd: 0.6, amount: 1, speed: 440, pierce: 0, size: 1 },
    ups: [
      ['+1 bolt', { amount: 1 }],
      ['+6 damage', { dmg: 6 }],
      ['Fires 20% faster, bolts pierce 1 enemy', { cdMul: 0.8, pierce: 1 }],
      ['+1 bolt, +6 damage', { amount: 1, dmg: 6 }],
    ],
    evo: { with: 'core', name: 'Hyper Pulse', desc: 'A relentless stream of piercing bolts.', stats: { dmg: 17, cd: 0.13, amount: 1, speed: 620, pierce: 2, size: 1.3 } },
  },
  blades: {
    name: 'Orbit Blades', color: '#b6ff3d', icon: 'blades',
    desc: 'Blades circle you and slice anything they touch.',
    base: { dmg: 10, amount: 2, radius: 58, spin: 3.3, bladeR: 9, hitCd: 0.4, kb: 140 },
    ups: [
      ['+1 blade', { amount: 1 }],
      ['+6 damage, orbit 15% wider', { dmg: 6, radiusMul: 1.15 }],
      ['+1 blade', { amount: 1 }],
      ['+6 damage, spin 30% faster', { dmg: 6, spinMul: 1.3 }],
    ],
    evo: { with: 'amplifier', name: 'Halo Saw', desc: 'A ring of saws that never stops cutting.', stats: { dmg: 26, amount: 6, radius: 80, spin: 4.6, bladeR: 12.5, hitCd: 0.25, kb: 200 } },
  },
  lightning: {
    name: 'Chain Lightning', color: '#7db8ff', icon: 'lightning',
    desc: 'Strikes a random enemy, then arcs to others nearby.',
    base: { dmg: 20, cd: 1.7, amount: 1, chains: 3, range: 120 },
    ups: [
      ['+1 chain', { chains: 1 }],
      ['+10 damage', { dmg: 10 }],
      ['Strikes 20% faster, +1 chain', { cdMul: 0.8, chains: 1 }],
      ['+1 strike', { amount: 1 }],
    ],
    evo: { with: 'overclock', name: 'Thunderstorm', desc: 'The sky tears open over everything near you.', stats: { dmg: 42, cd: 0.85, amount: 4, chains: 6, range: 150, splash: 46 } },
  },
  missiles: {
    name: 'Seeker Missiles', color: '#ffa94d', icon: 'missiles',
    desc: 'Homing missiles that explode on impact.',
    base: { dmg: 24, cd: 1.8, amount: 2, speed: 250, radius: 44 },
    ups: [
      ['+10 damage, blasts 20% bigger', { dmg: 10, radiusMul: 1.2 }],
      ['+1 missile', { amount: 1 }],
      ['Fires 20% faster', { cdMul: 0.8 }],
      ['+1 missile, +10 damage', { amount: 1, dmg: 10 }],
    ],
    evo: { with: 'splitter', name: 'Swarm Rack', desc: 'Missile salvos carpet the whole screen.', stats: { dmg: 52, cd: 1.1, amount: 7, speed: 300, radius: 64 } },
  },
  nova: {
    name: 'Shock Nova', color: '#ff7ae0', icon: 'nova',
    desc: 'A shockwave that blasts enemies away. Your panic button.',
    base: { dmg: 18, cd: 2.8, radius: 105, kb: 340 },
    ups: [
      ['Wave 15% bigger', { radiusMul: 1.15 }],
      ['+12 damage', { dmg: 12 }],
      ['Pulses 20% faster', { cdMul: 0.8 }],
      ['Wave 20% bigger, +12 damage', { radiusMul: 1.2, dmg: 12 }],
    ],
    evo: { with: 'plating', name: 'Supernova', desc: 'Colossal shockwaves that repair your hull.', stats: { dmg: 50, cd: 1.8, radius: 195, kb: 440, heal: 1 } },
  },
  laser: {
    name: 'Prism Laser', color: '#e9e4ff', icon: 'laser',
    desc: 'A beam that pierces every enemy in a line.',
    base: { dmg: 30, cd: 2.3, amount: 1, width: 10, length: 560 },
    ups: [
      ['+12 damage', { dmg: 12 }],
      ['+1 beam (fires behind you too)', { amount: 1 }],
      ['Fires 20% faster, beams 30% wider', { cdMul: 0.8, widthMul: 1.3 }],
      ['+2 beams', { amount: 2 }],
    ],
    evo: { with: 'boots', name: 'Photon Lance', desc: 'Eight blinding beams in every direction.', stats: { dmg: 64, cd: 1.4, amount: 8, width: 18, length: 620 } },
  },
};

const PASSIVES = {
  core: { name: 'Power Core', icon: 'core', color: '#ff6b8b', max: 5, desc: '+10% damage', apply: (s, l) => { s.might += 0.1 * l; } },
  overclock: { name: 'Overclock', icon: 'overclock', color: '#7db8ff', max: 5, desc: 'Weapons recharge 6% faster', apply: (s, l) => { s.cdMul *= 1 - 0.06 * l; } },
  amplifier: { name: 'Amplifier', icon: 'amplifier', color: '#b6ff3d', max: 5, desc: '+10% weapon area', apply: (s, l) => { s.area += 0.1 * l; } },
  splitter: { name: 'Splitter', icon: 'splitter', color: '#ffa94d', max: 2, desc: '+1 projectile on every weapon', apply: (s, l) => { s.amount += l; } },
  boots: { name: 'Thrusters', icon: 'boots', color: '#e9e4ff', max: 5, desc: '+8% move speed', apply: (s, l) => { s.speed += 0.08 * l; } },
  magnet: { name: 'Magnet', icon: 'magnet', color: '#6dff9a', max: 5, desc: '+30% pickup range', apply: (s, l) => { s.magnet += 0.3 * l; } },
  plating: { name: 'Hull Plating', icon: 'plating', color: '#ff7ae0', max: 5, desc: '+15 max HP, +0.2 HP/s', apply: (s, l) => { s.maxHp += 15 * l; s.regen += 0.2 * l; } },
  armor: { name: 'Armor', icon: 'armor', color: '#ffd447', max: 5, desc: 'Take 6% less damage', apply: (s, l) => { s.armor += 0.06 * l; } },
};

const CHARS = {
  volt: { name: 'Volt', color: '#39f3ff', weapon: 'blaster', cost: 0, perk: 'Weapons recharge 5% faster', stats: (s) => { s.cdMul *= 0.95; } },
  razor: { name: 'Razor', color: '#b6ff3d', weapon: 'blades', cost: 250, perk: '+10% speed, -10 max HP', stats: (s) => { s.speed += 0.1; s.maxHp -= 10; } },
  arc: { name: 'Arc', color: '#7db8ff', weapon: 'lightning', cost: 500, perk: '+15% weapon area', stats: (s) => { s.area += 0.15; } },
  titan: { name: 'Titan', color: '#ffb43d', weapon: 'nova', cost: 900, perk: '+40 max HP, 5% armor, -10% speed', stats: (s) => { s.maxHp += 40; s.armor += 0.05; s.speed -= 0.1; } },
  prism: { name: 'Prism', color: '#f2eeff', weapon: 'laser', cost: null, unlock: 'Defeat the Hive Queen to unlock', perk: '+15% damage, -20 max HP', stats: (s) => { s.might += 0.15; s.maxHp -= 20; } },
};

// Warm colours are enemies, cool colours are pickups, magenta is enemy fire only.
const ENEMIES = {
  drone: { name: 'Drone', r: 10, hp: 8, speed: 58, dmg: 8, xp: 1, color: '#ff3d8b', shape: 'diamond', ai: 'chase' },
  swarmer: { name: 'Swarmer', r: 7, hp: 4, speed: 98, dmg: 5, xp: 1, color: '#ff8a3c', shape: 'tri', ai: 'chase' },
  dasher: { name: 'Dasher', r: 11, hp: 18, speed: 46, dmg: 12, xp: 2, color: '#ff4040', shape: 'arrow', ai: 'dash' },
  brute: { name: 'Brute', r: 19, hp: 60, speed: 34, dmg: 16, xp: 5, color: '#ffcf3c', shape: 'hex', ai: 'chase', kbRes: 0.3 },
  splitter: { name: 'Splitter', r: 15, hp: 32, speed: 44, dmg: 10, xp: 2, color: '#ff7a59', shape: 'pent', ai: 'chase', split: 'shard' },
  shard: { name: 'Shard', r: 7, hp: 6, speed: 84, dmg: 6, xp: 1, color: '#ff7a59', shape: 'pent', ai: 'chase' },
  spitter: { name: 'Spitter', r: 12, hp: 22, speed: 52, dmg: 9, xp: 3, color: '#c6ff3c', shape: 'square', ai: 'shoot' },
};

const BOSSES = {
  warden: { name: 'THE WARDEN', r: 30, hp: [600, 2000, 4500], speed: 50, dmg: 18, xp: 40, color: '#ff3d5a', shape: 'warden', ai: 'warden' },
  queen: { name: 'HIVE QUEEN', r: 46, hp: [40000], speed: 62, dmg: 26, xp: 0, color: '#ffd447', shape: 'queen', ai: 'queen' },
};

// [from second, weights]
const SPAWN_TABLE = [
  [0, { drone: 10 }],
  [40, { drone: 8, swarmer: 3 }],
  [60, { drone: 7, swarmer: 3, dasher: 2 }],
  [150, { drone: 5, swarmer: 3, dasher: 3, brute: 1.5 }],
  [210, { drone: 4, swarmer: 3, dasher: 3, brute: 2, splitter: 2 }],
  [300, { drone: 3, swarmer: 3, dasher: 3, brute: 2.5, splitter: 2.5, spitter: 2 }],
  [390, { drone: 3, swarmer: 3, dasher: 3, brute: 3, splitter: 3, spitter: 2.5 }],
];

const EVENTS = [
  { t: 40, type: 'pack', enemy: 'swarmer', n: 12, text: 'SWARM INCOMING' },
  { t: 90, type: 'pack', enemy: 'swarmer', n: 16 },
  { t: 120, type: 'boss', id: 'warden', tier: 0 },
  { t: 180, type: 'ring', enemy: 'drone', n: 40, text: 'SURROUNDED' },
  { t: 220, type: 'pack', enemy: 'dasher', n: 8, text: 'DASHERS' },
  { t: 240, type: 'boss', id: 'warden', tier: 1 },
  { t: 285, type: 'pack', enemy: 'swarmer', n: 28, text: 'SWARM INCOMING' },
  { t: 330, type: 'pack', enemy: 'brute', n: 6, text: 'BRUTES' },
  { t: 360, type: 'boss', id: 'warden', tier: 2 },
  { t: 390, type: 'ring', enemy: 'drone', n: 40, text: 'SURROUNDED' },
  { t: 430, type: 'ring', enemy: 'swarmer', n: 48, text: 'SURROUNDED' },
  { t: 460, type: 'pack', enemy: 'splitter', n: 10 },
  { t: RUN_LENGTH, type: 'final' },
];

const SHOP = [
  { id: 'might', name: 'Might', icon: 'core', desc: '+5% damage', max: 5, base: 60 },
  { id: 'vitality', name: 'Vitality', icon: 'heart', desc: '+10 max HP', max: 5, base: 50 },
  { id: 'armor', name: 'Hull', icon: 'armor', desc: 'Take 3% less damage', max: 5, base: 60 },
  { id: 'recovery', name: 'Recovery', icon: 'plus', desc: '+0.1 HP per second', max: 5, base: 70 },
  { id: 'haste', name: 'Haste', icon: 'boots', desc: '+4% move speed', max: 5, base: 60 },
  { id: 'magnet', name: 'Reach', icon: 'magnet', desc: '+10% pickup range', max: 5, base: 40 },
  { id: 'cooldown', name: 'Tempo', icon: 'overclock', desc: 'Weapons recharge 3% faster', max: 5, base: 90 },
  { id: 'growth', name: 'Growth', icon: 'up', desc: '+6% XP', max: 5, base: 80 },
  { id: 'greed', name: 'Greed', icon: 'coin', desc: '+10% gold', max: 5, base: 80 },
  { id: 'reroll', name: 'Reroll', icon: 'reroll', desc: '+1 reroll per run', max: 3, base: 100 },
  { id: 'revival', name: 'Revival', icon: 'revive', desc: 'Come back once per run at half HP', max: 1, base: 600 },
];

function shopCost(item, rank) {
  return Math.round((item.base * Math.pow(1.7, rank)) / 5) * 5;
}

// stat: key into save.stats, or a derived value (see questValue in save.js)
const QUESTS = [
  { id: 'kills100', name: 'First Contact', desc: 'Destroy 100 enemies', goal: 100, stat: 'kills', reward: 40 },
  { id: 'level10', name: 'Power Up', desc: 'Reach level 10 in one run', goal: 10, stat: 'bestLevel', reward: 50 },
  { id: 'survive3', name: 'Holding On', desc: 'Survive 3 minutes in one run', goal: 180, stat: 'bestTime', reward: 60, time: true },
  { id: 'warden', name: 'Warden Down', desc: 'Defeat the Warden', goal: 1, stat: 'wardens', reward: 80 },
  { id: 'evolve', name: 'Evolution', desc: 'Evolve a weapon', goal: 1, stat: 'evolutions', reward: 120 },
  { id: 'nohit', name: 'Untouchable', desc: 'Survive 90 seconds without taking damage', goal: 90, stat: 'bestNoHit', reward: 100, time: true },
  { id: 'shop10', name: 'Investor', desc: 'Buy 10 upgrades', goal: 10, stat: 'shopBuys', reward: 120 },
  { id: 'kills2500', name: 'Exterminator', desc: 'Destroy 2,500 enemies', goal: 2500, stat: 'kills', reward: 150 },
  { id: 'survive6', name: 'Veteran', desc: 'Survive 6 minutes in one run', goal: 360, stat: 'bestTime', reward: 150, time: true },
  { id: 'runkills', name: 'Rampage', desc: 'Destroy 1,500 enemies in one run', goal: 1500, stat: 'bestKills', reward: 150 },
  { id: 'daily3', name: 'Daily Grind', desc: 'Play 3 daily runs', goal: 3, stat: 'dailyRuns', reward: 150 },
  { id: 'pilots', name: 'Full Roster', desc: 'Unlock 4 pilots', goal: 4, stat: 'pilots', reward: 200 },
  { id: 'queen', name: 'Queen Slayer', desc: 'Defeat the Hive Queen', goal: 1, stat: 'queens', reward: 400 },
  { id: 'codex', name: 'Mad Scientist', desc: 'Discover all 6 evolutions', goal: 6, stat: 'evosFound', reward: 500 },
  { id: 'kills10k', name: 'Swarm Breaker', desc: 'Destroy 10,000 enemies', goal: 10000, stat: 'kills', reward: 400 },
];

const DAILY_MODS = [
  { id: 'glass', name: 'Glass Cannon', desc: 'Double damage, half health.', apply: (s) => { s.might *= 2; s.maxHp *= 0.5; } },
  { id: 'hyper', name: 'Hyperdrive', desc: 'The whole game runs 25% faster. +50% gold.', apply: (s) => { s.gameSpeed = 1.25; s.goldMul *= 1.5; } },
  { id: 'horde', name: 'The Horde', desc: '60% more enemies. +30% XP.', apply: (s) => { s.enemyCount = 1.6; s.xpMul *= 1.3; } },
  { id: 'giants', name: 'Giants', desc: 'Huge enemies with double health. Double XP.', apply: (s) => { s.enemySize = 1.45; s.enemyHp = 2; s.xpMul *= 2; } },
  { id: 'magnetic', name: 'Magnetic', desc: 'Enormous pickup range, but enemies are 20% faster.', apply: (s) => { s.magnet += 2.5; s.enemySpeed = 1.2; } },
  { id: 'arsenal', name: 'Random Arsenal', desc: 'Start with a random extra weapon and passive.', apply: () => {} },
  { id: 'iron', name: 'Iron Will', desc: 'No healing of any kind. Triple gold.', apply: (s) => { s.noHeal = true; s.goldMul *= 3; } },
];

function dailyMod(key = todayKey()) {
  return DAILY_MODS[hashStr('neon-swarm-' + key) % DAILY_MODS.length];
}

// XP needed to go from level L to L+1
function xpForLevel(L) {
  return Math.floor(4 + 5 * (L - 1) + 0.45 * (L - 1) * (L - 1));
}

// Enemy health multiplier at t seconds
function enemyHpMul(t) {
  const m = t / 60;
  return 1 + 0.3 * m + 0.07 * m * m;
}

const _wsCache = new Map();
function weaponStats(id, level, evo) {
  const key = id + level + (evo ? 'e' : '');
  let s = _wsCache.get(key);
  if (s) return s;
  const def = WEAPONS[id];
  if (evo) {
    s = Object.assign({}, def.base, def.evo.stats);
  } else {
    s = Object.assign({}, def.base);
    for (let i = 0; i < level - 1 && i < def.ups.length; i++) {
      const d = def.ups[i][1];
      for (const k in d) {
        if (k.endsWith('Mul')) s[k.slice(0, -3)] *= d[k];
        else s[k] = (s[k] || 0) + d[k];
      }
    }
  }
  _wsCache.set(key, s);
  return s;
}

function weaponMax(id) {
  return WEAPONS[id].ups.length + 1;
}
