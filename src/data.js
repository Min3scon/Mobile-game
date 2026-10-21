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
  mines: '<path d="M12 4l7 4v8l-7 4-7-4V8z"/><circle cx="12" cy="12" r="2.5"/>',
  glaive: '<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/><circle cx="12" cy="12" r="1.5"/>',
  wake: '<path d="M3 17c3-4 5-4 8 0s5 4 8 0"/><path d="M5 11c2-3 4-3 6 0s4 3 6 0"/><circle cx="20" cy="7" r="2"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M9 3l3 18 3-18"/>',
  egg: '<path d="M12 2C8 2 5 8.5 5 13.5a7 7 0 0 0 14 0C19 8.5 16 2 12 2z"/><path d="M7 12l2.5 2 2.5-2 2.5 2 2.5-2"/>',
  paw: '<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 12c-3 0-5.5 3-5.5 5.5 0 2 2 3 5.5 3s5.5-1 5.5-3C17.5 15 15 12 12 12z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c3 0 4.6 2 5 5"/>',
  swords: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l-2 2 4 4 2-2"/>',
  boss: '<path d="M12 2l3 5 6-2-2 6 3 3-5 2-1 6-4-3-4 3-1-6-5-2 3-3-2-6 6 2z"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 10L6 2h4l2 5 2-5h4l-2.5 8M12 12.5v5M10 14h4"/>',
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S9 8 12 8zm0 0c2-4 6-4 6-1.5S15 8 12 8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.5 4-7 8-7s7.2 2.5 8 7"/>',
  sector: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 7l4.5 2.5v5L12 17l-4.5-2.5v-5z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
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

Object.assign(WEAPONS, {
  mines: {
    name: 'Plasma Mines', color: '#ffe066', icon: 'mines',
    desc: 'Drops mines that blow up when enemies walk over them.',
    base: { dmg: 38, cd: 1.5, amount: 1, radius: 52, life: 10, maxMines: 8 },
    ups: [
      ['+14 damage', { dmg: 14 }],
      ['+1 mine per drop', { amount: 1 }],
      ['Blasts 25% bigger', { radiusMul: 1.25 }],
      ['Drops 25% faster, +14 damage', { cdMul: 0.75, dmg: 14 }],
    ],
    evo: { with: 'armor', name: 'Minefield', desc: 'Carpets the ground in mines that set each other off.', stats: { dmg: 80, cd: 0.7, amount: 3, radius: 72, life: 12, maxMines: 18, chain: 1 } },
  },
  glaive: {
    name: 'Glaive', color: '#9effc9', icon: 'glaive',
    desc: 'Throws a spinning blade that flies out and comes back.',
    base: { dmg: 22, cd: 1.7, amount: 1, speed: 330, range: 210, size: 1 },
    ups: [
      ['+1 glaive', { amount: 1 }],
      ['+10 damage', { dmg: 10 }],
      ['Flies 25% farther and faster', { rangeMul: 1.25, speedMul: 1.25 }],
      ['+1 glaive, +10 damage', { amount: 1, dmg: 10 }],
    ],
    evo: { with: 'magnet', name: 'Twin Moons', desc: 'A storm of huge glaives that tear through everything.', stats: { dmg: 52, cd: 0.95, amount: 4, speed: 420, range: 280, size: 1.6 } },
  },
  wake: {
    name: 'Plasma Wake', color: '#ff9f43', icon: 'wake',
    desc: 'Leaves a burning trail behind you as you move.',
    base: { dmg: 12, cd: 0.13, life: 1.6, radius: 16, tick: 0.5 },
    ups: [
      ['+6 damage', { dmg: 6 }],
      ['Trail lasts 40% longer', { lifeMul: 1.4 }],
      ['Trail 25% wider', { radiusMul: 1.25 }],
      ['+8 damage, burns faster', { dmg: 8, tickMul: 0.8 }],
    ],
    evo: { with: 'lens', name: 'Inferno Wake', desc: 'A wide river of fire that burns even when you stand still.', stats: { dmg: 30, cd: 0.1, life: 2.6, radius: 26, tick: 0.4, ring: 1 } },
  },
});

