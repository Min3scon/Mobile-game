'use strict';
/* Neon Swarm — shared helpers */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

// Swap-remove; safe while iterating an array backwards.
function removeAt(arr, i) {
  const last = arr.pop();
  if (i < arr.length) arr[i] = last;
}

// entries: [[item, weight], ...]
function weightedPick(entries, rng = Math.random) {
  let total = 0;
  for (const e of entries) total += e[1];
  let r = rng() * total;
  for (const e of entries) {
    r -= e[1];
    if (r <= 0) return e[0];
  }
  return entries[entries.length - 1][0];
}

// Small fast seeded RNG; returns floats in [0, 1).
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function distToSegment2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function fmtInt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// The daily run is global, so it rolls over at midnight UTC for everyone.
function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// 53-bit string hash (cyrb53), used to sign saves so hand edits are detected.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function dayDiff(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Uniform grid for broad-phase collision. Entities are bucketed by centre;
// callers pad the query radius by the largest regular enemy radius.
class SpatialHash {
  constructor(cell) {
    this.cell = cell;
    this.inv = 1 / cell;
    this.map = new Map();
    this.used = [];
  }
  clear() {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
    if (this.map.size > 6000) this.map.clear();
  }
  insert(e) {
    const k = (Math.floor(e.x * this.inv) + 32768) * 65536 + (Math.floor(e.y * this.inv) + 32768);
    let a = this.map.get(k);
    if (!a) {
      a = [];
      this.map.set(k, a);
    }
    if (a.length === 0) this.used.push(a);
    a.push(e);
  }
  query(x, y, r, out) {
    out.length = 0;
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.map.get((cx + 32768) * 65536 + (cy + 32768));
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}
