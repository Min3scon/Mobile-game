'use strict';
/* Neon Swarm — boot, main loop and app lifecycle */

let game = null;
let lastFrame = 0;
let swReg = null;
const perf = { acc: 0, frames: 0, slow: 0 };

function parseDebug() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.has('bot')) DEBUG.bot = true;
  if (q.has('speed')) DEBUG.speed = Math.max(1, +q.get('speed') || 1);
  if (q.has('god')) DEBUG.god = true;
  if (q.has('t')) DEBUG.startAt = Math.max(0, (+q.get('t') || 0) * 60);
}

function startRun(opts) {
  Sound.unlock();
  const resume = opts.resume || null;
  const charId = resume ? resume.charId : save.selChar;
  if (opts.daily && !resume) touchDaily();
  game = new Game({
    charId, daily: !!opts.daily, resume,
    hooks: { levelUp: UI.showLevelUp, chest: UI.showChest, over: onRunOver },
  });
  save.run = null;
  writeSave();
  perf.acc = perf.frames = perf.slow = 0;
  Input.setEnabled(true);
  if (!resume) Sound.setIntensity(0);
  if (save.settings.music) Sound.startMusic();
  UI.enterGame();
}

function onRunOver(result) {
  Input.setEnabled(false);
  UI.showOver(result);
}

function exitToMenu(keepScreen) {
  if (game && !game.finished) {
    const snap = game.snapshot();
    if (snap) { save.run = snap; writeSave(); }
  }
  game = null;
  Input.setEnabled(false);
  Sound.setIntensity(0);
  if (!keepScreen) UI.showMenu();
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  if (game) {
    game.frame(dt);
    // A paused scene does not change, so draw it once and let the GPU rest.
    if (game.running() || !game._still || game.banner) {
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
      writeSave();
      resize();
      perf.slow = 0;
    }
  } else perf.slow = 0;
}

function onHide() {
  if (game && !game.finished) {
    if (game.pause()) UI.showPause(game);
    const snap = game.snapshot();
    if (snap) { save.run = snap; writeSave(); }
  }
  Input.reset();
  Sound.suspend();
}

function registerSW() {
  if (window.NS_EMBEDDED || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { swReg = r; }).catch(() => {});
}

function boot(hot) {
  parseDebug();
  loadSave();
  if (hot && hot.run && !save.run) save.run = hot.run;
  View.cap = clamp(+save.quality || 2, 1, 2);
  Haptics.mount();
  setupCanvas(document.getElementById('game'));
  Input.attach(canvas);
  UI.init({ startRun, exitToMenu, getGame: () => game });
  UI.applySettings();
  UI.showMenu();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHide();
    else {
      lastFrame = performance.now();
      if (swReg) swReg.update().catch(() => {});
    }
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('resize', () => requestAnimationFrame(resize));
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  // iOS only lets a finger lift (not a press) start audio, and needs it again after interruptions.
  for (const t of ['pointerup', 'touchend', 'keydown']) window.addEventListener(t, () => Sound.unlock(), { capture: true, passive: true });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  registerSW();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  window.__ns = { get game() { return game; }, get save() { return save; }, startRun, DEBUG };
  if (DEBUG.bot) startRun({ daily: false });
}

const hotApi = window.claude && window.claude.hot;
if (hotApi && typeof hotApi.snapshot === 'function') hotApi.snapshot(() => ({ run: game && !game.finished ? game.snapshot() : save.run }));
if (hotApi && typeof hotApi.ready === 'function') hotApi.ready(boot);
else boot((hotApi && hotApi.data) || {});
