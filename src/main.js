'use strict';
/* Neon Swarm — boot, main loop, app lifecycle, cloud sync */

if (typeof Online === 'undefined') {
  // online.js missing: behave as a fully offline game.
  const off = async () => ({ ok: false, error: 'Online features are not available' });
  window.Online = {
    init: async () => {}, mode: 'off', available: false, user: null, onAuth: () => () => {}, onRecovery: () => {}, startRun: off, updatePassword: off, deleteAccount: off, status: 'failed: online.js did not load',
    signUp: off, signIn: off, signOut: off, resetPassword: off, setUsername: off, loadSave: async () => null, pushSave: off,
    checkpoint: off, reportRun: off, myStatus: async () => null, admin: off, league: async () => null, leagueClaim: off,
    submitScore: off, leaderboard: async () => [], myBest: async () => null, raid: async () => null, raidHit: off, raidClaim: off,
    duelCreate: off, duelGet: async () => null, duelSubmit: off, myDuels: async () => [], watchOnline: () => () => {}, room: null,
  };
}

let game = null;
let lastFrame = 0;
let swReg = null;
let pushTimer = 0, pendingCloud = null;
const perf = { acc: 0, frames: 0, slow: 0 };

const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

// Test switches only work on a developer's own machine, never on the published game.
function parseDebug() {
  if (!DEV) return;
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.has('bot')) DEBUG.bot = true;
  if (q.has('speed')) DEBUG.speed = Math.max(1, +q.get('speed') || 1);
  if (q.has('god')) DEBUG.god = true;
  if (q.has('t')) DEBUG.startAt = Math.max(0, (+q.get('t') || 0) * 60);
}

// Everything a ship needs from your account: shop ranks, pilot mastery and equipped pets.
function localMeta(charId) {
  return {
    shop: Object.assign({}, save.shop),
    mastery: masteryLevel(charId),
    pets: equippedPets(),
    trail: save.trails[save.trail] ? save.trail : '',
  };
}

function myName() {
  return (Online.user && Online.user.username) || CHARS[save.selChar].name;
}

let starting = false;

async function startRun(opts) {
  if (starting) return;
  if (Updater.idle()) return; // a new version is live: load it before the next run
  Sound.unlock();
  const resume = opts.resume || null;
  const charId = opts.charId || (resume ? resume.charId : save.selChar);
  const mode = resume ? resume.mode || (resume.daily ? 'daily' : 'normal') : opts.mode || 'normal';
  const sector = resume ? resume.sector || 1 : mode === 'normal' ? clamp(opts.sector || save.sector || 1, 1, save.sectorMax) : 1;
  let seed = resume ? resume.seed : opts.seed;
  let runId = resume ? resume.runId || null : null;
  if (mode === 'daily' && !resume) {
    if (playedDailyToday()) { UI.toast("You already played today's daily run. Come back tomorrow!"); return; }
    seed = dailySeed();
  }
  const online = Online.available && Online.user;
  // Daily and duel runs need their server ticket up front: it enforces once-a-day and the duel seed.
  if (!resume && online && (mode === 'daily' || mode === 'duel')) {
    starting = true;
    UI.toast('Connecting…');
    const res = await Online.startRun({ mode, sector, seed });
    starting = false;
    if (!res.ok && /already played/i.test(res.error || '')) {
      touchDaily();
      UI.toast(res.error);
      UI.rerender();
      return;
    }
    if (res.ok) runId = res.runId;
    else UI.toast('Playing offline: ' + res.error);
  }
  if (mode === 'daily' && !resume) touchDaily();
  game = new Game({
    mode, resume, sector, seed,
    ships: [{ id: 'me', name: myName(), charId, meta: localMeta(charId) }],
    localId: 'me',
    // Protocols open up after the first run, so the first one stays simple.
    protocols: save.stats.runs >= 1 ? unlockedProtocols() : [],
    hooks: { levelUp: UI.showLevelUp, chest: UI.showChest, protocol: UI.showProtocol, over: onRunOver },
  });
  game.duelCode = opts.duelCode || null;
  game.runId = runId;
  Guard.start(game);
  if (online) refreshStatus();
  if (!resume && online && !runId && mode === 'normal') {
    const g = game;
    Online.startRun({ mode, sector, seed: g.seed }).then((res) => { if (res.ok && game === g) g.runId = res.runId; });
  }
  beginGame();
}