const PASSIVES = {
  core: { name: 'Power Core', icon: 'core', color: '#ff6b8b', max: 5, desc: '+10% damage', apply: (s, l) => { s.might += 0.1 * l; } },
  overclock: { name: 'Overclock', icon: 'overclock', color: '#7db8ff', max: 5, desc: 'Weapons recharge 6% faster', apply: (s, l) => { s.cdMul *= 1 - 0.06 * l; } },
  amplifier: { name: 'Amplifier', icon: 'amplifier', color: '#b6ff3d', max: 5, desc: '+10% weapon area', apply: (s, l) => { s.area += 0.1 * l; } },
  splitter: { name: 'Splitter', icon: 'splitter', color: '#ffa94d', max: 2, desc: '+1 projectile on every weapon', apply: (s, l) => { s.amount += l; } },
  boots: { name: 'Thrusters', icon: 'boots', color: '#e9e4ff', max: 5, desc: '+8% move speed', apply: (s, l) => { s.speed += 0.08 * l; } },
  magnet: { name: 'Magnet', icon: 'magnet', color: '#6dff9a', max: 5, desc: '+30% pickup range', apply: (s, l) => { s.magnet += 0.3 * l; } },
  plating: { name: 'Hull Plating', icon: 'plating', color: '#ff7ae0', max: 5, desc: '+15 max HP, +0.2 HP/s', apply: (s, l) => { s.maxHp += 15 * l; s.regen += 0.2 * l; } },
  armor: { name: 'Armor', icon: 'armor', color: '#ffd447', max: 5, desc: 'Take 6% less damage', apply: (s, l) => { s.armor += 0.06 * l; } },
  lens: { name: 'Crit Lens', icon: 'lens', color: '#ff9f43', max: 5, desc: '+5% crit chance, +20% crit damage', apply: (s, l) => { s.crit += 0.05 * l; s.critMul += 0.2 * l; } },
};

// unlock: { gold } | { gems } | { rank } | { queen: true } | { sector }
const CHARS = {
  volt: { name: 'Volt', color: '#39f3ff', weapon: 'blaster', unlock: {}, perk: 'Weapons recharge 5% faster', stats: (s) => { s.cdMul *= 0.95; } },
  razor: { name: 'Razor', color: '#b6ff3d', weapon: 'blades', unlock: { gold: 250 }, perk: '+10% speed, -10 max HP', stats: (s) => { s.speed += 0.1; s.maxHp -= 10; } },
  arc: { name: 'Arc', color: '#7db8ff', weapon: 'lightning', unlock: { gold: 500 }, perk: '+15% weapon area', stats: (s) => { s.area += 0.15; } },
  mina: { name: 'Mina', color: '#ffe066', weapon: 'mines', unlock: { rank: 4 }, perk: '+10% area, +10 max HP', stats: (s) => { s.area += 0.1; s.maxHp += 10; } },
  titan: { name: 'Titan', color: '#ffb43d', weapon: 'nova', unlock: { gold: 900 }, perk: '+40 max HP, 5% armor, -10% speed', stats: (s) => { s.maxHp += 40; s.armor += 0.05; s.speed -= 0.1; } },
  kestrel: { name: 'Kestrel', color: '#9effc9', weapon: 'glaive', unlock: { gems: 150 }, perk: '+12% speed, +20% pickup range', stats: (s) => { s.speed += 0.12; s.magnet += 0.2; } },
  vex: { name: 'Vex', color: '#ffa94d', weapon: 'missiles', unlock: { gold: 1500 }, perk: '+1 projectile, -10% speed', stats: (s) => { s.amount += 1; s.speed -= 0.1; } },
  blaze: { name: 'Blaze', color: '#ff9f43', weapon: 'wake', unlock: { gems: 300 }, perk: '+15% speed, +10% damage, -15 max HP', stats: (s) => { s.speed += 0.15; s.might += 0.1; s.maxHp -= 15; } },
  echo: { name: 'Echo', color: '#c9a4ff', weapon: 'blaster', passive: 'splitter', unlock: { rank: 15 }, perk: 'Starts with Splitter, -10 max HP', stats: (s) => { s.maxHp -= 10; } },
  prism: { name: 'Prism', color: '#f2eeff', weapon: 'laser', unlock: { queen: true }, perk: '+15% damage, -20 max HP', stats: (s) => { s.might += 0.15; s.maxHp -= 20; } },
};

