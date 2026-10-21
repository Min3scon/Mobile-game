'use strict';
/* Neon Swarm — account progression: currencies, rank road, pilots, pets, daily rewards, quests and run rewards */

function grant(r, why) {
  const got = [];
  if (!r) return got;
  if (r.gold) { save.gold += r.gold; got.push(`${fmtInt(r.gold)} gold`); }
  if (r.gems) { save.gems += r.gems; got.push(`${fmtInt(r.gems)} gems`); }
  if (r.egg) { save.eggs[r.egg] = (save.eggs[r.egg] || 0) + 1; got.push(EGGS[r.egg].name); }
  if (r.pilot && !save.chars[r.pilot]) { save.chars[r.pilot] = true; got.push(`Pilot ${CHARS[r.pilot].name}`); }
  if (r.trail && TRAILS[r.trail]) {
    if (!save.trails[r.trail]) { save.trails[r.trail] = true; got.push(`${TRAILS[r.trail].name} trail`); }
    else { save.gems += 25; got.push('25 gems (trail already owned)'); }
  }
  if (r.unlock) got.push(r.unlock);
  return got;
}

function rewardText(r) {
  if (!r) return '';
  const p = [];
  if (r.gold) p.push(`${fmtInt(r.gold)} gold`);
  if (r.gems) p.push(`${fmtInt(r.gems)} gems`);
  if (r.egg) p.push(EGGS[r.egg].name);
  if (r.pilot) p.push(`Pilot: ${CHARS[r.pilot].name}`);
  if (r.trail && TRAILS[r.trail]) p.push(`${TRAILS[r.trail].name} trail`);
  if (r.unlock) p.push(r.unlock);
  return p.join(' + ');
}

// ---------- rank ----------
function runRankXp(result) {
  return Math.round(40 + result.score / 25);
}

function addRankXp(xp) {
  const gained = [];
  save.rankXp += xp;
  while (save.rank < RANK_CAP && save.rankXp >= rankXpFor(save.rank)) {
    save.rankXp -= rankXpFor(save.rank);
    save.rank++;
    gained.push(save.rank);
  }
  if (save.rank >= RANK_CAP) save.rankXp = Math.min(save.rankXp, rankXpFor(RANK_CAP));
  return gained;
}

function rankClaimable() {
  return Math.max(0, save.rank - save.rankClaimed);
}

function claimRankRewards() {
  const got = [];
  while (save.rankClaimed < save.rank) {
    save.rankClaimed++;
    got.push(...grant(rankReward(save.rankClaimed)));
  }
  writeSave();
  return got;
}

function shopUnlockedMax(it) {
  if (it.need && save.rank < it.need) return 0;
  return it.tier2 && save.rank < SHOP_TIER2_RANK ? Math.min(5, it.max) : it.max;
}

// ---------- pilots ----------
function masteryLevel(charId) {
  const xp = save.mastery[charId] || 0;
  let lvl = 1;
  for (let i = 2; i < MASTERY_XP.length; i++) if (xp >= MASTERY_XP[i]) lvl = i;
  return lvl;
}

function masteryProgress(charId) {
  const lvl = masteryLevel(charId), xp = save.mastery[charId] || 0;
  if (lvl >= 10) return { lvl, frac: 1 };
  return { lvl, frac: (xp - MASTERY_XP[lvl]) / (MASTERY_XP[lvl + 1] - MASTERY_XP[lvl]) };
}

function pilotUnlocked(id) {
  return !!save.chars[id];
}

function canUnlockPilot(id) {
  const u = CHARS[id].unlock;
  if (pilotUnlocked(id)) return false;
  if (u.gold) return save.gold >= u.gold;
  if (u.gems) return save.gems >= u.gems;
  return false;
}

function buyPilot(id) {
  const u = CHARS[id].unlock;
  if (!canUnlockPilot(id)) return false;
  if (u.gold) save.gold -= u.gold;
  if (u.gems) save.gems -= u.gems;
  save.chars[id] = true;
  writeSave();
  return true;
}

// Pilots unlocked by rank or by beating sectors arrive automatically.
function autoUnlockPilots() {
  const got = [];
  for (const id in CHARS) {
    const u = CHARS[id].unlock;
    if (save.chars[id]) continue;
    if ((u.rank && save.rank >= u.rank) || (u.queen && save.stats.queens > 0) || (u.sector && save.sectorMax >= u.sector)) {
      save.chars[id] = true;
      got.push(id);
    }
  }
  return got;
}

// ---------- pets ----------
function petSlotsUnlocked() {
  return save.rank >= PET_SLOT2_RANK ? 2 : 1;
}

function equippedPets() {
  const out = [];
  for (let i = 0; i < petSlotsUnlocked(); i++) {
    const id = save.petSlots[i];
    if (id && save.pets[id]) out.push({ id, stars: save.pets[id].stars });
  }
  return out;
}

