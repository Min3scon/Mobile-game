'use strict';
/* Neon Swarm — reasons to come back: play streak, Neon Pass, weekly challenges, drone patrol, welcome back
   and menus that open up as you play. Days follow the server clock (see Clock in util.js). */

// ---------- play streak ----------
function streakNow() {
  const S = save.streak, today = todayKey();
  if (!S.last || !S.cur) return { cur: 0, today: false, risk: false, lost: S.lost, back: S.back };
  const gap = dayDiff(S.last, today);
  const alive = gap <= 1 || gap - 1 <= S.freezes;
  return { cur: alive ? S.cur : 0, today: gap === 0, risk: alive && gap >= 1, freezeNeeded: Math.max(0, gap - 1), ended: alive ? 0 : S.cur, lost: S.lost, back: S.back };
}

// Called for every run of at least STREAK_MIN_TIME. Returns what changed, for the results screen.
function tickStreak() {
  const S = save.streak, today = todayKey(), out = {};
  if (S.lost && dayDiff(S.lostAt, today) > 3) S.lost = 0;
  if (S.last !== today) {
    out.first = true;
    if (!S.last || !S.cur) {
      S.cur = 1;
      S.freezes = STREAK_FREEZES;
    } else {
      const gap = dayDiff(S.last, today);
      if (gap <= 1) S.cur++;
      else if (gap - 1 <= S.freezes) { S.freezes -= gap - 1; S.cur++; out.froze = gap - 1; }
      else { S.lost = S.cur; S.lostAt = today; S.back = 0; S.cur = 1; S.freezes = STREAK_FREEZES; out.lost = S.lost; }
    }
    if (S.cur % 7 === 0) S.freezes = Math.min(STREAK_FREEZES, S.freezes + 1);
    S.last = today;
  }
  if (S.lost) {
    S.back++;
    if (S.back >= STREAK_EARN_BACK) {
      S.cur += S.lost;
      out.restored = S.cur;
      S.lost = 0;
      S.back = 0;
    }
  }
  S.best = Math.max(S.best, S.cur);
  out.cur = S.cur;
  return out;
}

function streakClaimable() {
  return STREAK_MILESTONES.filter((m) => save.streak.best >= m.days && !save.streak.claimed[m.days]).length;
}

function claimStreak(days) {
  const m = STREAK_MILESTONES.find((x) => x.days === days);
  if (!m || save.streak.best < days || save.streak.claimed[days]) return null;
  save.streak.claimed[days] = true;
  const got = grant(m.reward);
  writeSave();
  return got;
}

// ---------- Neon Pass ----------
const DAY_MS = 86400000;

function seasonIndex(now = Clock.now()) {
  return Math.floor((now - SEASON_EPOCH) / (SEASON_DAYS * DAY_MS));
}

function seasonStart(i = seasonIndex()) {
  return SEASON_EPOCH + i * SEASON_DAYS * DAY_MS;
}

function seasonTrails(i = seasonIndex()) {
  return SEASON_TRAILS[((i % SEASON_TRAILS.length) + SEASON_TRAILS.length) % SEASON_TRAILS.length];
}

// Pass rewards name 'season' trails; each season fills them in with its own.
function passReward(t) {
  const r = Object.assign({}, PASS_REWARDS[t]);
  if (r.trail === 'season') r.trail = seasonTrails()[0];
  else if (r.trail === 'season2') r.trail = seasonTrails()[1];
  return r;
}

function ensurePass() {
  const i = seasonIndex();
  if (save.pass.season === i) return;
  // Tier 1 is free, so every season starts with something to claim.
  save.pass = { season: i, xp: PASS_TIER_XP, claimed: 0, boostUntil: save.pass.boostUntil || 0 };
  writeSave(true);
}

function passTier() {
  ensurePass();
  return Math.min(PASS_TIERS, Math.floor(save.pass.xp / PASS_TIER_XP));
}

// Falling behind the pace for finishing in about three weeks doubles run XP.
function passBoosted() {
  ensurePass();
  const elapsed = clamp((Clock.now() - seasonStart()) / (SEASON_DAYS * DAY_MS), 0, 1);
  return save.pass.boostUntil > Clock.now() || save.pass.xp < elapsed * PASS_TIERS * PASS_TIER_XP * 0.8;
}

function addPassXp(n, fromRun) {
  ensurePass();
  const before = passTier(), xp = Math.round(n * (fromRun && passBoosted() ? 2 : 1));
  save.pass.xp = Math.min(PASS_TIERS * PASS_TIER_XP, save.pass.xp + xp);
  return { xp, tiers: passTier() - before, tier: passTier() };
}

function passClaimable() {
  return passTier() - save.pass.claimed;
}

function claimPass() {
  const tier = passTier();
  if (tier <= save.pass.claimed) return null;
  let got = [];
  for (let t = save.pass.claimed + 1; t <= tier; t++) got = got.concat(grant(passReward(t)));
  save.pass.claimed = tier;
  writeSave();
  return got;
}