function unlockText(u) {
  if (u.gold) return fmtInt(u.gold) + ' gold';
  if (u.gems) return fmtInt(u.gems) + ' gems';
  if (u.rank) return 'Reach rank ' + u.rank;
  if (u.queen) return 'Defeat the Hive Queen';
  if (u.sector) return 'Reach sector ' + u.sector;
  return '';
}

// ---------- pets ----------
const RARITY = [
  { name: 'Common', color: '#b9c3dc' },
  { name: 'Rare', color: '#4da3ff' },
  { name: 'Epic', color: '#c56bff' },
  { name: 'Legendary', color: '#ffd447' },
];
const PET_MAX_STARS = 5;
// Duplicates needed to go from n stars to n+1
const PET_DUPES = [0, 1, 2, 3, 5];
// st = stars (1-5). stat() changes run stats; behaviour lives in game.js (PET_ACT).
const PETS = {
  spark: { name: 'Spark', rarity: 0, color: '#39f3ff', shape: 'diamond', desc: (st) => `Fires a bolt for ${8 + 4 * st} damage every second` },
  mite: { name: 'Magnet Mite', rarity: 0, color: '#6dff9a', shape: 'circle', desc: (st) => `+${10 + 5 * st}% pickup range. Pulls in nearby gems every 8s`, stat: (s, st) => { s.magnet += 0.1 + 0.05 * st; } },
  beetle: { name: 'Gold Beetle', rarity: 0, color: '#ffd447', shape: 'hex', desc: (st) => `+${8 + 4 * st}% gold from runs`, stat: (s, st) => { s.goldMul += 0.08 + 0.04 * st; } },
  medibot: { name: 'Medibot', rarity: 1, color: '#6dff9a', shape: 'square', desc: (st) => `Repairs ${2 + st} HP every 4 seconds` },
  shieldbit: { name: 'Shield Bit', rarity: 1, color: '#7db8ff', shape: 'hex', desc: (st) => `Blocks one hit every ${13 - st} seconds` },
  ember: { name: 'Ember Wisp', rarity: 1, color: '#ff9f43', shape: 'tri', desc: (st) => `Leaves burning embers for ${5 + 3 * st} damage` },
  owl: { name: 'Frost Owl', rarity: 2, color: '#a8e6ff', shape: 'diamond', desc: (st) => `Every 6s, slows enemies within ${110 + 15 * st} by half` },
  pup: { name: 'Thunder Pup', rarity: 2, color: '#7db8ff', shape: 'tri', desc: (st) => `Zaps ${2 + st} enemies for ${14 + 6 * st} damage every 3s` },
  cat: { name: 'Void Cat', rarity: 3, color: '#c56bff', shape: 'pent', desc: (st) => `Every 5s, collapses space on a crowd for ${40 + 25 * st} damage` },
  phoenix: { name: 'Phoenix', rarity: 3, color: '#ff6b4a', shape: 'arrow', desc: (st) => `Revives you once per run. +${4 + 2 * st}% damage`, stat: (s, st) => { s.might += 0.04 + 0.02 * st; } },
};
// Chance of each rarity per egg, in percent
const EGGS = {
  basic: { name: 'Swarm Egg', cost: 100, odds: [70, 25, 4.5, 0.5], color: '#9fd8ff' },
  royal: { name: 'Royal Egg', cost: 280, odds: [0, 62, 32, 6], color: '#ffd447' },
};

// ---------- sectors (difficulty tiers) ----------
const SECTORS = [
  null,
  { name: 'Sector 1', hp: 1, speed: 1, dmg: 1, reward: 1, color: '#39f3ff' },
  { name: 'Sector 2', hp: 1.8, speed: 1.06, dmg: 1.3, reward: 1.5, color: '#6dff9a' },
  { name: 'Sector 3', hp: 3, speed: 1.12, dmg: 1.6, reward: 2.1, color: '#ffd447' },
  { name: 'Sector 4', hp: 4.8, speed: 1.18, dmg: 2, reward: 2.8, color: '#ff8a3c' },
  { name: 'Sector 5', hp: 7.5, speed: 1.24, dmg: 2.5, reward: 3.6, color: '#ff3d8b' },
];


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
  queen: { name: 'HIVE QUEEN', r: 46, hp: [24000], speed: 62, dmg: 26, xp: 0, color: '#ffd447', shape: 'queen', ai: 'queen' },
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

