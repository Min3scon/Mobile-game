'use strict';
/* Neon Swarm — persistent progress (localStorage with in-memory fallback, optional cloud copy) */

const SAVE_KEY = 'neon-swarm.save.v1';

function defaultSave() {
  return {
    v: 2,
    gold: 0,
    gems: 0,
    shop: {},
    chars: { volt: true },
    selChar: 'volt',
    sector: 1,
    sectorMax: 1,
    rank: 1,
    rankXp: 0,
    rankClaimed: 1,
    mastery: {},
    pets: {},
    petSlots: [null, null],
    eggs: { basic: 0, royal: 0 },
    stats: {
      kills: 0, runs: 0, queens: 0, wardens: 0, evolutions: 0, shopBuys: 0, dailyRuns: 0,
      bestTime: 0, bestLevel: 0, bestNoHit: 0, bestKills: 0, bestScore: 0, totalGold: 0,
      logins: 0, dqDone: 0, coopRuns: 0, coopWins: 0, duels: 0, duelWins: 0, raidsHelped: 0,
      legendaries: 0, sectorCleared: 0, maxMastery: 1, hatched: 0,
    },
    claimed: {},
    codex: {},
    settings: { sfx: true, music: true, haptics: true, shake: true, dmgNums: true },
    daily: { last: '', streak: 0, best: {} },
    login: { step: 0, last: '' },
    dq: { day: '', list: [], prog: {}, bonus: false },
    raidClaimed: {},
    run: null,
    seenTutorial: false,
    quality: 2,
    updatedAt: 0,
  };
}

let save = defaultSave();
let storageOk = true;
let saveTampered = false;
let saveListeners = [];
const SAVE_SALT = 'ns|7f3c91d2|swarm';

function signSave(json) {
  return cyrb53(SAVE_SALT + json + json.length, 7);
}

// Wraps progress with a signature; anything edited by hand fails the check.
function packSave(data) {
  const d = JSON.stringify(data);
  return { d, h: signSave(d) };
}

function unpackSave(obj) {
  if (obj && typeof obj.d === 'string' && obj.h === signSave(obj.d)) {
    try { return JSON.parse(obj.d); } catch (e) { return null; }
  }
  return null;
}

function mergeSave(base, data) {
  for (const k in data) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
      mergeSave(base[k], data[k]);
    } else if (data[k] !== undefined) {
      base[k] = data[k];
    }
  }
  return base;
}

// Older saves priced pilots in gold and had no gems; keep what players earned.
function migrateSave(s) {
  if (!s.v || s.v < 2) {
    s.v = 2;
    if (s.chars.prism === undefined && s.stats.queens > 0) s.chars.prism = true;
  }
  if (!Array.isArray(s.petSlots)) s.petSlots = [null, null];
  return s;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      let data = unpackSave(obj);
      if (!data && obj && obj.d === undefined && (!obj.v || obj.v === 1)) {
        // Saves from the first version were unsigned; accept them once with sane limits.
        data = obj;
        data.gold = Math.min(+data.gold || 0, 20000);
        data.gems = 0;
      }
      if (data) save = migrateSave(mergeSave(defaultSave(), data));
      else saveTampered = true;
    }
  } catch (e) {
    storageOk = false;
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  return save;
}

// quiet: store locally without notifying listeners (used for sync bookkeeping).
function writeSave(quiet) {
  if (!quiet) save.updatedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(packSave(save)));
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
  if (!quiet) for (const fn of saveListeners) fn();
}

function onSaveWrite(fn) {
  saveListeners.push(fn);
}

// Replace progress wholesale (cloud restore, save code import).
function replaceSave(data) {
  const keepSettings = Object.assign({}, save.settings);
  save = migrateSave(mergeSave(defaultSave(), data || {}));
  save.settings = Object.assign(keepSettings, (data && data.settings) || {});
  save.run = null;
}

function shopRank(id) {
  return save.shop[id] || 0;
}

// Save codes let progress move between Safari and the home-screen app,
// which iOS keeps in separate storage.
function exportSaveCode() {
  const p = packSave(Object.assign({}, save, { run: null }));
  return 'NS2.' + btoa(unescape(encodeURIComponent(p.d))) + '.' + p.h;
}

function importSaveCode(code) {
  code = String(code || '').trim();
  const m = /^NS2\.([A-Za-z0-9+/=]+)\.([a-z0-9]+)$/.exec(code);
  if (!m) return false;
  try {
    const data = unpackSave({ d: decodeURIComponent(escape(atob(m[1]))), h: m[2] });
    if (!data || typeof data.gold !== 'number') return false;
    replaceSave(data);
    writeSave();
    return true;
  } catch (e) {
    return false;
  }
}

function playedDailyToday() {
  return save.daily.last === utcDay();
}

function touchDaily() {
  const k = utcDay(), d = save.daily;
  if (d.last === k) return;
  d.streak = d.last && dayDiff(d.last, k) === 1 ? d.streak + 1 : 1;
  d.last = k;
  writeSave();
}

function currentStreak() {
  const d = save.daily;
  if (!d.last) return 0;
  return dayDiff(d.last, utcDay()) <= 1 ? d.streak : 0;
}