function equipPet(id, slot) {
  if (!save.pets[id]) return;
  const other = save.petSlots.indexOf(id);
  if (other >= 0) save.petSlots[other] = null;
  save.petSlots[slot] = id;
  writeSave();
}

function unequipPet(slot) {
  save.petSlots[slot] = null;
  writeSave();
}

function rollPet(eggId) {
  const odds = EGGS[eggId].odds;
  let r = Math.random() * 100, rarity = 0;
  for (let i = 0; i < odds.length; i++) {
    if (r < odds[i]) { rarity = i; break; }
    r -= odds[i];
    rarity = i;
  }
  const pool = Object.keys(PETS).filter((id) => PETS[id].rarity === rarity);
  return pick(pool);
}

// Spend an owned egg (or gems if none) and hatch it.
function hatchEgg(eggId) {
  const egg = EGGS[eggId];
  if ((save.eggs[eggId] || 0) > 0) save.eggs[eggId]--;
  else if (save.gems >= egg.cost) save.gems -= egg.cost;
  else return null;
  const id = rollPet(eggId);
  const owned = save.pets[id];
  const res = { id, isNew: !owned, starUp: false, stars: 1 };
  if (!owned) {
    save.pets[id] = { stars: 1, dupes: 0 };
    if (!save.petSlots[0]) save.petSlots[0] = id;
  } else if (owned.stars < PET_MAX_STARS) {
    owned.dupes++;
    if (owned.dupes >= PET_DUPES[owned.stars]) {
      owned.dupes = 0;
      owned.stars++;
      res.starUp = true;
    }
    res.stars = owned.stars;
  } else {
    // Maxed pets turn into gems instead.
    const refund = [10, 25, 60, 150][PETS[id].rarity];
    save.gems += refund;
    res.refund = refund;
    res.stars = owned.stars;
  }
  save.stats.hatched++;
  if (PETS[id].rarity === 3 && res.isNew) save.stats.legendaries++;
  writeSave();
  return res;
}

// ---------- login calendar ----------
function loginReady() {
  return save.login.last !== todayKey();
}

function claimLogin() {
  if (!loginReady()) return null;
  const step = save.login.step % LOGIN_REWARDS.length;
  const got = grant(LOGIN_REWARDS[step]);
  save.login.step++;
  save.login.last = todayKey();
  save.stats.logins++;
  writeSave();
  return { step, got };
}

// ---------- daily quests ----------
function ensureDailyQuests() {
  const day = todayKey();
  if (save.dq.day === day && save.dq.list.length) return;
  const rng = mulberry32(hashStr('dq-' + day));
  const pool = DAILY_POOL.filter((q) => !q.online || Online.available);
  const list = [];
  while (list.length < 3 && pool.length) {
    const i = Math.floor(rng() * pool.length);
    list.push({ id: pool[i].id, claimed: false });
    pool.splice(i, 1);
  }
  save.dq = { day, list, prog: {}, bonus: false };
  writeSave();
}

function dailyDef(id) {
  return DAILY_POOL.find((q) => q.id === id);
}

function dailyProgress(id) {
  return Math.min(save.dq.prog[id] || 0, dailyDef(id).goal);
}

function dailyText(def) {
  return def.text.replace('{g}', def.time ? fmtTime(def.goal) : fmtInt(def.goal));
}

function trackDaily(stats) {
  ensureDailyQuests();
  for (const q of save.dq.list) {
    const def = dailyDef(q.id);
    const v = stats[def.stat] || 0;
    save.dq.prog[q.id] = def.best ? Math.max(save.dq.prog[q.id] || 0, v) : (save.dq.prog[q.id] || 0) + v;
  }
}

function dailyClaimable() {
  ensureDailyQuests();
  let n = save.dq.list.filter((q) => !q.claimed && dailyProgress(q.id) >= dailyDef(q.id).goal).length;
  if (!save.dq.bonus && save.dq.list.every((q) => q.claimed)) n++;
  return n;
}

function claimDaily(id) {
  const q = save.dq.list.find((x) => x.id === id);
  if (!q || q.claimed || dailyProgress(id) < dailyDef(id).goal) return null;
  q.claimed = true;
  save.stats.dqDone++;
  const got = grant(DAILY_REWARD);
  got.push(`${addPassXp(PASS_XP.dailyQuest).xp} Pass XP`);
  writeSave();
  return got;
}

function claimDailyBonus() {
  if (save.dq.bonus || !save.dq.list.every((q) => q.claimed)) return null;
  save.dq.bonus = true;
  const got = grant(DAILY_BONUS);
  got.push(`${addPassXp(PASS_XP.dailyBonus).xp} Pass XP`);
  writeSave();
  return got;
}

// ---------- achievements ----------
function questValue(q) {
  if (q.stat === 'pilots') return Object.keys(save.chars).filter((k) => save.chars[k]).length;
  if (q.stat === 'evosFound') return Object.keys(save.codex).length;
  if (q.stat === 'petsOwned') return Object.keys(save.pets).length;
  if (q.stat === 'rank') return save.rank;
  if (q.stat === 'sectorMax') return save.sectorMax;
  return save.stats[q.stat] || 0;
}