// tier2: ranks 6-10 open at account rank SHOP_TIER2_RANK. need: account rank required to buy at all.
const SHOP_TIER2_RANK = 8;
const SHOP = [
  { id: 'might', name: 'Might', icon: 'core', desc: '+5% damage', max: 10, base: 60, tier2: true },
  { id: 'vitality', name: 'Vitality', icon: 'heart', desc: '+10 max HP', max: 10, base: 50, tier2: true },
  { id: 'armor', name: 'Hull', icon: 'armor', desc: 'Take 3% less damage', max: 10, base: 60, tier2: true },
  { id: 'recovery', name: 'Recovery', icon: 'plus', desc: '+0.1 HP per second', max: 10, base: 70, tier2: true },
  { id: 'haste', name: 'Haste', icon: 'boots', desc: '+4% move speed', max: 10, base: 60, tier2: true },
  { id: 'magnet', name: 'Reach', icon: 'magnet', desc: '+10% pickup range', max: 10, base: 40, tier2: true },
  { id: 'cooldown', name: 'Tempo', icon: 'overclock', desc: 'Weapons recharge 2.5% faster', max: 10, base: 90, tier2: true },
  { id: 'growth', name: 'Growth', icon: 'up', desc: '+6% XP', max: 10, base: 80, tier2: true },
  { id: 'greed', name: 'Greed', icon: 'coin', desc: '+10% gold', max: 10, base: 80, tier2: true },
  { id: 'crit', name: 'Precision', icon: 'lens', desc: '+2% critical hit chance', max: 5, base: 120 },
  { id: 'velocity', name: 'Velocity', icon: 'blaster', desc: '+6% projectile speed', max: 5, base: 70 },
  { id: 'medic', name: 'Medic', icon: 'plus', desc: '+50% chance enemies drop repairs', max: 3, base: 90 },
  { id: 'reroll', name: 'Reroll', icon: 'reroll', desc: '+1 reroll per run', max: 5, base: 100 },
  { id: 'revival', name: 'Revival', icon: 'revive', desc: 'Come back once per run at half HP', max: 2, base: 600 },
  { id: 'arsenal', name: 'Arsenal', icon: 'swords', desc: '+1 weapon slot (5 weapons)', max: 1, base: 3000, need: 10 },
];

function shopCost(item, rank) {
  return Math.round((item.base * Math.pow(1.6, Math.min(rank, 5)) * Math.pow(1.3, Math.max(0, rank - 5))) / 5) * 5;
}

