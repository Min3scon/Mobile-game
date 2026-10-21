'use strict';
/* Neon Swarm — floating thumbstick + keyboard */

const Input = (() => {
  const DEAD = 6, FULL = 40, LEASH = 60, EDGE = 24;
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const keys = new Set();
  const out = { x: 0, y: 0 };
  let el = null, enabled = false, bottomGuard = 16;

  function down(e) {
    if (!enabled || stick.active) return;
    // Leave the home-indicator strip alone so swiping home never moves the ship.
    if (e.clientY > window.innerHeight - bottomGuard) return;
    stick.active = true;
    stick.id = e.pointerId;
    stick.ox = clamp(e.clientX, EDGE, window.innerWidth - EDGE);
    stick.oy = e.clientY;
    stick.x = e.clientX;
    stick.y = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function move(e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    stick.x = e.clientX;
    stick.y = e.clientY;
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > LEASH) {
      stick.ox = stick.x - (dx / d) * LEASH;
      stick.oy = stick.y - (dy / d) * LEASH;
    }
  }
  function up(e) {
    if (e.pointerId === stick.id) reset();
  }
  function reset() {
    stick.active = false;
    stick.id = null;
  }

  function attach(canvas) {
    el = canvas;
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    const stop = (e) => e.preventDefault();
    // Blocks the magnifier, callout and double-tap zoom on the play field.
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => { keys.clear(); reset(); });
  }

  function vector() {
    let x = 0, y = 0;
    if (stick.active) {
      const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > DEAD) {
        const m = Math.min(1, (d - DEAD) / (FULL - DEAD));
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    let kx = 0, ky = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ky -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ky += 1;
    if (kx || ky) {
      const d = Math.hypot(kx, ky);
      x = kx / d;
      y = ky / d;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  return {
    attach,
    vector,
    reset,
    stick,
    setEnabled(on) { enabled = on; if (!on) reset(); },
    setBottomGuard(px) { bottomGuard = Math.max(16, px); },
  };
})();
