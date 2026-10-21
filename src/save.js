'use strict';
/* Neon Swarm — persistent progress (localStorage with in-memory fallback) */

const SAVE_KEY = 'neon-swarm.save.v1';

function defaultSave() {
  return {
    v: 1,
    gold: 0,
    shop: {},
    chars: { volt: true },
    selChar: 'volt',
    stats: {
      kills: 0, runs: 0, queens: 0, wardens: 0, evolutions: 0, shopBuys: 0, dailyRuns: 0,
      bestTime: 0, bestLevel: 0, bestNoHit: 0, bestKills: 0, bestScore: 0, totalGold: 0,
    },
    claimed: {},
    codex: {},
    settings: { sfx: true, music: true, haptics: true, shake: true, dmgNums: true },
    daily: { last: '', streak: 0, best: {} },
    run: null,
    seenTutorial: false,
    quality: 2,
  };
}

let save = defaultSave();
let storageOk = true;

function mergeSave(base, data) {
  for (const k in data) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && data[k] && typeof data[k] === 'object') {
      mergeSave(base[k], data[k]);
    } else if (data[k] !== undefined) {
      base[k] = data[k];
    }
  }
  return base;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = mergeSave(defaultSave(), JSON.parse(raw));
  } catch (e) {
    storageOk = false;
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  return save;
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
}

function shopRank(id) {
  return save.shop[id] || 0;
}

function questValue(q) {
  if (q.stat === 'pilots') return Object.keys(save.chars).filter((k) => save.chars[k]).length;
  if (q.stat === 'evosFound') return Object.keys(save.codex).length;
  return save.stats[q.stat] || 0;
}

function questsClaimable() {
  return QUESTS.filter((q) => !save.claimed[q.id] && questValue(q) >= q.goal).length;
}

// Save codes let progress move between Safari and the home-screen app,
// which iOS keeps in separate storage.
function exportSaveCode() {
  const data = Object.assign({}, save, { run: null });
  return 'NS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

function importSaveCode(code) {
  code = String(code || '').trim();
  if (!code.startsWith('NS1.')) return false;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
    if (!data || typeof data !== 'object' || typeof data.gold !== 'number') return false;
    save = mergeSave(defaultSave(), data);
    save.run = null;
    writeSave();
    return true;
  } catch (e) {
    return false;
  }
}

function touchDaily() {
  const k = todayKey(), d = save.daily;
  if (d.last === k) return;
  d.streak = d.last && dayDiff(d.last, k) === 1 ? d.streak + 1 : 1;
  d.last = k;
  writeSave();
}

function currentStreak() {
  const d = save.daily;
  if (!d.last) return 0;
  return dayDiff(d.last, todayKey()) <= 1 ? d.streak : 0;
}