// Achievements. stat: key into save.stats, or a derived value (see questValue in progress.js)
const QUESTS = [
  { id: 'kills100', name: 'First Contact', desc: 'Destroy 100 enemies', goal: 100, stat: 'kills', reward: { gold: 40 } },
  { id: 'level10', name: 'Power Up', desc: 'Reach level 10 in one run', goal: 10, stat: 'bestLevel', reward: { gold: 50 } },
  { id: 'survive3', name: 'Holding On', desc: 'Survive 3 minutes in one run', goal: 180, stat: 'bestTime', reward: { gold: 60 }, time: true },
  { id: 'warden', name: 'Warden Down', desc: 'Defeat the Warden', goal: 1, stat: 'wardens', reward: { gold: 80, gems: 10 } },
  { id: 'evolve', name: 'Evolution', desc: 'Evolve a weapon', goal: 1, stat: 'evolutions', reward: { gold: 120, gems: 15 } },
  { id: 'pets3', name: 'Pet Shop', desc: 'Own 3 different pets', goal: 3, stat: 'petsOwned', reward: { gems: 40 } },
  { id: 'nohit', name: 'Untouchable', desc: 'Survive 90 seconds without taking damage', goal: 90, stat: 'bestNoHit', reward: { gold: 100 }, time: true },
  { id: 'rank10', name: 'Rising Star', desc: 'Reach rank 10', goal: 10, stat: 'rank', reward: { gems: 50 } },
  { id: 'shop10', name: 'Investor', desc: 'Buy 10 upgrades', goal: 10, stat: 'shopBuys', reward: { gold: 120 } },
  { id: 'kills2500', name: 'Exterminator', desc: 'Destroy 2,500 enemies', goal: 2500, stat: 'kills', reward: { gold: 150 } },
  { id: 'survive6', name: 'Veteran', desc: 'Survive 6 minutes in one run', goal: 360, stat: 'bestTime', reward: { gold: 150, gems: 20 }, time: true },
  { id: 'login7', name: 'Regular', desc: 'Claim 7 daily login rewards', goal: 7, stat: 'logins', reward: { gems: 50 } },
  { id: 'dq20', name: 'Daily Grind', desc: 'Complete 20 daily quests', goal: 20, stat: 'dqDone', reward: { gems: 100 } },
  { id: 'runkills', name: 'Rampage', desc: 'Destroy 1,500 enemies in one run', goal: 1500, stat: 'bestKills', reward: { gold: 150, gems: 20 } },
  { id: 'pilots6', name: 'Squadron', desc: 'Unlock 6 pilots', goal: 6, stat: 'pilots', reward: { gems: 80 } },
  { id: 'queen', name: 'Queen Slayer', desc: 'Defeat the Hive Queen', goal: 1, stat: 'queens', reward: { gold: 400, gems: 50 } },
  { id: 'mastery5', name: 'Ace', desc: 'Reach mastery 5 with any pilot', goal: 5, stat: 'maxMastery', reward: { gems: 60 } },
  { id: 'coop', name: 'Squad Up', desc: 'Finish a co-op run', goal: 1, stat: 'coopRuns', reward: { gems: 40 } },
  { id: 'duel3', name: 'Duelist', desc: 'Win 3 duels', goal: 3, stat: 'duelWins', reward: { gems: 60 } },
  { id: 'raid', name: 'Raider', desc: 'Help bring down a raid boss', goal: 1, stat: 'raidsHelped', reward: { gems: 80 } },
  { id: 'sector3', name: 'Deep Space', desc: 'Unlock Sector 3', goal: 3, stat: 'sectorMax', reward: { gems: 80 } },
  { id: 'codex', name: 'Mad Scientist', desc: 'Discover all 9 evolutions', goal: 9, stat: 'evosFound', reward: { gold: 500, gems: 100 } },
  { id: 'legend', name: 'Legendary', desc: 'Hatch a legendary pet', goal: 1, stat: 'legendaries', reward: { gems: 100 } },
  { id: 'rank25', name: 'Commander', desc: 'Reach rank 25', goal: 25, stat: 'rank', reward: { gems: 150 } },
  { id: 'pets10', name: 'Menagerie', desc: 'Own all 10 pets', goal: 10, stat: 'petsOwned', reward: { gems: 200 } },
  { id: 'kills10k', name: 'Swarm Breaker', desc: 'Destroy 10,000 enemies', goal: 10000, stat: 'kills', reward: { gold: 400, gems: 50 } },
  { id: 'pilots10', name: 'Full Roster', desc: 'Unlock all 10 pilots', goal: 10, stat: 'pilots', reward: { gems: 300 } },
  { id: 'sector5', name: 'Abyss Walker', desc: 'Defeat the Queen in Sector 5', goal: 5, stat: 'sectorCleared', reward: { gems: 400 } },
];

// Daily quests: 3 a day from this pool. stat is summed over the day, unless best: true (one run).
const DAILY_POOL = [
  { id: 'kills', text: 'Destroy {g} enemies', goal: 700, stat: 'kills' },
  { id: 'runs', text: 'Play {g} runs', goal: 3, stat: 'runs' },
  { id: 'survive', text: 'Survive {g} in one run', goal: 300, stat: 'time', best: true, time: true },
  { id: 'chests', text: 'Open {g} chests', goal: 3, stat: 'chests' },
  { id: 'wardens', text: 'Defeat {g} Wardens', goal: 2, stat: 'wardens' },
  { id: 'elites', text: 'Defeat {g} elite enemies', goal: 3, stat: 'elites' },
  { id: 'evo', text: 'Evolve a weapon', goal: 1, stat: 'evolutions' },
  { id: 'level', text: 'Reach level {g} in one run', goal: 18, stat: 'level', best: true },
  { id: 'gold', text: 'Earn {g} gold', goal: 400, stat: 'gold' },
  { id: 'daily', text: 'Play the daily run', goal: 1, stat: 'dailyRuns' },
  { id: 'coop', text: 'Play a co-op run', goal: 1, stat: 'coopRuns', online: true },
  { id: 'duel', text: 'Play a duel', goal: 1, stat: 'duels', online: true },
  { id: 'raid', text: 'Deal {g} raid damage', goal: 100000, stat: 'raidDmg', online: true },
  { id: 'nohit', text: 'Go {g} without taking damage', goal: 60, stat: 'noHit', best: true, time: true },
];
const DAILY_REWARD = { gold: 75, gems: 10 };
const DAILY_BONUS = { gems: 30 };