// Shared by solo runs and co-op (coop.js builds its own Game).
function beginGame() {
  save.run = null;
  writeSave();
  perf.acc = perf.frames = perf.slow = 0;
  Input.setEnabled(true);
  if (!game.boss) Sound.setIntensity(0);
  if (save.settings.music) Sound.startMusic();
  UI.enterGame();
}

async function onRunOver(r) {
  Input.setEnabled(false);
  const duelCode = game && game.duelCode;
  const cheat = Guard.verify(game, r);
  if (cheat && r.runId && Online.user) Online.reportRun(r.runId, cheat);
  const online = Online.available && Online.user && r.runId && !cheat;
  const raidDmg = online && r.mode !== 'duel' && r.time > 20 ? raidDamageFor(r) : 0;
  const sum = applyRunResult(r, { raidDmg });
  UI.showOver(r, sum);
  if (!online) {
    if (cheat) UI.setOverOnline(`<p class="hint">${icon('shield')} Not posted: the anti-cheat check failed (${escHtml(cheat)}).</p>`);
    else if (playerStatus && playerStatus.ban && Online.user) UI.setOverOnline(`<p class="hint">${escHtml(banText(playerStatus.ban))}. Scores, raids and duels are off until then.</p>`);
    else if (Online.available && !Online.user) UI.setOverOnline(`<p class="hint">${icon('user')} <button class="link" data-act="go" data-to="account">Log in</button> to post scores and hit the raid boss.</p>`);
    else if (Online.available) UI.setOverOnline(`<p class="hint">This run was offline, so it was not posted.</p>`);
    return;
  }
  const lines = [];
  const paint = () => UI.setOverOnline(lines.join(''));
  if (r.mode === 'duel' && !duelCode) {
    lines.push(`<button class="btn" data-act="duel-send">${icon('swords')} Challenge a friend with this run</button>`);
    paint();
  }
  if (r.time >= 10 && (r.mode === 'normal' || r.mode === 'daily')) {
    const res = await Online.submitScore({
      runId: r.runId, score: r.score, time: Math.round(r.time), kills: r.kills, level: r.level, pilot: r.charId, won: r.won, sector: r.sector,
    });
    if (res.ok && res.flagged) lines.push(`<p class="hint">${icon('shield')} Score saved. It shows on the leaderboard once an admin checks it.</p>`);
    else if (res.ok && res.rank) lines.push(`<p class="unlock">${icon('star')} #${res.rank} on the ${r.mode === 'daily' ? 'daily' : 'all-time'} leaderboard</p>`);
    else if (!res.ok) lines.push(`<p class="hint">Score not posted: ${res.error}</p>`);
    paint();
  }
  if (raidDmg > 0) {
    const res = await Online.raidHit(raidDmg, r.runId, r.time);
    if (res.ok) lines.push(`<p class="unlock">${icon('boss')} ${fmtInt(res.damage)} raid damage${res.defeated ? ' · the raid boss is down!' : ''}</p>`);
    paint();
    refreshRaid();
  }
  if (duelCode) {
    const res = await Online.duelSubmit(duelCode, { runId: r.runId, score: r.score, time: Math.round(r.time), kills: r.kills });
    if (res.ok) {
      if (res.won) {
        save.stats.duelWins++;
        save.gems += 20;
        writeSave();
      }
      lines.push(`<p class="unlock">${icon('swords')} ${res.won ? 'You won the duel! +20 gems' : 'You lost the duel this time'}</p>`);
    } else lines.push(`<p class="hint">${res.error || 'Could not send your duel score'}</p>`);
    paint();
  }
}

function exitToMenu(keepScreen) {
  Guard.stop();
  if (game && !game.finished) {
    const snap = game.snapshot();
    if (snap) { save.run = snap; writeSave(); }
    if (game.role !== 'solo') Coop.leave();
  }
  game = null;
  Input.setEnabled(false);
  Sound.setIntensity(0);
  if (Updater.idle()) return;
  if (!keepScreen) UI.showMenu();
}