function questsClaimable() {
  return QUESTS.filter((q) => !save.claimed[q.id] && questValue(q) >= q.goal).length;
}

function claimQuest(id) {
  const q = QUESTS.find((x) => x.id === id);
  if (!q || save.claimed[q.id] || questValue(q) < q.goal) return null;
  save.claimed[q.id] = true;
  const got = grant(q.reward);
  writeSave();
  return got;
}

// ---------- run results ----------
// Applies a finished run to the account and returns a summary for the results screen.
// ---------- protocols ----------
function protocolUnlocked(id) {
  return !!PROTOCOLS[id] && (!PROTOCOLS[id].unlock || !!save.protocols[id]);
}

function unlockedProtocols() {
  return Object.keys(PROTOCOLS).filter(protocolUnlocked);
}

function checkProtocolUnlocks(r) {
  const out = [];
  for (const id in PROTOCOLS) {
    const u = PROTOCOLS[id].unlock;
    let hit = false;
    try { hit = !!(u && !save.protocols[id] && u.test(r)); } catch (e) { hit = false; }
    if (hit) {
      save.protocols[id] = true;
      out.push(id);
    }
  }
  return out;
}

function applyRunResult(r, extra = {}) {
  const S = save.stats;
  const out = { gold: r.gold, gems: 0, dailyBonus: 0, rankXp: 0, ranks: [], newPilots: [], newBest: false, sectorUnlocked: 0, masteryUp: 0 };
  out.newProtocols = r.passives && r.weapons ? checkProtocolUnlocks(r) : [];
  if (r.daily) {
    out.dailyBonus = Math.round(r.gold * (0.5 + 0.1 * Math.min(5, Math.max(0, save.daily.streak - 1))));
    out.gold += out.dailyBonus;
    S.dailyRuns++;
    const k = utcDay();
    save.daily.best[k] = Math.max(save.daily.best[k] || 0, r.score);
  }
  out.newBest = r.score > S.bestScore && S.runs > 0;
  S.kills += r.kills;
  S.runs++;
  S.totalGold += out.gold;
  S.wardens += r.wardens;
  S.evolutions += r.evolutions;
  if (r.coop) S.coopRuns++;
  if (r.mode === 'duel') S.duels++;
  if (r.won) {
    S.queens++;
    if (r.coop) S.coopWins++;
    S.sectorCleared = Math.max(S.sectorCleared, r.sector);
    if (r.sector >= save.sectorMax && save.sectorMax < SECTORS.length - 1) {
      save.sectorMax = r.sector + 1;
      out.sectorUnlocked = save.sectorMax;
    }
  }
  S.bestTime = Math.max(S.bestTime, r.time);
  S.bestLevel = Math.max(S.bestLevel, r.level);
  S.bestKills = Math.max(S.bestKills, r.kills);
  S.bestNoHit = Math.max(S.bestNoHit, r.bestNoHit);
  S.bestScore = Math.max(S.bestScore, r.score);
  save.gold += out.gold;
  // Rank and pilot mastery
  out.rankXp = runRankXp(r);
  out.ranks = addRankXp(out.rankXp);
  const before = masteryLevel(r.charId);
  save.mastery[r.charId] = (save.mastery[r.charId] || 0) + out.rankXp;
  const after = masteryLevel(r.charId);
  if (after > before) out.masteryUp = after;
  S.maxMastery = Math.max(S.maxMastery, after);
  out.newPilots = autoUnlockPilots();
  trackDaily({
    kills: r.kills, runs: 1, time: r.time, chests: r.chests, wardens: r.wardens, elites: r.elites, evolutions: r.evolutions,
    level: r.level, gold: out.gold, dailyRuns: r.daily ? 1 : 0, coopRuns: r.coop ? 1 : 0, duels: r.mode === 'duel' ? 1 : 0,
    raidDmg: extra.raidDmg || 0, noHit: r.bestNoHit,
  });
  trackWeekly({
    kills: r.kills, chests: r.chests, beacons: r.beacons || 0, time: r.time, evolutions: r.evolutions, wardens: r.wardens,
    elites: r.elites, dailyRuns: r.daily ? 1 : 0, level: r.level, wins: r.won ? 1 : 0, gold: out.gold,
  }, r.charId);
  // Streak and Neon Pass
  out.streak = r.time >= STREAK_MIN_TIME ? tickStreak() : null;
  out.pass = addPassXp(PASS_XP.run + Math.floor(r.time / 30) * PASS_XP.perHalfMinute + (out.streak && out.streak.first ? PASS_XP.firstRunOfDay : 0), true);
  save.run = null;
  save.seenTutorial = true;
  writeSave();
  return out;
}

// Raid damage counts a fraction of what you dealt, so one run is a dent, not a kill.
function raidDamageFor(r) {
  return Math.min(400000, Math.round(r.dmg * 0.6));
}
