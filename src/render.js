'use strict';
/* Neon Swarm — canvas rendering. Glow comes from sprites pre-drawn once, never per-frame shadowBlur. */

const View = {
  cssW: 390, cssH: 844, dpr: 2, zoom: 1, k: 2, w: 380, h: 820,
  safe: { t: 0, r: 0, b: 0, l: 0 },
  cap: 2,
};
const FONT = '"Chakra Petch", system-ui, -apple-system, sans-serif';
let canvas = null, ctx = null, vignette = null, hurtVignette = null, safeProbe = null;

function setupCanvas(c) {
  canvas = c;
  ctx = c.getContext('2d', { alpha: false });
  safeProbe = document.createElement('div');
  safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(safeProbe);
  resize();
}

function resize() {
  View.cssW = Math.max(1, window.innerWidth);
  View.cssH = Math.max(1, window.innerHeight);
  View.dpr = Math.min(window.devicePixelRatio || 1, View.cap);
  canvas.width = Math.round(View.cssW * View.dpr);
  canvas.height = Math.round(View.cssH * View.dpr);
  View.zoom = clamp(Math.min(View.cssW, View.cssH * 0.6) / 380, 0.85, 2.2);
  View.k = View.dpr * View.zoom;
  View.w = View.cssW / View.zoom;
  View.h = View.cssH / View.zoom;
  const cs = getComputedStyle(safeProbe);
  View.safe.t = parseFloat(cs.paddingTop) || 0;
  View.safe.r = parseFloat(cs.paddingRight) || 0;
  View.safe.b = parseFloat(cs.paddingBottom) || 0;
  View.safe.l = parseFloat(cs.paddingLeft) || 0;
  vignette = makeVignette('5,3,18', 0.78);
  hurtVignette = makeVignette('255,30,70', 0.55);
  Input.setBottomGuard(View.safe.b + 8);
}