// ---------- player status (admin, bans) ----------
let playerStatus = null;

function banText(b) {
  return b.until ? `You are banned until ${new Date(b.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${b.reason ? ': ' + b.reason : ''}`
    : `You are banned permanently${b.reason ? ': ' + b.reason : ''}`;
}

async function refreshStatus() {
  const st = Online.user ? await Online.myStatus() : null;
  playerStatus = st;
  UI.setStatus(st, st && st.ban ? banText(st.ban) : '');
}

// ---------- cloud save ----------
function progressScore(s) {
  return (s.stats ? s.stats.runs || 0 : 0) * 10 + (s.rank || 1) * 100 + (s.stats ? s.stats.totalGold || 0 : 0) / 10;
}

async function cloudPush() {
  if (!Online.user) return false;
  clearTimeout(pushTimer);
  const res = await Online.pushSave(packSave(Object.assign({}, save, { run: null })));
  if (res.ok) {
    save.lastCloud = Date.now();
    writeSave(true);
  }
  return res.ok;
}

function scheduleCloudPush() {
  if (!Online.user || pendingCloud) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, 4000);
}

function cloudChoice(useCloud) {
  if (useCloud && pendingCloud) {
    replaceSave(pendingCloud);
    writeSave(true);
    UI.applySettings();
    UI.toast('Cloud progress loaded');
  }
  pendingCloud = null;
  cloudPush();
  UI.rerender();
}

async function onAuthChange(user) {
  UI.rerender();
  refreshStatus();
  if (!user) return;
  UI.retryInvite();
  const cloud = await Online.loadSave();
  const data = cloud && unpackSave(cloud.data);
  if (!data || typeof data.gold !== 'number') {
    cloudPush();
    return;
  }
  const local = progressScore(save), remote = progressScore(data);
  if (save.stats.runs === 0 && save.rank <= 1) {
    pendingCloud = data;
    cloudChoice(true);
  } else if (Math.abs(local - remote) < 1) {
    cloudPush();
  } else {
    pendingCloud = data;
    UI.modal(`<h2 class="title">Which progress?</h2><p class="sub">This device and your account have different progress.</p>
      <button class="btn primary" data-act="cloud-use">Use my account: rank ${data.rank || 1}, ${fmtInt((data.stats && data.stats.runs) || 0)} runs</button>
      <button class="btn" data-act="cloud-keep">Keep this device: rank ${save.rank}, ${fmtInt(save.stats.runs)} runs</button>
      <p class="lead">The one you don't pick is replaced.</p>`);
  }
}

async function refreshRaid() {
  if (!Online.available) return;
  const r = await Online.raid();
  if (r) UI.setRaid(r);
}

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  if (game) {
    game.frame(dt);
    Coop.tick(dt);
    Guard.tick();
    // A paused scene does not change, so draw it once and let the GPU rest.
    if (game.running() || !game._still || game.banner || game.role === 'client') {
      drawGame(game);
      game._still = !game.running();
    }
    autoQuality(dt);
  } else {
    drawAttract(dt);
  }
  UI.tick(dt);
}

// Drop resolution if the phone cannot hold a steady frame rate. A flat 30fps is
// Low Power Mode (or an inactive frame), where fewer pixels would not help.
function autoQuality(dt) {
  if (game.state !== 'play') return;
  perf.acc += dt;
  perf.frames++;
  if (perf.acc < 3) return;
  const fps = perf.frames / perf.acc;
  perf.acc = perf.frames = 0;
  if (fps > 33 && fps < 48 && View.cap > 1) {
    if (++perf.slow >= 2) {
      View.cap = Math.max(1, View.cap - 0.5);
      save.quality = View.cap;
      writeSave(true);
      resize();
      perf.slow = 0;
    }
  } else perf.slow = 0;
}