// 7-day login calendar; advances one step per day you claim, never resets.
const LOGIN_REWARDS = [
  { gold: 100 }, { gems: 15 }, { gold: 200 }, { gems: 25 }, { gold: 300 }, { gems: 40 }, { egg: 'basic', gems: 30 },
];

// Rank road rewards for reaching each rank (index = rank). Ranks past the table follow rankReward().
const RANK_REWARDS = [
  null, null,
  { gold: 100 }, { gems: 20 }, { pilot: 'mina' }, { egg: 'basic' }, { gold: 150 }, { gems: 30 },
  { unlock: 'Upgrade ranks 6-10' }, { gold: 200 }, { egg: 'basic', gems: 50 }, { gold: 250 },
  { unlock: 'Second pet slot' }, { gems: 40 }, { gold: 300 }, { pilot: 'echo' }, { egg: 'basic' }, { gems: 50 },
  { gold: 400 }, { gems: 50 }, { egg: 'royal' },
];
const PET_SLOT2_RANK = 12;
const RANK_CAP = 50;

function rankReward(r) {
  if (RANK_REWARDS[r] !== undefined) return RANK_REWARDS[r];
  const k = r % 5;
  if (k === 0) return { egg: 'royal', gems: 50 };
  if (k === 1 || k === 4) return { gold: 300 + r * 10 };
  if (k === 2) return { gems: 40 };
  return { egg: 'basic' };
}

// XP to go from rank r to r+1
function rankXpFor(r) {
  return 100 + 40 * (r - 1) + 3 * (r - 1) * (r - 1);
}

// Pilot mastery: total XP needed for each level 1-10
const MASTERY_XP = [0, 0, 300, 800, 1500, 2500, 4000, 6000, 8500, 11500, 15000];

const DAILY_MODS = [
  { id: 'glass', name: 'Glass Cannon', desc: 'Double damage, half health.', apply: (s) => { s.might *= 2; s.maxHp *= 0.5; } },
  { id: 'hyper', name: 'Hyperdrive', desc: 'The whole game runs 25% faster. +50% gold.', apply: (s) => { s.gameSpeed = 1.25; s.goldMul *= 1.5; } },
  { id: 'horde', name: 'The Horde', desc: '60% more enemies. +30% XP.', apply: (s) => { s.enemyCount = 1.6; s.xpMul *= 1.3; } },
  { id: 'giants', name: 'Giants', desc: 'Huge enemies with double health. Double XP.', apply: (s) => { s.enemySize = 1.45; s.enemyHp = 2; s.xpMul *= 2; } },
  { id: 'magnetic', name: 'Magnetic', desc: 'Enormous pickup range, but enemies are 20% faster.', apply: (s) => { s.magnet += 2.5; s.enemySpeed = 1.2; } },
  { id: 'arsenal', name: 'Random Arsenal', desc: 'Start with a random extra weapon and passive.', apply: () => {} },
  { id: 'iron', name: 'Iron Will', desc: 'No healing of any kind. Triple gold.', apply: (s) => { s.noHeal = true; s.goldMul *= 3; } },
];

function dailyMod(key = utcDay()) {
  return DAILY_MODS[hashStr('neon-swarm-' + key) % DAILY_MODS.length];
}

// Everyone gets the same level-up offers on the same daily.
function dailySeed(key = utcDay()) {
  return hashStr('neon-swarm-seed-' + key) >>> 0;
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