// ---------- weekly challenges ----------
function weekKey(d = Clock.date()) {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function weekEnds() {
  return Date.parse(weekKey() + 'T00:00:00Z') + 7 * DAY_MS;
}

function ensureWeekly() {
  const wk = weekKey();
  if (save.weekly.week === wk && save.weekly.list.length) return;
  const rng = mulberry32(hashStr('wk-' + wk)), pool = WEEKLY_POOL.slice(), list = [];
  while (list.length < WEEKLY_COUNT && pool.length) list.push({ id: pool.splice(Math.floor(rng() * pool.length), 1)[0].id, claimed: false });
  save.weekly = { week: wk, list, prog: {}, pilots: [] };
  writeSave(true);
}

function weeklyDef(id) {
  return WEEKLY_POOL.find((q) => q.id === id);
}

function weeklyProgress(id) {
  return Math.min(save.weekly.prog[id] || 0, weeklyDef(id).goal);
}

function weeklyText(def) {
  return def.text.replace('{g}', def.time ? fmtTime(def.goal) : fmtInt(def.goal));
}

function trackWeekly(stats, charId) {
  ensureWeekly();
  const W = save.weekly;
  if (charId && !W.pilots.includes(charId)) W.pilots.push(charId);
  for (const q of W.list) {
    const def = weeklyDef(q.id);
    if (def.stat === 'pilots') W.prog[q.id] = W.pilots.length;
    else if (def.best) W.prog[q.id] = Math.max(W.prog[q.id] || 0, stats[def.stat] || 0);
    else W.prog[q.id] = (W.prog[q.id] || 0) + (stats[def.stat] || 0);
  }
}

function weeklyClaimable() {
  ensureWeekly();
  return save.weekly.list.filter((q) => !q.claimed && weeklyProgress(q.id) >= weeklyDef(q.id).goal).length;
}

function claimWeekly(id) {
  const q = save.weekly.list.find((x) => x.id === id);
  if (!q || q.claimed || weeklyProgress(id) < weeklyDef(id).goal) return null;
  q.claimed = true;
  const got = grant(WEEKLY_REWARD);
  const p = addPassXp(PASS_XP.weekly);
  got.push(`${p.xp} Pass XP`);
  writeSave();
  return got;
}

// ---------- drone patrol ----------
function patrolRate() {
  return 8 + 4 * save.sectorMax + save.rank; // gold per hour
}

function patrolHours() {
  if (!save.patrol.last) return 0;
  return clamp((Clock.now() - save.patrol.last) / 3600000, 0, PATROL_CAP_H);
}

function patrolLoot() {
  const h = patrolHours();
  return { gold: Math.floor(h * patrolRate()), gems: Math.floor(h / 3) };
}

function patrolReady() {
  return patrolHours() * 60 >= PATROL_MIN_MIN;
}

function startPatrol() {
  if (!save.patrol.last) { save.patrol.last = Clock.now(); writeSave(true); }
}

function claimPatrol() {
  if (!patrolReady()) return null;
  const got = grant(patrolLoot());
  save.patrol.last = Clock.now();
  writeSave();
  return got;
}

// ---------- welcome back ----------
// Only called once the server clock is known, so a changed phone date can't fake an absence.
function checkComeback() {
  const today = todayKey(), last = save.lastSeen;
  save.lastSeen = today;
  if (!last || save.stats.runs < 1 || last === today) { writeSave(true); return null; }
  const days = dayDiff(last, today);
  if (days < COMEBACK_DAYS) { writeSave(true); return null; }
  const gems = Math.min(100, 20 + 10 * (days - COMEBACK_DAYS));
  grant({ gems });
  ensurePass();
  save.pass.boostUntil = Clock.now() + 3 * DAY_MS;
  writeSave();
  return { days, gems };
}

// ---------- menus open up as you play ----------
const UNLOCKS = { hangar: 1, quests: 1, online: 1, daily: 2 };

function featureOpen(id) {
  return save.stats.runs >= (UNLOCKS[id] || 0);
}

function featureNew(id) {
  return featureOpen(id) && UNLOCKS[id] > 0 && !save.unlockSeen[id];
}

function markSeen(id) {
  if (UNLOCKS[id] && !save.unlockSeen[id] && featureOpen(id)) { save.unlockSeen[id] = true; writeSave(true); }
}

// ---------- the one goal to show on the home screen ----------
function homeGoal() {
  const goals = [];
  ensureDailyQuests();
  for (const q of save.dq.list) {
    if (q.claimed) continue;
    const def = dailyDef(q.id);
    goals.push({ text: dailyText(def), v: dailyProgress(q.id), goal: def.goal, time: def.time, to: 'quests' });
  }
  ensureWeekly();
  for (const q of save.weekly.list) {
    if (q.claimed) continue;
    const def = weeklyDef(q.id);
    goals.push({ text: weeklyText(def), v: weeklyProgress(q.id), goal: def.goal, time: def.time, to: 'pass' });
  }
  for (const q of QUESTS) {
    if (save.claimed[q.id]) continue;
    goals.push({ text: q.desc, v: Math.min(questValue(q), q.goal), goal: q.goal, time: q.time, to: 'quests' });
  }
  const open = goals.filter((g) => g.v < g.goal);
  open.sort((a, b) => b.v / b.goal - a.v / a.goal);
  return open[0] || null;
}