function onHide() {
  Updater.hidden();
  if (game && !game.finished) {
    if (game.pause()) UI.showPause(game);
    const snap = game.snapshot();
    if (snap) { save.run = snap; writeSave(); }
  }
  if (Online.user) cloudPush();
  Input.reset();
  Sound.suspend();
}

// Deterrents and local checks; the real protection is the server rejecting impossible results.
function guardDevtools() {
  if (DEV) return;
  Guard.trapDevtools();
  try {
    console.log('%cStop!', 'font: 700 42px sans-serif; color: #ff3d8b');
    console.log('%cThis is a developer tool. Scores, raids and duels are checked by the server, so edits here will not count.', 'font: 16px sans-serif');
  } catch (e) { /* no console */ }
  window.addEventListener('keydown', (e) => {
    const k = e.key ? e.key.toLowerCase() : '';
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && ['i', 'j', 'c'].includes(k)) || ((e.ctrlKey || e.metaKey) && k === 'u')) e.preventDefault();
  });
}

let onlineWired = false;

// Connects to the server and hooks up accounts, cloud save and presence. Safe to call again to retry.
async function connectOnline() {
  await Online.init();
  if (Online.available && !onlineWired) {
    onlineWired = true;
    Online.onRecovery(() => UI.showNewPassword());
    onSaveWrite(scheduleCloudPush);
    Online.onAuth(onAuthChange);
    if (Online.user) onAuthChange(Online.user);
    Online.watchOnline((n) => UI.setOnlineCount(n));
    refreshRaid();
  }
  UI.rerender();
  return Online.available;
}

// Runs once the server's time is known: start the drone patrol and greet returning players.
function onClockSync() {
  if (!Clock.synced) return;
  startPatrol();
  const back = checkComeback();
  if (game) return;
  if (back) UI.showComeback(back);
  UI.rerender();
}

function registerSW() {
  if (window.NS_EMBEDDED || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { swReg = r; }).catch(() => {});
}

async function boot(hot) {
  parseDebug();
  loadSave();
  if (hot && hot.run && !save.run) save.run = hot.run;
  View.cap = clamp(+save.quality || 2, 1, 2);
  Haptics.mount();
  setupCanvas(document.getElementById('game'));
  Input.attach(canvas);
  UI.init({ startRun, exitToMenu, getGame: () => game, cloudPush, cloudChoice, connectOnline, refreshStatus });
  UI.applySettings();
  autoUnlockPilots();
  UI.showMenu();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHide();
    else {
      lastFrame = performance.now();
      if (swReg) swReg.update().catch(() => {});
      Updater.check().then(onClockSync);
      if (!game) { UI.maybeShowLogin(); refreshRaid(); refreshStatus(); }
    }
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('resize', () => requestAnimationFrame(resize));
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  // iOS only lets a finger lift (not a press) start audio, and needs it again after interruptions.
  for (const t of ['pointerup', 'touchend', 'keydown']) window.addEventListener(t, () => Sound.unlock(), { capture: true, passive: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  window.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

  registerSW();
  Updater.init({ busy: () => !!game, running: () => !!(game && !game.finished) }).then(onClockSync);
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  if (DEV) window.__ns = { get game() { return game; }, get save() { return save; }, startRun, DEBUG };
  if (DEBUG.bot) startRun({ mode: 'normal' });
  if (saveTampered) setTimeout(() => UI.toast('Your saved progress was changed outside the game, so it was reset.'), 800);
  guardDevtools();

  await connectOnline();
  // Invite links look like ?join=ABCD; open the co-op room once online is ready.
  try {
    const join = new URLSearchParams(location.search).get('join');
    if (join && /^[A-Z2-9]{4}$/i.test(join)) {
      history.replaceState(null, '', location.pathname);
      UI.openInvite(join.toUpperCase());
    }
  } catch (e) { /* ignore bad links */ }
}

const hotApi = window.claude && window.claude.hot;
if (hotApi && typeof hotApi.snapshot === 'function') hotApi.snapshot(() => ({ run: game && !game.finished ? game.snapshot() : save.run }));
if (hotApi && typeof hotApi.ready === 'function') hotApi.ready(boot);
else boot((hotApi && hotApi.data) || {});