function makeVignette(rgb, a) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(View.cssW / 2));
  c.height = Math.max(1, Math.round(View.cssH / 2));
  const g = c.getContext('2d');
  const r = Math.hypot(c.width, c.height) / 2;
  const grd = g.createRadialGradient(c.width / 2, c.height / 2, r * 0.45, c.width / 2, c.height / 2, r);
  grd.addColorStop(0, `rgba(${rgb},0)`);
  grd.addColorStop(1, `rgba(${rgb},${a})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---------- sprites ----------
const SPR = new Map();
const SPR_SCALE = 2;

function poly(g, n, r, rot) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n;
    if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}
function starPath(g, n, r1, r2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n, r = i % 2 ? r2 : r1;
    if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.moveTo(r, 0);
  }
  g.closePath();
}

const SHAPES = {
  diamond: (g, r) => { g.beginPath(); g.moveTo(r, 0); g.lineTo(0, r * 0.72); g.lineTo(-r, 0); g.lineTo(0, -r * 0.72); g.closePath(); },
  tri: (g, r) => poly(g, 3, r, 0),
  arrow: (g, r) => { g.beginPath(); g.moveTo(r * 1.15, 0); g.lineTo(-r * 0.8, r * 0.8); g.lineTo(-r * 0.3, 0); g.lineTo(-r * 0.8, -r * 0.8); g.closePath(); },
  hex: (g, r) => poly(g, 6, r, 0),
  square: (g, r) => poly(g, 4, r, Math.PI / 4),
  pent: (g, r) => poly(g, 5, r, -Math.PI / 2),
  warden: (g, r) => starPath(g, 8, r, r * 0.72),
  queen: (g, r) => starPath(g, 12, r, r * 0.74),
  ship: (g, r) => { g.beginPath(); g.moveTo(r * 1.25, 0); g.lineTo(-r * 0.85, r * 0.85); g.lineTo(-r * 0.32, 0); g.lineTo(-r * 0.85, -r * 0.85); g.closePath(); },
  gem: (g, r) => { g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.68, 0); g.lineTo(0, r); g.lineTo(-r * 0.68, 0); g.closePath(); },
  circle: (g, r) => { g.beginPath(); g.arc(0, 0, r, 0, TAU); },
};
const SPINNERS = new Set(['hex', 'square', 'pent', 'warden', 'queen']);

function makeCanvas(half) {
  const dim = Math.ceil(half * 2 * SPR_SCALE);
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.translate(dim / 2, dim / 2);
  g.scale(SPR_SCALE, SPR_SCALE);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  return { c, g };
}

function spriteShape(shape, r, color, variant = '') {
  const key = shape + '|' + r + '|' + color + '|' + variant;
  let s = SPR.get(key);
  if (s) return s;
  const glow = Math.max(5, r * 0.7);
  const half = r * 1.32 + glow + 2;
  const { c, g } = makeCanvas(half);
  const white = variant === 'white';
  const col = white ? '#ffffff' : color;
  const lw = Math.max(1.8, r * 0.16);
  g.shadowColor = col;
  g.shadowBlur = glow * SPR_SCALE;
  g.strokeStyle = col;
  g.lineWidth = lw;
  SHAPES[shape](g, r);
  g.stroke();
  if (variant === 'elite') {
    g.shadowColor = '#ffd447';
    g.strokeStyle = '#ffd447';
    g.lineWidth = lw * 0.8;
    SHAPES[shape](g, r * 1.28);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = white ? 'rgba(255,255,255,0.88)' : rgba(color, 0.22);
  SHAPES[shape](g, r);
  g.fill();
  g.strokeStyle = white ? '#ffffff' : mixHex(color, '#ffffff', 0.55);
  g.lineWidth = Math.max(1, lw * 0.45);
  SHAPES[shape](g, r);
  g.stroke();
  if (variant === 'player') {
    g.fillStyle = '#ffffff';
    SHAPES[shape](g, r * 0.42);
    g.fill();
  }
  s = { c, half };
  SPR.set(key, s);
  return s;
}

function spriteDot(color) {
  const key = 'dot|' + color;
  let s = SPR.get(key);
  if (s) return s;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.22, color);
  grd.addColorStop(0.55, rgba(color, 0.35));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  s = { c, half: 16 };
  SPR.set(key, s);
  return s;
}

function spriteCustom(key, half, draw) {
  let s = SPR.get(key);
  if (s) return s;
  const { c, g } = makeCanvas(half);
  draw(g);
  s = { c, half };
  SPR.set(key, s);
  return s;
}

const SPRITES = {
  bolt: (color, big) => spriteCustom('bolt|' + color + big, big ? 18 : 14, (g) => {
    const L = big ? 11 : 8.5, R = big ? 4 : 3;
    g.shadowColor = color; g.shadowBlur = 10 * SPR_SCALE;
    g.strokeStyle = color; g.lineWidth = R * 2;
    g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = '#ffffff'; g.lineWidth = R * 0.9;
    g.beginPath(); g.moveTo(-L + 2, 0); g.lineTo(L, 0); g.stroke();
  }),
  missile: () => spriteCustom('missile', 14, (g) => {
    g.shadowColor = '#ffa94d'; g.shadowBlur = 8 * SPR_SCALE;
    g.fillStyle = '#ffa94d';
    g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 4.5); g.lineTo(-3, 0); g.lineTo(-5, -4.5); g.closePath(); g.fill();
    g.shadowBlur = 0; g.fillStyle = '#fff3e0';
    g.beginPath(); g.moveTo(6, 0); g.lineTo(-2, 2); g.lineTo(-2, -2); g.closePath(); g.fill();
  }),
  ebullet: () => spriteCustom('ebullet', 14, (g) => {
    g.fillStyle = 'rgba(20,0,20,0.9)';
    g.beginPath(); g.arc(0, 0, 7.5, 0, TAU); g.fill();
    g.shadowColor = '#ff2bd6'; g.shadowBlur = 10 * SPR_SCALE;
    g.fillStyle = '#ff2bd6';
    g.beginPath(); g.arc(0, 0, 5.6, 0, TAU); g.fill();
    g.shadowBlur = 0; g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill();
  }),
  coin: () => spriteCustom('coin', 12, (g) => {
    g.shadowColor = '#ffd447'; g.shadowBlur = 8 * SPR_SCALE;
    g.fillStyle = '#ffd447'; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
    g.shadowBlur = 0; g.strokeStyle = '#fff6c7'; g.lineWidth = 1.3;
    g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.stroke();
  }),
  heart: () => spriteCustom('heart', 16, (g) => {
    g.shadowColor = '#6dff9a'; g.shadowBlur = 10 * SPR_SCALE;
    g.strokeStyle = '#6dff9a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.moveTo(0, -6); g.lineTo(0, 6); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.stroke();
  }),
  vortex: () => spriteCustom('vortex', 18, (g) => {
    g.shadowColor = '#39f3ff'; g.shadowBlur = 10 * SPR_SCALE;
    g.strokeStyle = '#39f3ff'; g.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.arc(0, 0, 3 + i * 2.8, i * 2, i * 2 + 4.2); g.stroke();
    }
    g.shadowBlur = 0; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 2, 0, TAU); g.fill();
  }),
  bomb: () => spriteCustom('bomb', 16, (g) => {
    g.shadowColor = '#ff4b5c'; g.shadowBlur = 10 * SPR_SCALE;
    g.strokeStyle = '#ff4b5c'; g.lineWidth = 2.4;
    g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.stroke();
    g.shadowBlur = 0; g.fillStyle = '#ffd0d5';
    g.beginPath(); g.arc(0, 0, 3.4, 0, TAU); g.fill();
  }),
  chest: () => spriteCustom('chest', 22, (g) => {
    g.shadowColor = '#ffd447'; g.shadowBlur = 14 * SPR_SCALE;
    g.strokeStyle = '#ffd447'; g.lineWidth = 2.4; g.fillStyle = 'rgba(255,212,71,0.25)';
    g.beginPath(); g.roundRect ? g.roundRect(-11, -8, 22, 16, 3) : g.rect(-11, -8, 22, 16); g.fill(); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = '#fff6c7'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-11, -1); g.lineTo(11, -1); g.moveTo(0, -3); g.lineTo(0, 3); g.stroke();
  }),
};

const GEM_TIERS = [
  { min: 0, r: 4.2, color: '#6dff9a' },
  { min: 5, r: 5.6, color: '#4da3ff' },
  { min: 25, r: 7, color: '#b980ff' },
];
function gemTier(v) {
  return v >= 25 ? GEM_TIERS[2] : v >= 5 ? GEM_TIERS[1] : GEM_TIERS[0];
}

// ---------- drawing helpers ----------
let OX = 0, OY = 0; // world->device offset for the current frame

function worldTransform() {
  ctx.setTransform(View.k, 0, 0, View.k, OX, OY);
}

function drawSprite(s, x, y, scale = 1) {
  const h = s.half * scale;
  ctx.drawImage(s.c, x - h, y - h, h * 2, h * 2);
}

function drawSpriteRot(s, x, y, ang, scale = 1) {
  const k = View.k * scale, c = Math.cos(ang) * k, sn = Math.sin(ang) * k;
  ctx.setTransform(c, sn, -sn, c, OX + x * View.k, OY + y * View.k);
  ctx.drawImage(s.c, -s.half, -s.half, s.half * 2, s.half * 2);
}

function gridColor(p) {
  const a = [120, 92, 255], b = [255, 50, 110];
  return a.map((v, i) => Math.round(lerp(v, b[i], clamp(p, 0, 1))));
}

function drawBackground(camX, camY, progress) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0820';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  OX = canvas.width / 2 - camX * View.k;
  OY = canvas.height / 2 - camY * View.k;
  worldTransform();
  const sp = 48;
  const x0 = Math.floor((camX - View.w / 2) / sp) * sp, x1 = camX + View.w / 2 + sp;
  const y0 = Math.floor((camY - View.h / 2) / sp) * sp, y1 = camY + View.h / 2 + sp;
  const [r, g, b] = gridColor(progress);
  ctx.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? `rgba(${r},${g},${b},0.26)` : `rgba(${r},${g},${b},0.1)`;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += sp) {
      if ((Math.round(x / sp) % 4 === 0) !== !!pass) continue;
      ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += sp) {
      if ((Math.round(y / sp) % 4 === 0) !== !!pass) continue;
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }
}

function drawVignette(img, alpha = 1) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

// ---------- main game frame ----------
function drawGame(g) {
  const p = g.player;
  let camX = g.cam.x, camY = g.cam.y;
  if (g.shake > 0.2 && save.settings.shake) {
    camX += (Math.random() - 0.5) * g.shake;
    camY += (Math.random() - 0.5) * g.shake;
  }
  drawBackground(camX, camY, g.t / RUN_LENGTH);
  const vx0 = camX - View.w / 2 - 30, vx1 = camX + View.w / 2 + 30;
  const vy0 = camY - View.h / 2 - 30, vy1 = camY + View.h / 2 + 30;
  const vis = (x, y, r) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
  const T = g.clock;

  // under-layer glow: floor light, shockwaves
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.12;
  drawSprite(spriteDot(g.char.color), p.x, p.y, 5);
  ctx.globalAlpha = 1;
  for (const f of g.fx) {
    if (f.kind !== 'nova') continue;
    const a = clamp(1 - f.r / f.maxR, 0, 1);
    ctx.strokeStyle = rgba(f.color, 0.25 + a * 0.6);
    ctx.lineWidth = 3 + a * 6;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = rgba(f.color, a * 0.07);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // pickups
  for (const k of g.pickups) {
    if (!vis(k.x, k.y, 20)) continue;
    const bob = Math.sin(T * 4 + k.seed) * 1.5;
    if (k.kind === 'gem') {
      const tier = gemTier(k.v);
      drawSprite(spriteShape('gem', tier.r, tier.color), k.x, k.y + bob);
    } else if (k.kind === 'chest') {
      drawSprite(SPRITES.chest(), k.x, k.y + bob, 1 + Math.sin(T * 6) * 0.06);
    } else {
      drawSprite(SPRITES[k.kind](), k.x, k.y + bob);
    }
  }

  // telegraphs
  for (const e of g.enemies) {
    if (e.dead) continue;
    if ((e.d.ai === 'dash' || e.d.ai === 'warden' || e.d.ai === 'queen') && e.tele > 0) {
      const len = e.boss ? 360 : 230;
      const flick = 0.35 + 0.35 * Math.sin(T * 40);
      ctx.strokeStyle = rgba('#ff4040', flick);
      ctx.lineWidth = e.boss ? e.r * 1.6 : 6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.dx * len, e.y + e.dy * len); ctx.stroke();
    }
  }

  // boss wind-ups
  ctx.globalCompositeOperation = 'lighter';
  for (const e of g.enemies) {
    if (e.dead || !e.charge) continue;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(T * 30);
    drawSprite(spriteDot('#ff2bd6'), e.x, e.y, (e.r * 2.2) / 16);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // enemies
  for (const e of g.enemies) {
    if (e.dead || !vis(e.x, e.y, e.r * 2)) continue;
    const variant = e.flash > 0 ? 'white' : e.elite ? 'elite' : '';
    drawSpriteRot(spriteShape(e.d.shape, Math.round(e.r), e.d.color, variant), e.x, e.y, e.ang);
  }
  worldTransform();
  for (const e of g.enemies) {
    if (e.dead || !vis(e.x, e.y, e.r * 2)) continue;
    if (e.d.ai === 'shoot' && e.st < 0.45) {
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(spriteDot('#ff2bd6'), e.x, e.y, 0.5 + (0.45 - e.st) * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (e.elite && e.hp < e.maxHp) {
      const w = e.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w / 2, e.y + e.r * 1.5, w, 3);
      ctx.fillStyle = '#ffd447';
      ctx.fillRect(e.x - w / 2, e.y + e.r * 1.5, (w * e.hp) / e.maxHp, 3);
    }
  }

  // player shots
  ctx.globalCompositeOperation = 'lighter';
  for (const b of g.bullets) {
    if (!vis(b.x, b.y, 20)) continue;
    if (b.kind === 'missile') drawSpriteRot(SPRITES.missile(), b.x, b.y, b.ang);
    else drawSpriteRot(SPRITES.bolt(b.color, b.big), b.x, b.y, b.ang, b.size);
  }
  // blades
  for (const w of g.weapons) {
    if (w.id !== 'blades' || !w.pos) continue;
    const col = w.evo ? '#e8ffb0' : '#b6ff3d';
    const br = Math.round(w.br);
    for (let i = 0; i < w.pos.length; i += 2) {
      drawSpriteRot(spriteShape('diamond', br, col), w.pos[i], w.pos[i + 1], w.angle + (i / 2) * (TAU / (w.pos.length / 2)) + Math.PI / 2);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // player
  if (g.state !== 'dead' && !(p.inv > 0 && Math.floor(T * 16) % 2 === 0 && g.state === 'play')) {
    drawSpriteRot(spriteShape('ship', 11, g.char.color, 'player'), p.x, p.y, Math.atan2(p.fy, p.fx));
  }
  worldTransform();
  if (g.state === 'play') {
    const w = 30, frac = clamp(p.hp / g.stats.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(p.x - w / 2 - 1, p.y + 19, w + 2, 5);
    ctx.fillStyle = frac > 0.5 ? '#6dff9a' : frac > 0.25 ? '#ffd447' : '#ff4b5c';
    ctx.fillRect(p.x - w / 2, p.y + 20, w * frac, 3);
  }

  // effects
  ctx.globalCompositeOperation = 'lighter';
  for (const f of g.fx) {
    const a = clamp(f.life / f.max, 0, 1);
    if (f.kind === 'bolt') {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(f.color, 0.45 * a);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(f.pts[0], f.pts[1]);
      for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i], f.pts[i + 1]);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (f.kind === 'beam') {
      const k = View.k, c = Math.cos(f.ang) * k, s = Math.sin(f.ang) * k;
      ctx.setTransform(c, s, -s, c, OX + f.x * k, OY + f.y * k);
      const w = f.w * (0.4 + 0.6 * a);
      ctx.fillStyle = rgba(f.color, 0.25 * a);
      ctx.fillRect(0, -w * 1.2, f.len, w * 2.4);
      ctx.fillStyle = rgba(f.color, 0.7 * a);
      ctx.fillRect(0, -w / 2, f.len, w);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(0, -w * 0.18, f.len, w * 0.36);
      worldTransform();
    } else if (f.kind === 'blast') {
      ctx.globalAlpha = a;
      drawSprite(spriteDot(f.color), f.x, f.y, (f.r / 16) * (1.4 - a * 0.4));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(f.color, a);
      ctx.lineWidth = 2 + 3 * a;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.1 - a * 0.5), 0, TAU); ctx.stroke();
    } else if (f.kind === 'ring') {
      ctx.strokeStyle = rgba(f.color, a);
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.2 - a), 0, TAU); ctx.stroke();
    }
  }
  // particles
  for (const q of g.particles) {
    if (!vis(q.x, q.y, 10)) continue;
    const a = q.life / q.max;
    drawSprite(spriteDot(q.color), q.x, q.y, (q.size / 16) * (0.3 + 0.7 * a));
  }
  ctx.globalCompositeOperation = 'source-over';

  // enemy bullets sit on top of everything so they always read
  for (const b of g.ebullets) {
    if (vis(b.x, b.y, 10)) drawSprite(SPRITES.ebullet(), b.x, b.y);
  }

  // damage numbers
  if (g.texts.length) {
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,6,30,0.85)';
    for (const t of g.texts) {
      const a = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = Math.min(1, a * 2);
      const y = t.y - (1 - a) * 18;
      ctx.strokeText(t.s, t.x, y);
      ctx.fillStyle = t.crit ? '#ffd447' : '#ffffff';
      ctx.fillText(t.s, t.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // screen space
  drawVignette(vignette);
  const hpFrac = p.hp / g.stats.maxHp;
  if (g.state === 'play' && hpFrac < 0.3) drawVignette(hurtVignette, 0.45 + 0.35 * Math.sin(T * 6));
  if (p.hurtFlash > 0) drawVignette(hurtVignette, p.hurtFlash * 3);
  if (g.flash > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,255,255,${clamp(g.flash, 0, 1) * 0.7})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawIndicators(g, camX, camY);
  drawHUD(g);
  if (g.state === 'play') drawStick();
}

function drawIndicators(g, camX, camY) {
  const targets = [];
  if (g.boss && !g.boss.dead) targets.push([g.boss.x, g.boss.y, g.boss.d.color]);
  for (const k of g.pickups) if (k.kind === 'chest') targets.push([k.x, k.y, '#ffd447']);
  if (!targets.length) return;
  ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
  const W = View.cssW, H = View.cssH, s = View.safe;
  const m = 22, top = s.t + 84, bottom = H - s.b - m, left = s.l + m, right = W - s.r - m;
  for (const [x, y, color] of targets) {
    const sx = (x - camX) * View.zoom + W / 2, sy = (y - camY) * View.zoom + H / 2;
    if (sx > left && sx < right && sy > top && sy < bottom) continue;
    const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
    const tx = dx ? (dx > 0 ? right - cx : left - cx) / dx : Infinity;
    const ty = dy ? (dy > 0 ? bottom - cy : top - cy) / dy : Infinity;
    const t = Math.min(tx, ty);
    const ix = cx + dx * t, iy = cy + dy * t, ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(g.clock * 8);
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, 8); ctx.lineTo(-3, 0); ctx.lineTo(-7, -8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawHUD(g) {
  ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
  const W = View.cssW, s = View.safe;
  const top = s.t + 8, bx = 12 + s.l, bw = W - 24 - s.l - s.r;
  // XP bar
  roundRectPath(bx, top, bw, 9, 4.5);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fill();
  const frac = clamp(g.xp / g.xpNext, 0, 1);
  if (frac > 0) {
    const grd = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grd.addColorStop(0, '#6dff9a');
    grd.addColorStop(1, '#4da3ff');
    roundRectPath(bx, top, Math.max(9, bw * frac), 9, 4.5);
    ctx.fillStyle = grd;
    ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';
  // level + counters (left)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#efedff';
  ctx.font = '700 17px ' + FONT;
  ctx.fillText('LV ' + g.level, bx, top + 32);
  ctx.font = '600 13px ' + FONT;
  ctx.fillStyle = '#ff7aa8';
  ctx.fillText('◆ ' + fmtInt(g.kills), bx, top + 51);
  ctx.fillStyle = '#ffd447';
  ctx.fillText('● ' + fmtInt(g.goldRun), bx + 74, top + 51);
  // timer (centre)
  ctx.textAlign = 'center';
  ctx.font = '700 27px ' + FONT;
  ctx.fillStyle = g.finalSpawned ? '#ffd447' : '#ffffff';
  ctx.fillText(g.finalSpawned ? 'BOSS' : fmtTime(g.t), W / 2, top + 38);
  // boss bar
  if (g.boss && !g.boss.dead) {
    const b = g.boss, w = Math.min(320, W * 0.72), x = W / 2 - w / 2, y = top + 66;
    ctx.font = '700 12px ' + FONT;
    ctx.fillStyle = b.d.color;
    ctx.fillText(b.d.name, W / 2, y - 6);
    roundRectPath(x, y, w, 8, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    roundRectPath(x, y, Math.max(8, (w * clamp(b.hp, 0, b.maxHp)) / b.maxHp), 8, 4);
    ctx.fillStyle = b.d.color;
    ctx.fill();
  }
  // banner
  if (g.banner) {
    const bn = g.banner, a = clamp(Math.min(bn.t / 0.25, (bn.dur - bn.t) / 0.4), 0, 1);
    const y = View.cssH * 0.3;
    ctx.globalAlpha = a;
    ctx.font = '700 ' + (bn.small ? 20 : 28) + 'px ' + FONT;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10,6,30,0.8)';
    ctx.strokeText(bn.text, W / 2, y);
    ctx.fillStyle = bn.color || '#ffffff';
    ctx.fillText(bn.text, W / 2, y);
    if (bn.sub) {
      ctx.font = '600 15px ' + FONT;
      ctx.lineWidth = 4;
      ctx.strokeText(bn.sub, W / 2, y + 26);
      ctx.fillStyle = '#efedff';
      ctx.fillText(bn.sub, W / 2, y + 26);
    }
    ctx.globalAlpha = 1;
  }
  // first-run hint
  if (g.hint > 0) {
    const a = clamp(g.hint, 0, 1), y = View.cssH * 0.72, pulse = (g.clock * 1.4) % 1;
    ctx.globalAlpha = a;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, y - 60, 18 + pulse * 26, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(W / 2 + Math.sin(g.clock * 2.4) * 22, y - 60, 9, 0, TAU); ctx.fill();
    ctx.font = '700 15px ' + FONT;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('TOUCH & DRAG ANYWHERE TO MOVE', W / 2, y);
    ctx.font = '500 13px ' + FONT;
    ctx.fillStyle = '#a39fd0';
    ctx.fillText('Weapons fire on their own', W / 2, y + 20);
    ctx.globalAlpha = 1;
  }
}

function drawStick() {
  const st = Input.stick;
  if (!st.active) return;
  ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
  const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), m = Math.min(d, 40);
  const kx = st.ox + (d ? (dx / d) * m : 0), ky = st.oy + (d ? (dy / d) * m : 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.arc(st.ox, st.oy, 46, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(kx, ky, 20, 0, TAU); ctx.fill(); ctx.stroke();
}

// ---------- menu backdrop ----------
const Attract = { t: 0, items: [] };
function drawAttract(dt) {
  Attract.t += dt;
  const camX = Attract.t * 16, camY = -Attract.t * 26;
  drawBackground(camX, camY, 0.12);
  if (Attract.items.length < 16) {
    const kinds = ['drone', 'swarmer', 'dasher', 'brute', 'splitter', 'spitter'];
    while (Attract.items.length < 16) {
      Attract.items.push({
        kind: pick(kinds),
        x: camX + rand(-View.w / 2, View.w / 2),
        y: camY + rand(-View.h / 2, View.h / 2),
        vx: rand(-12, 12), vy: rand(-12, 12), a: rand(0, TAU), va: rand(-1, 1),
      });
    }
  }
  ctx.globalAlpha = 0.45;
  for (const it of Attract.items) {
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.a += it.va * dt;
    if (Math.abs(it.x - camX) > View.w / 2 + 60 || Math.abs(it.y - camY) > View.h / 2 + 60) {
      it.x = camX + rand(-View.w / 2, View.w / 2);
      it.y = camY - View.h / 2 - 40;
    }
    const d = ENEMIES[it.kind];
    drawSpriteRot(spriteShape(d.shape, d.r, d.color), it.x, it.y, it.a);
  }
  ctx.globalAlpha = 1;
  drawVignette(vignette);
}
