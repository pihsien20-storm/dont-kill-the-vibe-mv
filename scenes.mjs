import fs from 'fs';
import { Path2D } from '@napi-rs/canvas';
import { clamp, lerp, smooth, easeOut, easeIn, easeIO, backOut, hash, hash2, noise1, textMesh } from './engine.mjs';

const D = new URL('./data/', import.meta.url).pathname;
const E = JSON.parse(fs.readFileSync(D + 'energy.json'));
const BEATS = JSON.parse(fs.readFileSync(D + 'beats.json')).beats;
const LY = JSON.parse(fs.readFileSync(D + 'lyrics.json'));
export const FPS = 30;
export const T = { hit: 10.25, build: 17.0, drop1: 30.45, drop2: 57.2, verse: 82.6, pre: 111.2, chorus: 124.4, post: 138.6, brk: 148.2, drop3: 164.7, bridge: 178.4, final: 191.5, last: 203.0, outro: 205.0, wind: 212.0, stop: 216.3, end: 217.5, total: 222 };
export const NF = Math.round(T.total * FPS);

// ---------- audio helpers ----------
const fi = (t) => clamp(Math.round(t * FPS), 0, E.rms.length - 1);
const A = (k, t) => E[k][fi(t)] || 0;
const spec = (t, b) => (E.spec[fi(t)] || [])[b] || 0;
const lowS = new Float32Array(NF + 60); { let s = 0; for (let f = 0; f < lowS.length; f++) { s = s * 0.9 + (E.low[Math.min(f, E.low.length - 1)] || 0) * 0.1; lowS[f] = s; } }
function beatInfo(t) { let lo = 0, hi = BEATS.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (BEATS[m] <= t) lo = m; else hi = m - 1; } const b0 = BEATS[lo], b1 = BEATS[Math.min(lo + 1, BEATS.length - 1)]; return { i: lo, ph: t < b0 ? 0 : clamp((t - b0) / Math.max(0.2, b1 - b0)), since: t - b0 }; }
const DOWN = BEATS.reduce((best, b, i) => Math.abs(b - T.drop1) < Math.abs(BEATS[best] - T.drop1) ? i : best, 0) % 4;
const barOf = (t) => { const b = beatInfo(t); return { bar: Math.floor((b.i - DOWN) / 4), inBar: ((b.i - DOWN) % 4 + 4) % 4, ph: b.ph, i: b.i }; };
// beat pulse, gated by how much low end is actually playing
function bp(t) { const b = beatInfo(t); if (b.since < 0) return 0; const gate = smooth(0.18, 0.4, lowS[fi(t)]); return Math.exp(-b.since * 7) * gate; }
function bpRaw(t) { const b = beatInfo(t); return b.since < 0 ? 0 : Math.exp(-b.since * 7); }

// ---------- travel distance (integral of a speed profile) ----------
const SP = [[0, 5], [10.2, 5], [10.4, 16], [17, 22], [28.5, 80], [30.4, 150], [30.45, 250], [43.8, 250], [44.2, 170], [53.5, 190], [57.1, 120], [57.2, 300], [82.4, 300], [82.6, 170], [111.0, 170], [111.3, 60], [118, 110], [124.3, 330], [124.4, 280], [138.5, 280], [138.6, 340], [148.1, 340], [148.3, 12], [162, 12], [164.6, 120], [164.7, 380], [178.3, 380], [178.6, 10], [190, 14], [191.4, 60], [191.5, 300], [202.9, 300], [203.1, 14], [204.9, 14], [205, 400], [212, 380], [216.3, 90], [217.4, 0], [222, 0]];
function speedAt(t) { for (let i = 0; i < SP.length - 1; i++) if (t <= SP[i + 1][0]) return lerp(SP[i][1], SP[i + 1][1], clamp((t - SP[i][0]) / Math.max(1e-6, SP[i + 1][0] - SP[i][0]))); return 0; }
const DIST = new Float64Array(NF + 2); for (let f = 1; f < DIST.length; f++) { const t = f / FPS; DIST[f] = DIST[f - 1] + speedAt(t) * (0.8 + 0.5 * bp(t)) / FPS; }
const dist = (t) => { const x = clamp(t * FPS, 0, NF); const i = Math.floor(x); return lerp(DIST[i], DIST[i + 1], x - i); };

// ---------- palettes ----------
const C = { mag: '#ff2bd6', cy: '#22e6ff', vio: '#8a5bff', amb: '#ffb23a', lime: '#c8ff3a', wh: '#ffffff', red: '#ff3355', pink: '#ff7ab8', ice: '#bff4ff', blue: '#3a6bff' };

// ---------- world pieces ----------
function horizonY(R) { return R.H / 2 + R.f * Math.tan(R.cam.pitch) + R.cam.sy; }
function bgGrad(R, top, mid, bot, glowA = 1) {
  return (g, W, H) => { const hy = clamp(horizonY(R), -H, 2 * H); const gr = g.createLinearGradient(0, hy - H * 0.9, 0, hy + H * 0.7); gr.addColorStop(0, top); gr.addColorStop(0.56, mid); gr.addColorStop(0.563, mid); gr.addColorStop(0.60, bot); gr.addColorStop(1, '#000'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalAlpha = glowA; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1; };
}
function grid(R, camZ, color, y = 0, o = {}) {
  const step = o.step || 22, half = o.half || 420, far = Math.min(R.far, o.far || 700), a = o.alpha ?? 0.8, w = o.w || 1.3;
  const z0 = Math.floor(camZ / step) * step;
  for (let z = z0; z < camZ + far; z += step) R.line([-half, y, z], [half, y, z], color, w, a * (o.ripple ? o.ripple(z) : 1));
  const cuts = [0, 14, 34, 64, 110, 180, 290, 450, far];
  for (let x = -half; x <= half; x += step) for (let k = 0; k < cuts.length - 1; k++) { if (cuts[k] >= far) break; R.line([x, y, camZ + cuts[k]], [x, y, camZ + Math.min(far, cuts[k + 1])], color, w, a); }
}
function globe(R, c, rad, t, color, o = {}) {
  const nLat = o.lat || 9, nLon = o.lon || 14, seg = 28, rot = t * (o.spin ?? 0.15), a = o.alpha ?? 0.9, w = o.w || 1.4, tilt = o.tilt ?? 0.35;
  const P = (la, lo) => { let x = Math.cos(la) * Math.sin(lo + rot) * rad, y = Math.sin(la) * rad, z = Math.cos(la) * Math.cos(lo + rot) * rad; const yy = y * Math.cos(tilt) - x * Math.sin(tilt), xx = y * Math.sin(tilt) + x * Math.cos(tilt); return [c[0] + xx, c[1] + yy, c[2] + z]; };
  const draw = clamp(o.draw ?? 1);
  for (let i = 1; i < nLat; i++) { const la = -Math.PI / 2 + Math.PI * i / nLat; const m = Math.floor(seg * draw); for (let k = 0; k < m; k++) R.line(P(la, k / seg * 6.2832), P(la, (k + 1) / seg * 6.2832), color, w, a, false); }
  for (let j = 0; j < nLon; j++) { const lo = j / nLon * 6.2832; const m = Math.floor(16 * draw); for (let k = 0; k < m; k++) R.line(P(-Math.PI / 2 + Math.PI * k / 16, lo), P(-Math.PI / 2 + Math.PI * (k + 1) / 16, lo), o.color2 || color, w, a * 0.8, false); }
}
function stars(R, camZ, t, color, o = {}) {
  const n = o.n || 260, span = o.span || 800, streak = o.streak || 0, r = o.r || 320, a = o.alpha ?? 0.9;
  for (let i = 0; i < n; i++) {
    const x = (hash(i * 1.7) - 0.5) * 2 * r, y = (o.yMin ?? -r * 0.2) + hash(i * 3.1) * (o.yMax ?? r), z0 = hash(i * 7.3) * span; const z = camZ + ((z0 - camZ) % span + span) % span;
    const col = hash(i * 9.9) < 0.25 ? (o.color2 || color) : color;
    if (streak > 1) R.line([x, y, z], [x, y, z + streak], col, 1.2, a); else R.point([x, y, z], col, o.size || 26, a * (0.6 + 0.4 * Math.sin(t * 3 + i)));
  }
}
function city(R, camZ, t, pal, o = {}) {
  const step = 46, road = o.road ?? 30, i0 = Math.floor(camZ / step), n = Math.ceil(R.far / step), beat = bp(t), hs = o.hScale ?? 1;
  for (let i = i0 + n; i >= i0 - 1; i--) for (const side of [-1, 1]) for (let row = 1; row >= 0; row--) {
    const id = i * 4 + (side > 0 ? 2 : 0) + row; const h1 = hash(id * 1.31), h2 = hash(id * 2.17), h3 = hash(id * 3.71), h4 = hash(id * 5.93);
    if (h1 < 0.1) continue;
    const w = 18 + h2 * 18, d = 20 + h3 * 20; let ht = (row ? 70 + h4 * 230 : 16 + h4 * h4 * 150) * hs; ht *= 1 + 0.1 * spec(t, (id * 7) % 24);
    const x0 = side * (road + row * 48), x1 = x0 + side * w, z0 = i * step + (h1 - 0.5) * 8, z1 = z0 + d;
    const col = h2 < 0.3 ? pal.b : pal.a;
    // occluders
    const f1 = [[x0, 0, z0], [x0, 0, z1], [x0, ht, z1], [x0, ht, z0]], f2 = [[x0, 0, z0], [x1, 0, z0], [x1, ht, z0], [x0, ht, z0]];
    const p1 = f1.map(p => R.project(p)), p2 = f2.map(p => R.project(p));
    if (p1.every(Boolean) || p2.every(Boolean)) { const path = new Path2D(); for (const pp of [p1, p2]) if (pp.every(Boolean)) { path.moveTo(pp[0][0], pp[0][1]); for (let k = 1; k < 4; k++) path.lineTo(pp[k][0], pp[k][1]); path.closePath(); } R.fillScreen(path, pal.wall || '#04010a', 1, 0); }
    R.poly(f1, col, 1.4, 0.95); R.poly(f2, col, 1.4, 0.95); R.line([x1, ht, z0], [x1, ht, z1], col, 1.2, 0.6); R.line([x0, ht, z1], [x1, ht, z1], col, 1.2, 0.6);
    const fl = 12 + h3 * 8; for (let y = fl; y < ht - 4; y += fl) R.line([x0, y, z0], [x0, y, z1], col, 1, 0.3);
    if (row === 0 || h1 > 0.5) { const wc = h1 > 0.6 ? pal.c : col; for (let y = fl * 0.5; y < ht - 3; y += fl) for (let zz = z0 + 3; zz < z1 - 2; zz += 5.5) if (hash2(id + y * 3.1, zz * 1.7) > 0.62) R.point([x0 - side * 0.3, y, zz], wc, 26, 0.85); }
    if (h4 > 0.45) { const nv = 2 + Math.floor(h1 * 3); for (let k = 1; k <= nv; k++) { const x = lerp(x0, x1, k / (nv + 1)); R.line([x, 0, z0], [x, ht, z0], col, 1, 0.28); } }
    if (h3 < 0.38 && row === 0) { const y0 = ht * (0.3 + h1 * 0.3), y1 = y0 + 6 + h2 * 10, za = z0 + d * 0.15, zb = z0 + d * 0.85; const a = 0.55 + 0.45 * beat; R.poly([[x0 - side * 0.6, y0, za], [x0 - side * 0.6, y0, zb], [x0 - side * 0.6, y1, zb], [x0 - side * 0.6, y1, za]], pal.c, 2.4, a); R.line([x0 - side * 0.6, (y0 + y1) / 2, za + 2], [x0 - side * 0.6, (y0 + y1) / 2, lerp(za, zb, 0.3 + 0.6 * spec(t, (id * 3) % 24))], pal.c, 2.4, a); }
    if (h2 > 0.72) { R.line([(x0 + x1) / 2, ht, (z0 + z1) / 2], [(x0 + x1) / 2, ht + 18 + h1 * 30, (z0 + z1) / 2], pal.c, 1.2, 0.8); if (Math.sin(t * 6 + id) > 0.2) R.point([(x0 + x1) / 2, ht + 18 + h1 * 30, (z0 + z1) / 2], C.red, 60, 1); }
  }
  // lane lights on the road
  for (let i = i0; i < i0 + 16; i++) { const z = i * step + 10; R.line([-1.2, 0.2, z], [-1.2, 0.2, z + 16], pal.c, 2.2, 0.9); R.line([1.2, 0.2, z], [1.2, 0.2, z + 16], pal.c, 2.2, 0.9); }
}
const tunC = (z, bend) => [bend * 46 * Math.sin(z * 0.0043), 60 + bend * 26 * Math.sin(z * 0.0033 + 1), z];
function tunnel(R, camZ, t, pal, o = {}) {
  const step = o.step || 15, N = o.sides || 10, rad = o.rad || 26, bend = o.bend ?? 1, i0 = Math.floor(camZ / step), n = Math.ceil(Math.min(R.far, 760) / step), tw = o.twist ?? 1;
  let prev = null;
  for (let i = i0 - 1; i <= i0 + n; i++) {
    const z = i * step, c = tunC(z, bend), r = rad * (1 + (o.pulse ?? 0.3) * spec(t, (i * 5) % 24)), rot = i * 0.06 * tw + t * 0.35 * tw;
    const hot = (i % 4 === 0); const col = hot ? pal.b : pal.a; const v = [];
    for (let k = 0; k < N; k++) { const a = rot + k / N * 6.2832; v.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z]); }
    R.poly(v, col, hot ? 3.4 : 1.8, hot ? 1 : 0.8);
    if (prev) for (let k = 0; k < N; k++) R.line(prev[k], v[k], k % 2 ? pal.a : pal.c, 1.5, 0.65);
    if (hot && o.gates) { const rr = r * 0.55; const q = []; for (let k = 0; k < 4; k++) { const a = -rot * 1.5 + k / 4 * 6.2832; q.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, z]); } R.poly(q, pal.c, 1.6, 0.8); }
    prev = v;
  }
}
function rays(R, t, color, o = {}) {
  const n = o.n || 46, cx = R.W / 2 + R.cam.sx, cy = (o.cy ?? R.H / 2) + R.cam.sy, sp = o.speed || 1.6, m = Math.hypot(R.W, R.H) / 2;
  for (let i = 0; i < n; i++) { const a = hash(i * 2.3) * 6.2832, p = (t * sp * (0.5 + hash(i * 4.1)) + hash(i * 6.7)) % 1; const r0 = m * (0.12 + p * p * 1.0), r1 = r0 + m * (0.05 + 0.3 * p) * (o.len || 1); R.line2(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, hash(i) < 0.3 ? (o.color2 || color) : color, 1.4 + 2 * p, (o.alpha ?? 0.7) * p); }
}
function specRing(R, t, cx, cy, rad, color, o = {}) {
  const n = 72; for (let i = 0; i < n; i++) { const k = i < n / 2 ? i : n - 1 - i; const b = Math.floor(k / (n / 2) * 23); const v = spec(t, b); const a = i / n * 6.2832 - Math.PI / 2 + (o.rot || 0); const r1 = rad + 6 * R.unit, r2 = r1 + (8 + v * (o.len || 120)) * R.unit; R.line2(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, i % 3 ? color : (o.color2 || color), 3, o.alpha ?? 0.9); }
}

// ---------- morphing particle sculpture ----------
const NP = 1500; const shapes = {};
function shape(name) {
  if (shapes[name]) return shapes[name]; const P = [];
  const edgesTo = (V, Ed) => { const per = Math.floor(NP / Ed.length); for (const [a, b] of Ed) for (let k = 0; k < per; k++) { const u = k / per; P.push([lerp(V[a][0], V[b][0], u), lerp(V[a][1], V[b][1], u), lerp(V[a][2], V[b][2], u)]); } while (P.length < NP) P.push(P[P.length - 1].slice()); };
  if (name === 'sphere') for (let i = 0; i < NP; i++) { const y = 1 - 2 * (i + 0.5) / NP, r = Math.sqrt(1 - y * y), a = i * 2.39996; P.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  else if (name === 'cube') { const V = []; for (let i = 0; i < 8; i++) V.push([(i & 1 ? 1 : -1) * 0.75, (i & 2 ? 1 : -1) * 0.75, (i & 4 ? 1 : -1) * 0.75]); const Ed = []; for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) Ed.push([i, i | b]); edgesTo(V, Ed); }
  else if (name === 'octa') { const V = [[1.1, 0, 0], [-1.1, 0, 0], [0, 1.1, 0], [0, -1.1, 0], [0, 0, 1.1], [0, 0, -1.1]]; const Ed = []; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if ((i >> 1) !== (j >> 1)) Ed.push([i, j]); edgesTo(V, Ed); }
  else if (name === 'icosa') { const p = 1.618, V = []; for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { V.push([0, s1, s2 * p]); V.push([s1, s2 * p, 0]); V.push([s1 * p, 0, s2]); } const Ed = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) { const d = Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]); if (Math.abs(d - 2) < 0.01) Ed.push([i, j]); } edgesTo(V.map(v => v.map(x => x * 0.58)), Ed); }
  else if (name === 'knot') for (let i = 0; i < NP; i++) { const a = i / NP * 6.2832; const r = 0.62 + 0.3 * Math.cos(3 * a); P.push([r * Math.cos(2 * a) * 1.15, r * Math.sin(2 * a) * 1.15, 0.36 * Math.sin(3 * a) * 1.6]); }
  else if (name === 'helix') for (let i = 0; i < NP; i++) { const s = i < NP / 2 ? 0 : Math.PI, u = (i % (NP / 2)) / (NP / 2); const a = u * 6.2832 * 3 + s; P.push([Math.cos(a) * 0.5, (u - 0.5) * 2.6, Math.sin(a) * 0.5]); }
  else if (name === 'saturn') for (let i = 0; i < NP; i++) { if (i < NP * 0.55) { const m = NP * 0.55, y = 1 - 2 * (i + 0.5) / m, r = Math.sqrt(1 - y * y), a = i * 2.39996; P.push([Math.cos(a) * r * 0.62, y * 0.62, Math.sin(a) * r * 0.62]); } else { const u = (i - NP * 0.55) / (NP * 0.45), a = u * 6.2832 * 3, r = 1.0 + 0.12 * Math.floor(u * 3); P.push([Math.cos(a) * r, Math.sin(a) * r * 0.12, Math.sin(a) * r]); } }
  else if (name === 'wave') { const n = Math.floor(Math.sqrt(NP)); for (let i = 0; i < NP; i++) { const u = (i % n) / n - 0.5, v = Math.floor(i / n) / n - 0.5; P.push([u * 2.6, Math.sin(u * 9) * Math.cos(v * 9) * 0.22, v * 2.6]); } }
  else { const m = textMesh('anton', name); const pts = m.points(NP); const s = Math.min(2.7 / m.w, 1.35); for (const p of pts) P.push([p[0] * s, p[1] * s, 0]); }
  let tot = 0; for (let i = 0; i < NP - 1; i++) tot += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1], P[i + 1][2] - P[i][2]);
  P.thr = name === 'sphere' || name === 'wave' || name.startsWith('saturn') ? 0 : Math.max(0.012, tot / NP * 3.2); P.isText = !['sphere', 'cube', 'octa', 'icosa', 'knot', 'helix', 'saturn', 'wave'].includes(name);
  return shapes[name] = P;
}
// seq: list of shape names, one per `beatsPer` beats starting from t0
function sculpture(R, t, t0, seq, c, S, pal, o = {}) {
  const bPer = o.beatsPer || 8, b = beatInfo(t), b0 = beatInfo(t0).i; const pos = (b.i - b0 + b.ph) / bPer; const k = clamp(Math.floor(pos), 0, seq.length - 1), u = pos - Math.floor(pos);
  const A0 = shape(seq[Math.max(0, k - 1)]), B0 = shape(seq[k]); const m = k === 0 ? 1 : easeIO(u / 0.3);
  const tw = B0.isText ? m : (A0.isText ? 1 - m : 0); const ang = (t - t0) * (o.spin ?? 0.9) * (1 - tw) + (o.yaw || 0) * tw, tilt = 0.4 * (1 - tw) * Math.sin(t * 0.5);
  const ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(tilt), st = Math.sin(tilt); const beat = bp(t), sc = S * (1 + 0.12 * beat), a = o.alpha ?? 1;
  let last = null, lastRaw = null; const thr = lerp(A0.thr, B0.thr, m) * (m > 0.92 || k === 0 ? 1 : 0);
  const expl = (o.explode || 0);
  for (let i = 0; i < NP; i++) {
    const d = hash(i * 1.13) * 0.35; const mm = k === 0 ? 1 : easeIO(clamp((u / 0.3 - d) / (1 - 0.35)));
    let x = lerp(A0[i][0], B0[i][0], mm), y = lerp(A0[i][1], B0[i][1], mm), z = lerp(A0[i][2], B0[i][2], mm);
    const sw = Math.sin(mm * Math.PI) * 0.5; x += (hash(i * 3.3) - 0.5) * sw; y += (hash(i * 4.7) - 0.5) * sw; z += (hash(i * 5.9) - 0.5) * sw;
    if (expl) { const e = 1 + expl * (1 + 3 * hash(i * 8.1)); x *= e; y *= e; z *= e; z -= expl * hash(i * 2.2) * 2; }
    const raw = [x, y, z];
    let t1 = x * ca + z * sa; z = -x * sa + z * ca; x = t1; t1 = y * ct - z * st; z = y * st + z * ct; y = t1;
    const p = [c[0] + x * sc, c[1] + y * sc, c[2] + z * sc]; const col = i % 5 === 0 ? pal.b : pal.a;
    R.point(p, col, o.size || 22, a * (thr > 0 || m < 0.9 ? 0.8 : 0.4), false);
    if (last && thr > 0 && Math.hypot(raw[0] - lastRaw[0], raw[1] - lastRaw[1], raw[2] - lastRaw[2]) < thr) R.line(last, p, col, 1.5, a * 0.7, false);
    last = p; lastRaw = raw;
  }
}

// ---------- lyrics ----------
const up = (s) => s.toUpperCase().replace(/[,—]/g, '').trim();
const MODE = { Intro: 'shout', Drop: 'shout', Verse: 'neon', 'Pre-Chorus': 'grow', Chorus: 'slam', Bridge: 'float', 'Final Chorus': 'slam' };
const LINES = LY.map((l, idx) => {
  const words = l.words.map(w => ({ raw: w.w, txt: up(w.w), s: w.start, e: w.end })).filter(w => w.txt);
  let mode = MODE[l.section]; if (idx === LY.length - 1) mode = 'final';
  let rows; const n = words.length;
  if (mode === 'neon' || mode === 'grow' || mode === 'float') { let cut = words.findIndex(w => w.raw.endsWith(',')); if (cut < 0 || cut === n - 1) cut = Math.ceil(n / 2) - 1; rows = [words.slice(0, cut + 1), words.slice(cut + 1)]; }
  else if (mode === 'slam') { const cut = n === 5 ? 3 : Math.ceil(n / 2); rows = [words.slice(0, cut), words.slice(cut)]; }
  else rows = words.map(w => [w]);
  return { idx, sec: l.section, mode, s: l.start, e: l.end, words, rows };
});
LINES.forEach((l, i) => { const nx = LINES[i + 1]; l.out = Math.min(l.e + (l.mode === 'neon' ? 0.9 : l.mode === 'float' ? 1.6 : 0.55), nx ? nx.s - 0.12 : l.e + 1); if (l.mode === 'slam' && nx && nx.s - l.e > 3) l.out = l.e + 0.8; });
function layoutRows(rows, fontName, gap, rowGap, justify, portraitSplit) {
  const R_ = rows.map(r => { const items = r.map(w => ({ w, mesh: textMesh(fontName, w.txt) })); const width = items.reduce((s, it) => s + it.mesh.w, 0) + gap * (items.length - 1); return { items, width }; });
  const maxW = Math.max(...R_.map(r => r.width)); let y = 0; const out = [];
  R_.forEach((r, ri) => { const k = justify ? clamp(maxW / r.width, 1, 1.7) : 1; let x = -r.width * k / 2; if (ri > 0) y -= (0.5 + rowGap) * k; r.y = y; for (const it of r.items) { out.push({ w: it.w, mesh: it.mesh, x: x + it.mesh.w * k / 2, y, k, row: ri }); x += (it.mesh.w + gap) * k; } y -= 0.5 * k; });
  const top = 0.5 * (justify ? clamp(maxW / R_[0].width, 1, 1.7) : 1); const height = top - y; const cy = (top + y) / 2;
  out.forEach(it => it.y -= cy); return { items: out, width: maxW, height };
}
const layCache = new Map();
function lay(line, R) { const portrait = R.H > R.W; const key = line.idx + (portrait ? 'p' : 'l'); if (layCache.has(key)) return layCache.get(key);
  let rows = line.rows; if (portrait && (line.mode === 'neon' || line.mode === 'grow' || line.mode === 'float')) { rows = []; for (const r of line.rows) { if (r.length > 3) { const c = Math.ceil(r.length / 2); rows.push(r.slice(0, c), r.slice(c)); } else rows.push(r); } }
  if (portrait && line.mode === 'slam') rows = line.words.length === 5 ? [line.words.slice(0, 2), line.words.slice(2, 3), line.words.slice(3)] : line.words.length === 4 && line.words[0].txt === 'TONIGHT' ? [[line.words[0]], [line.words[1], line.words[2]], [line.words[3]]] : line.rows;
  const L = line.mode === 'slam' ? layoutRows(rows, 'anton', 0.3, 0.34, true) : line.mode === 'neon' ? layoutRows(rows, 'chakra', 0.42, 0.75, false) : line.mode === 'grow' ? layoutRows(rows, 'shoulders', 0.36, 0.6, false) : line.mode === 'float' ? layoutRows(rows, 'chakra', 0.5, 0.9, false) : null;
  layCache.set(key, L); return L; }

function drawLyrics(R, t, pal, st) {
  const portrait = R.H > R.W; const frame = Math.round(t * FPS); const beat = bp(t);
  for (const line of LINES) {
    const pre = line.mode === 'neon' ? 0.4 : 0.05; if (t < line.s - pre || t > line.out + 0.6) continue;
    if (line.mode === 'shout' || line.mode === 'final') { shoutWords(R, t, line, pal, st); continue; }
    const L = lay(line, R); const z0 = 12; const exit = easeIn((t - (line.out - 0.24)) / 0.24); if (t > line.out) continue;
    let fracW = line.mode === 'slam' ? 0.76 : line.mode === 'neon' ? 0.8 : line.mode === 'grow' ? 0.66 : 0.66, fracH = line.mode === 'slam' ? 0.5 : 0.34; if (portrait) { fracW = 0.86; fracH = 0.42; }
    const z = lerp(z0, 0.3, exit); let s = Math.min(R.spanAt(z0, fracW) / L.width, fracH * R.H * z0 / R.f / L.height);
    const u = clamp((t - line.s) / (line.e - line.s)); let o = { x: 0, y: 0, z, rx: 0, ry: 0, rz: 0 };
    const yUp = R.H * z0 / R.f; // view units per screen height at z0
    if (line.mode === 'slam') { s *= 1 + 0.035 * beat; o.ry = 0.16 * Math.sin(t * 1.7 + line.idx); o.rx = -0.06 + 0.05 * Math.sin(t * 2.3); o.rz = 0.015 * Math.sin(t * 3.1); o.y = yUp * 0.02; }
    if (line.mode === 'neon') { o.y = yUp * (portrait ? 0.16 : 0.2); o.ry = 0.2 * Math.sin(t * 0.9 + line.idx * 2); o.rx = -0.1; o.rz = 0.012 * Math.sin(t * 1.3); }
    if (line.mode === 'grow') { s *= lerp(0.72, 1.12, u); const tr = smooth(119, 124.2, t) * 0.12; o.x = (hash(frame) - 0.5) * tr * 2; o.y = yUp * 0.02 + (hash(frame + 9) - 0.5) * tr * 2; o.rz = (hash(frame + 5) - 0.5) * tr * 0.06; }
    if (line.mode === 'float') { s *= 1.15; o.ry = lerp(0.55, -0.55, clamp((t - line.s + 0.3) / (line.out - line.s + 0.3))); o.rx = 0.08 * Math.sin(t * 0.8); o.y = yUp * 0.03 + 0.25 * Math.sin(t * 1.1); s *= 0.92; }
    for (let i = 0; i < L.items.length; i++) {
      const it = L.items[i], dt = t - it.w.s; const oo = { ...o, s: s * it.k, lx: it.x * s, ly: it.y * s };
      if (line.mode === 'slam') {
        if (dt < 0) continue; const pop = lerp(2.4, 1, backOut(dt / 0.17)); oo.s *= pop; oo.rz += (hash(i + line.idx * 7) - 0.5) * 0.25 * (1 - easeOut(dt / 0.2));
        const hot = dt < 0.1; const active = t < it.w.e + 0.1;
        R.text(it.mesh, oo, { fill: hot ? '#ffffff' : (pal.txt || '#fff'), stroke: pal.a, strokeW: 3.5, echo: 6, echoDz: 0.22, echoColor: active ? pal.b : pal.a, echoA: 0.8, glow: hot ? 0.5 : 0.22 });
      } else if (line.mode === 'neon') {
        const inA = clamp((t - (line.s - 0.4)) / 0.3); if (inA <= 0) continue; const flick = hash(frame * 1.7 + i * 13) > 0.3 ? 1 : 0.25;
        if (dt < 0) R.text(it.mesh, oo, { stroke: pal.a, strokeW: 1.6, strokeA: 0.42 * inA * (inA < 1 ? flick : 1), glow: 0.3 });
        else { const on = dt < 0.16 ? flick : 1; oo.s *= lerp(1.16, 1, easeOut(dt / 0.2)); R.text(it.mesh, oo, { fill: '#f4ffff', fillA: on, stroke: dt < it.w.e - it.w.s + 0.15 ? pal.b : pal.a, strokeW: 2.6, strokeA: on, echo: 3, echoDz: 0.3, echoColor: pal.b, echoA: 0.55, glow: 0.3 }); }
      } else if (line.mode === 'grow') {
        if (dt < 0) continue; const a = clamp(dt / 0.25); oo.ly += (1 - easeOut(dt / 0.35)) * -0.5 * s; R.text(it.mesh, oo, { fill: '#ffffff', fillA: a, stroke: pal.a, strokeW: 2.2, strokeA: a, echo: 4, echoDz: 0.35, echoColor: pal.b, echoA: 0.55 * a, glow: 0.3 });
      } else if (line.mode === 'float') {
        if (dt < -0.05) continue; const a = clamp((dt + 0.05) / 0.5); oo.z += (1 - easeOut((dt + 0.05) / 0.7)) * 5; R.text(it.mesh, oo, { fill: '#fff6e8', fillA: a, stroke: pal.a, strokeW: 2, strokeA: a, echo: 3, echoDz: 0.5, echoColor: pal.b, echoA: 0.45 * a, glow: 0.35 });
      }
    }
  }
}
function shoutWords(R, t, line, pal, st) {
  const portrait = R.H > R.W, fin = line.mode === 'final'; const z0 = 10, frame = Math.round(t * FPS);
  for (let i = 0; i < line.words.length; i++) {
    const w = line.words[i], nx = line.words[i + 1]; const endT = nx ? nx.s : (fin ? T.outro : line.e + 0.35); const dt = t - w.s;
    const mesh = textMesh('anton', w.txt); const s = Math.min(R.spanAt(z0, portrait ? 0.8 : (fin ? 0.58 : 0.52)) / mesh.w, (portrait ? 0.3 : fin ? 0.44 : 0.4) * R.H * z0 / R.f);
    if (dt >= 0 && t < endT) {
      const pop = lerp(fin ? 3.2 : 2.6, 1, backOut(dt / 0.15)); const grow = 1 + 0.06 * dt / Math.max(0.2, endT - w.s);
      const o = { x: (hash(frame) - 0.5) * 0.25 * Math.exp(-dt * 12), y: (hash(frame + 3) - 0.5) * 0.25 * Math.exp(-dt * 12), z: z0, s: s * pop * grow, rz: (hash(i * 3 + line.idx) - 0.5) * 0.12 * (1 - easeOut(dt / 0.25)), ry: 0.22 * Math.sin(t * 2 + i), rx: -0.05 };
      R.text(mesh, o, { fill: dt < 0.09 ? '#fff' : (pal.txt || '#fff'), stroke: pal.a, strokeW: 4, echo: fin ? 9 : 7, echoDz: 0.24, echoColor: i % 2 ? pal.b : pal.a, echoA: 0.85, glow: dt < 0.1 ? 0.5 : 0.22 });
    }
    // shatter the word into particles once it is replaced
    const xt = t - endT; if (xt >= 0 && xt < 0.7) { const pts = mesh.points(520); const a = 1 - xt / 0.7; for (let k = 0; k < pts.length; k++) { const h = hash(k * 1.9 + i), ang = hash(k * 3.7 + i) * 6.2832, sp = (2 + 9 * h) * xt * (fin ? 1.6 : 1); const v = [pts[k][0] * s + Math.cos(ang) * sp, pts[k][1] * s + Math.sin(ang) * sp - 4 * xt * xt, z0 - xt * 10 * h]; if (v[2] < R.near) continue; const p = R.scr(v); R.point2(p[0], p[1], k % 3 ? pal.a : pal.b, (2 + 4 * h) * R.unit, a); } }
  }
}

// ---------- HUD ----------
function hud(R, t, label, a = 0.55) {
  const g = R.g, W = R.W, H = R.H, u = R.unit, m = 38 * u, L = 34 * u; R.flush(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a; g.strokeStyle = '#9fefff'; g.lineWidth = 1.5 * u; g.beginPath();
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L); } g.stroke();
  g.fillStyle = '#cfefff'; g.font = `${Math.round(15 * u)}px Chakra`; g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText("XEN ONG  //  DON'T KILL THE VIBE", m + 14 * u, m + 14 * u);
  const tc = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(Math.floor((t % 1) * 30)).padStart(2, '0')}`;
  g.textAlign = 'right'; g.fillText(`${label}  ·  144 BPM  ·  ${tc}`, W - m - 14 * u, m + 14 * u);
  for (let b = 0; b < 24; b++) { const v = spec(t, b); g.fillRect(m + 14 * u + b * 7 * u, H - m - 12 * u - v * 26 * u, 4 * u, 2 * u + v * 26 * u); }
  g.globalAlpha = 1;
}

// ---------- scenes ----------
const shake = (t, amt) => { const f = Math.round(t * FPS); return [(hash(f * 1.3) - 0.5) * 2 * amt, (hash(f * 2.9) - 0.5) * 2 * amt]; };
const flyCam = (R, t, z, o = {}) => { const beat = bp(t), [sx, sy] = shake(t, (o.shake ?? 7) * beat * R.unit); R.setCam({ pos: [(o.swayX ?? 9) * noise1(t * 0.35), (o.h ?? 11) + (o.bob ?? 3) * noise1(t * 0.5 + 9), z], yaw: (o.yawA ?? 0.07) * noise1(t * 0.3 + 4), pitch: (o.pitch ?? 0.03) + 0.03 * noise1(t * 0.4 + 2), roll: (o.roll ?? 0) + (o.rollA ?? 0.1) * noise1(t * 0.33 + 7), fov: (o.fov ?? 78) + 9 * beat, sx, sy }); };

function scIntro(R, t) {
  const z = dist(t); R.far = 1400; const gc = [0, 95, z + 330];
  R.lookAt([0, 26 + t * 0.5, z], [0, 70, z + 330], { fov: 62, roll: 0.03 * Math.sin(t * 0.2) });
  R.begin(bgGrad(R, '#010008', lerp(0, 1, smooth(9, 12, t)) > 0.5 ? '#170a33' : '#0a0420', '#020108', smooth(2, 12, t)), { a: 0.5, zoom: 1.004, op: 'source-over' });
  const hitA = smooth(T.hit - 0.05, T.hit + 0.2, t); const NS = 640; let shown = clamp((t - 0.8) / 8.5); shown = Math.pow(shown, 1.5) * NS;
  // scattered sparks drift home onto a sphere
  for (let i = 0; i < Math.min(NS, Math.ceil(shown)); i++) {
    const y = 1 - 2 * (i + 0.5) / NS, r = Math.sqrt(1 - y * y), a = i * 2.39996 + t * 0.15; const home = [gc[0] + Math.cos(a) * r * 80, gc[1] + y * 80, gc[2] + Math.sin(a) * r * 80];
    const sc = [(hash(i * 1.1) - 0.5) * 900, 10 + hash(i * 2.3) * 330, z + 120 + hash(i * 3.9) * 700]; const m = easeIO(clamp((t - 5.2 - hash(i * 5.5) * 2.5) / 2.6));
    const p = [lerp(sc[0], home[0], m), lerp(sc[1], home[1], m) + Math.sin(t + i) * 3 * (1 - m), lerp(sc[2], home[2], m)]; const born = clamp((shown - i) / 6); const tw = 0.55 + 0.45 * Math.sin(t * 4 + i * 2.1);
    R.point(p, i % 4 ? C.ice : C.mag, 34 + 30 * (1 - m), born * tw * (0.9 + A('high', t)), false);
    if (m > 0.02 && m < 0.98 && i % 3 === 0) R.line(p, home, C.vio, 1, 0.22 * Math.sin(m * Math.PI), false);
  }
  if (hitA > 0) { globe(R, gc, 80, t, C.cy, { draw: easeOut((t - T.hit) / 1.2), alpha: 0.8, color2: C.mag, spin: 0.15 }); const rr = (t - T.hit) * 240; grid(R, z, C.mag, 0, { far: 1000, half: 520, alpha: 0.75, ripple: (zz) => { const d = zz - z; return d < rr ? clamp(1.6 - (rr - d) / 300, 0.45, 1.6) : 0; } }); if (t - T.hit < 2.5) { const n = 64, r0 = 80 + (t - T.hit) * 130; for (let k = 0; k < n; k++) { const a1 = k / n * 6.2832, a2 = (k + 1) / n * 6.2832; R.line([gc[0] + Math.cos(a1) * r0, gc[1] + Math.sin(a1) * r0, gc[2]], [gc[0] + Math.cos(a2) * r0, gc[1] + Math.sin(a2) * r0, gc[2]], C.wh, 2, 1 - (t - T.hit) / 2.5, false); } } }
  { const a0 = smooth(1.0, 2.2, t) * (1 - smooth(4.2, 5.4, t)); if (a0 > 0) { const m0 = textMesh('sync', 'XEN ONG PRESENTS', 0.7); const s0 = R.spanAt(12, R.H > R.W ? 0.6 : 0.3) / m0.w; R.text(m0, { x: 0, y: 0, z: 12, s: s0 }, { fill: C.ice, fillA: a0 * 0.9, glow: 0.5 }); } }
  // title
  const ta = smooth(11.2, 12.4, t) * (1 - smooth(16.0, 16.9, t));
  if (ta > 0) { const z0 = 12, portrait = R.H > R.W; const words = portrait ? ["DON'T KILL", 'THE VIBE'] : ["DON'T KILL THE VIBE"]; words.forEach((wd, wi) => { const m = textMesh('sync', wd, 0.22); const s = R.spanAt(z0, portrait ? 0.78 : 0.62) / m.w; const yU = R.H * z0 / R.f; const fl = hash(Math.round(t * 30) * 1.3) > 0.12 || t > 12.6 ? 1 : 0.3; R.text(m, { x: 0, y: -yU * 0.27 - wi * s * 1.7, z: z0, s }, { fill: '#fff', fillA: ta * fl, stroke: C.mag, strokeW: 1.6, strokeA: ta, echo: 2, echoDz: 0.6, echoColor: C.cy, echoA: 0.5 * ta, glow: 0.8 }); });
    const m2 = textMesh('sync', 'XEN ONG', 0.6); const s2 = R.spanAt(z0, portrait ? 0.3 : 0.17) / m2.w; R.text(m2, { x: 0, y: -R.H * z0 / R.f * (portrait ? 0.4 : 0.36), z: z0, s: s2 }, { fill: C.cy, fillA: ta * 0.95, glow: 0.5 }); }
  return { flash: Math.exp(-Math.max(0, t - T.hit) * 4) * 0.8 * (t >= T.hit ? 1 : 0), ca: 2 + 10 * Math.exp(-Math.abs(t - T.hit) * 5), fade: 1 - smooth(0.2, 2.2, t), label: 'SIGNAL FOUND', hudA: 0.4 * smooth(11, 13, t) };
}
function scBuild(R, t) {
  const z = dist(t), u = (t - T.build) / (T.drop1 - T.build), rise = smooth(28.3, 30.42, t); R.far = 1300;
  const [sx, sy] = shake(t, rise * 12 * R.unit); R.setCam({ pos: [6 * noise1(t * 0.3), lerp(40, 9, easeIO(u * 1.3)) + rise * 30, z], yaw: 0.05 * noise1(t * 0.3), pitch: lerp(0.12, 0.02, easeIO(u * 1.3)) + rise * 0.5, roll: 0.05 * noise1(t * 0.25) + rise * rise * 0.5, fov: 66 + 44 * rise * rise, sx, sy });
  R.begin(bgGrad(R, '#020010', '#2a0d4a', '#03010a'), { a: 0.4 + 0.45 * rise, zoom: 1.01 + 0.05 * rise, op: 'source-over' });
  globe(R, [0, 95, z + 330 + 500 * (1 - u)], 80 + 40 * u, t, C.cy, { alpha: 0.85, color2: C.mag });
  stars(R, z, t, C.ice, { n: 200, yMin: 80, yMax: 500, r: 700, span: 1400, size: 60 });
  grid(R, z, C.mag, 0, { far: 1000, half: 520, alpha: 0.75 });
  R.far = 1100; city(R, z, t, { a: C.vio, b: C.mag, c: C.cy }, { hScale: smooth(17, 26, t) });
  return { ca: 2 + 16 * rise, glitch: (t > 22.45 && t < 24.1 ? 0.5 * bpRaw(t) + 0.2 : 0) + rise * 0.5, flash: smooth(30.2, 30.44, t) * 0.9, label: 'APPROACH', lyr: { a: C.mag, b: C.cy } };
}
function scCity(R, t, v) {
  const z = dist(t); R.far = 1000; const beat = bp(t); const bar = barOf(t);
  const P = [{ a: C.mag, b: C.cy, c: C.amb, bg: ['#03000f', '#3a0b52', '#05010c'] }, { a: C.cy, b: C.vio, c: C.mag, bg: ['#00030f', '#0b2a5a', '#01030c'] }, { a: C.amb, b: C.mag, c: C.wh, bg: ['#0a0006', '#5a0b3a', '#0c0106'] }, { a: C.wh, b: C.mag, c: C.cy, bg: ['#05000a', '#4a0b5a', '#08010c'] }][v.pal];
  let o = { fov: 80 }; let fb = { a: 0.42, zoom: 1.02 + 0.035 * beat, op: 'source-over' };
  if (v.mode === 'high') { const k = smooth(v.t0, v.t0 + 1.2, t) * (1 - smooth(v.t1 - 1.5, v.t1, t)); o = { h: 11 + 75 * k, pitch: 0.03 - 0.3 * k, fov: 80, rollA: 0.16 }; }
  if (v.mode === 'low') o = { h: 7, bob: 2, fov: 84, swayX: 12, rollA: 0.16 };
  if (v.mode === 'verse') o = { h: 13, bob: 2.5, fov: 74, swayX: 10, rollA: 0.08, shake: 4, pitch: 0.06 };
  if (v.roll) { const r = clamp((t - v.roll) / 1.67); o.roll = easeIO(r) * 6.2832; }
  if (v.riser) { const r = smooth(v.riser, v.t1, t); o.fov = (o.fov || 80) + 35 * r * r; o.pitch = (o.pitch ?? 0.03) + 0.25 * r; fb.a = 0.42 + 0.4 * r; fb.zoom += 0.04 * r; }
  flyCam(R, t, z, o);
  R.begin(bgGrad(R, P.bg[0], P.bg[1], P.bg[2]), fb);
  globe(R, [0, 120, z + 520], 130 * (1 + 0.1 * beat), t, P.b, { alpha: 0.75, color2: P.a, lat: 10, lon: 16 });
  stars(R, z, t, C.ice, { n: 160, yMin: 60, yMax: 420, r: 600, span: 1200, streak: v.mode === 'verse' ? 8 : 26, alpha: 0.6 });
  grid(R, z, P.a, 0, { far: 800, half: 440, alpha: 0.7 });
  city(R, z, t, P);
  if (v.sculpt) { const k = smooth(v.sculpt.t0, v.sculpt.t0 + 0.8, t) * (1 - smooth(v.sculpt.t1 - 0.5, v.sculpt.t1, t)); if (k > 0) sculpture(R, t, v.sculpt.t0, v.sculpt.seq, [R.cam.pos[0] * 0.6, R.cam.pos[1] + (v.sculpt.dy ?? 14), z + 60], 15 * k, { a: C.ice, b: P.c }, { alpha: k, size: 22 }); }
  if (v.ring) specRing(R, t, R.W / 2, R.H / 2, R.H * 0.36, P.c, { color2: C.wh, len: 90, alpha: 0.5, rot: t * 0.2 });
  return { ca: 3 + 8 * beat + (v.riser ? 14 * smooth(v.riser, v.t1, t) : 0), flash: 0.05 * beat + Math.exp(-Math.max(0, t - v.t0) * 5) * 0.75, glitch: v.riser ? smooth(v.riser, v.t1, t) * 0.6 : 0, label: v.label, lyr: { a: P.a, b: P.c, txt: '#fff' } };
}
function scWarp(R, t) { // drop 2: sculpture in a racing void
  const z = dist(t), beat = bp(t); R.far = 900; const [sx, sy] = shake(t, 8 * beat * R.unit);
  const orb = (t - T.drop2) * 0.35; R.setCam({ pos: [Math.sin(orb) * 14, 70 + 8 * Math.sin(orb * 1.3), z], yaw: -Math.sin(orb) * 0.12, pitch: 0, roll: 0.25 * Math.sin(orb * 0.7), fov: 82 + 10 * beat, sx, sy });
  const fill = smooth(80.9, 82.5, t);
  R.begin(bgGrad(R, '#000614', '#10104a', '#02000c', 0.8), { a: 0.5, zoom: 1.03 + 0.04 * beat, rot: 0.004, op: 'source-over' });
  stars(R, z, t, C.ice, { n: 420, r: 300, yMin: -230, yMax: 600, span: 900, streak: 60 + 50 * beat, color2: C.mag, alpha: 0.8 });
  grid(R, z, C.vio, 0, { far: 700, alpha: 0.6, step: 26 }); grid(R, z, C.cy, 140, { far: 700, alpha: 0.45, step: 26 });
  const shout = t > 62.7 && t < 64.75; const seq = ['sphere', 'cube', 'knot', 'icosa', 'VIBE', 'helix', 'octa', 'saturn'];
  sculpture(R, t, T.drop2, seq, [0, 70, z + 62], 21, { a: C.ice, b: C.mag }, { alpha: shout ? 0.25 : 1, size: 22, explode: fill * 1.2 });
  if (!shout) specRing(R, t, R.W / 2 + sx, R.H / 2 + sy, R.H * 0.34, C.cy, { color2: C.mag, len: 110, rot: -t * 0.25, alpha: 0.75 });
  rays(R, t, C.cy, { color2: C.mag, alpha: 0.35, speed: 2 });
  return { ca: 3 + 9 * beat + 14 * fill, glitch: (shout ? 0.35 : 0) + fill * 0.7, flash: 0.05 * beat + Math.exp(-Math.max(0, t - T.drop2) * 5) * 0.85, label: 'OVERDRIVE', lyr: { a: C.cy, b: C.mag } };
}
function scTunnel(R, t, v) {
  const z = dist(t), beat = bp(t); R.far = 760; const bend = v.bend; const c = tunC(z, bend), a = tunC(z + 70, bend);
  const rise = v.riser ? smooth(v.riser, v.t1, t) : 0; const [sx, sy] = shake(t, (v.shake * beat + 10 * rise) * R.unit);
  R.lookAt([c[0] + 5 * noise1(t * 0.7), c[1] + 5 * noise1(t * 0.6 + 3), z], a, { roll: v.rollSpeed * (t - v.t0) + 0.2 * noise1(t * 0.4), fov: v.fov + 10 * beat + 30 * rise * rise, sx, sy });
  R.begin((g, W, H) => { g.fillStyle = v.bg; g.fillRect(0, 0, W, H); }, { a: 0.45 + 0.3 * rise, zoom: 1.03 + 0.03 * beat + 0.05 * rise, rot: v.rollSpeed * 0.01, op: 'source-over' });
  const k = v.grow ? smooth(v.t0, v.t1, t) : 1; const pal = v.grow ? { a: C.vio, b: k > 0.6 ? C.wh : C.mag, c: C.cy } : v.pal;
  tunnel(R, z, t, pal, { bend, twist: v.twist, pulse: v.pulse, gates: v.gates, rad: v.rad, step: v.step });
  // light at the end
  const e = tunC(z + 700, bend); const ep = R.project(e); if (ep && v.grow) { const rr = (16 + 70 * rise * rise) * R.unit; const pth = new Path2D(); pth.arc(ep[0], ep[1], rr, 0, 6.2832); R.fillScreen(pth, '#ffffff', 0.5 + 0.4 * rise, 0.45, 'lighter'); }
  if (v.rays) rays(R, t, pal.b, { color2: pal.c, alpha: 0.4, speed: 2.4 });
  return { ca: 3 + 8 * beat + 14 * rise, glitch: rise * 0.45, flash: 0.05 * beat + (v.flashIn ? Math.exp(-Math.max(0, t - v.t0) * 5) * 0.8 : 0) + smooth(v.t1 - 0.12, v.t1, t) * (v.riser ? 0.8 : 0), label: v.label, lyr: v.lyr || { a: pal.a, b: pal.c } };
}
function scChorus(R, t, v) {
  const z = dist(t), beat = bp(t); R.far = 1000; flyCam(R, t, z, { h: 46, bob: 4, fov: 84, rollA: 0.12, pitch: 0.0, shake: 9 });
  const P = v.final ? { a: C.amb, b: C.mag, c: C.wh } : { a: C.mag, b: C.cy, c: C.amb };
  R.begin(bgGrad(R, v.final ? '#0a0206' : '#06000f', v.final ? '#6a1440' : '#4a0b6a', '#06010c'), { a: 0.46, zoom: 1.03 + 0.045 * beat, op: 'source-over' });
  globe(R, [0, 46, z + 560], 190 * (1 + 0.12 * beat), t, P.b, { alpha: 0.8, color2: P.a, lat: 12, lon: 18, spin: 0.3 });
  stars(R, z, t, C.ice, { n: 260, r: 380, yMin: -30, yMax: 400, span: 900, streak: 50 + 40 * beat, color2: P.a, alpha: 0.7 });
  grid(R, z, P.a, 0, { far: 800, alpha: 0.8 }); grid(R, z, P.b, 150, { far: 800, alpha: 0.4 });
  if (v.final) { R.far = 800; city(R, z, t, { a: C.mag, b: C.amb, c: C.wh }, { road: 70 }); }
  rays(R, t, P.c, { color2: P.a, alpha: 0.5, speed: 2.2, n: 60 });
  return { ca: 4 + 10 * beat, flash: 0.07 * beat + Math.exp(-Math.max(0, t - v.t0) * 4.5) * 0.9, label: v.label, lyr: { a: P.a, b: P.b, txt: '#fff' } };
}
function scBreak(R, t) {
  const u = (t - T.brk) / (T.drop3 - T.brk), rise = smooth(161.8, 164.66, t), z = dist(t); R.far = 900;
  const ang = 0.6 + (t - T.brk) * 0.11, Dd = lerp(150, 95, easeIO(u)) * (1 - 0.5 * rise * rise); const gc = [0, 60, z + 200]; const [sx, sy] = shake(t, 10 * rise * R.unit);
  R.lookAt([gc[0] + Math.sin(ang) * Dd, 44 + 20 * Math.sin(t * 0.2), gc[2] - Math.cos(ang) * Dd], gc, { fov: 60 + 40 * rise * rise, roll: 0.1 * Math.sin(t * 0.3) + rise * 0.6, sx, sy });
  R.begin(bgGrad(R, '#000308', '#062838', '#00060a', 0.9), { a: 0.6 + 0.25 * rise, zoom: 1.006 + 0.05 * rise, op: 'source-over' });
  grid(R, z - 300, C.cy, 0, { far: 900, half: 600, alpha: 0.28, step: 30 });
  const n = 900, pulse = 1 + 0.25 * A('low', t); const col = 1 - rise * rise;
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996 + t * 0.2; const rr = 46 * pulse * col * (1 + 0.06 * Math.sin(t * 1.6 + y * 6)); const p = [gc[0] + Math.cos(a) * r * rr, gc[1] + y * rr, gc[2] + Math.sin(a) * r * rr]; R.point(p, i % 6 ? C.cy : C.wh, 20, 0.9, false); if (i % 9 === 0) R.line(p, [gc[0] + (p[0] - gc[0]) * 1.25, gc[1] + (p[1] - gc[1]) * 1.25, gc[2] + (p[2] - gc[2]) * 1.25], C.blue, 1, 0.5, false); }
  for (let i = 0; i < 260; i++) { const p = [gc[0] + (hash(i * 1.1) - 0.5) * 420, ((hash(i * 2.3) * 220 + t * (4 + 8 * hash(i))) % 220), gc[2] + (hash(i * 3.7) - 0.5) * 420]; R.point(p, i % 3 ? C.ice : C.mag, 26, 0.55 + 0.4 * Math.sin(t * 2 + i), false); }
  for (let k = 0; k < 3; k++) { const n2 = 90, rr = 46 * pulse * col * (1.35 + k * 0.22), tl = 0.5 + k * 0.7 + t * 0.2; for (let j = 0; j < n2; j++) { const a1 = j / n2 * 6.2832, a2 = (j + 1) / n2 * 6.2832; const P3 = (a) => [gc[0] + Math.cos(a) * rr, gc[1] + Math.sin(a) * rr * Math.sin(tl), gc[2] + Math.sin(a) * rr * Math.cos(tl)]; if ((j + Math.floor(t * 6)) % 6) R.line(P3(a1), P3(a2), k === 1 ? C.mag : C.cy, 1.4, 0.6, false); } }
  const shout = t > 156.4 && t < 158.6;
  return { ca: 2 + 5 * A('low', t) + 18 * rise + (shout ? 8 : 0), glitch: (shout ? 0.55 : 0) + rise * 0.6, flash: smooth(164.5, 164.69, t) * 0.9 + Math.exp(-Math.max(0, t - T.brk) * 3) * 0.5, label: 'SIGNAL LOST', lyr: { a: C.cy, b: C.mag }, grain: 0.1 };
}
function scBridge(R, t) {
  const u = (t - T.bridge) / (T.final - T.bridge), build = smooth(184, 191.4, t), z = dist(t); R.far = 700; const ang = (t - T.bridge) * 0.16 - 1;
  const [sx, sy] = shake(t, 9 * smooth(189.6, 191.45, t) * R.unit);
  R.lookAt([Math.sin(ang) * 120, 50 + 10 * Math.sin(t * 0.3), z + 200 - Math.cos(ang) * 120], [0, 55, z + 200], { fov: 58 + 34 * smooth(190.2, 191.48, t), roll: 0.06 * Math.sin(t * 0.4), sx, sy });
  R.begin(bgGrad(R, '#0a0204', '#4a1a12', '#0a0305', 0.9), { a: 0.62, zoom: 1.006 + 0.04 * smooth(189.5, 191.45, t), op: 'source-over' });
  grid(R, z - 200, C.amb, 0, { far: 800, half: 500, alpha: 0.22, step: 30 });
  for (let i = 0; i < 520; i++) { const sp = (5 + 16 * hash(i * 4.4)) * (1 + 4 * build * build); const yy = (hash(i * 2.3) * 260 + t * sp) % 260; const sw = 6 * Math.sin(t * 0.7 + i); const p = [(hash(i * 1.1) - 0.5) * 460 + sw, yy, z + 200 + (hash(i * 3.7) - 0.5) * 460]; const col = i % 4 === 0 ? C.pink : i % 7 === 0 ? C.wh : C.amb; R.point(p, col, 40, 0.5 + 0.5 * Math.sin(t * 1.7 + i * 1.3), false); if (build > 0.3) R.line(p, [p[0], p[1] - sp * 0.12 * build, p[2]], col, 1.2, 0.5 * build, false); }
  globe(R, [0, 55, z + 200], 30 + 6 * A('low', t), t, C.amb, { alpha: 0.35 + 0.3 * build, color2: C.pink, lat: 7, lon: 10, spin: 0.5 });
  return { ca: 2 + 4 * A('low', t) + 12 * smooth(189.5, 191.45, t), bloom: 1.1, wide: 0.8, flash: Math.exp(-Math.max(0, t - T.bridge) * 3) * 0.5 + smooth(191.3, 191.49, t) * 0.8, label: 'HOLD TIGHT', lyr: t > 190 ? { a: C.amb, b: C.mag } : { a: C.amb, b: C.pink }, glitch: smooth(190.3, 191.45, t) * 0.4 };
}
function scLast(R, t) { // frozen world, one word at a time, cracks spreading
  const z = dist(t); R.far = 900; const duck = clamp(A('rms', t) * 2.2 + 0.25); const [sx, sy] = shake(t, 14 * bpRaw(t) * R.unit * 0);
  const hits = LINES[LINES.length - 1].words.map(w => w.s); let last = -1; hits.forEach((h, i) => { if (t >= h) last = i; }); const since = last >= 0 ? t - hits[last] : 9; const [kx, ky] = shake(t, 26 * Math.exp(-since * 9) * R.unit);
  R.setCam({ pos: [0, 46, z], yaw: 0, pitch: 0, roll: 0.02 * (last % 2 ? 1 : -1), fov: 84 - 6 * Math.exp(-since * 6), sx: kx, sy: ky });
  R.begin(bgGrad(R, '#08010a', '#3a0a40', '#06010c', 0.5 * duck), { a: 0.3, zoom: 1.02, op: 'source-over' });
  globe(R, [0, 46, z + 560], 190, t, C.mag, { alpha: 0.35 * duck, color2: C.amb, lat: 12, lon: 18, spin: 0.05 }); grid(R, z, C.amb, 0, { far: 800, alpha: 0.35 * duck });
  // cracks
  for (let h = 0; h <= last; h++) { const age = t - hits[h]; const n = 7 + h * 3; for (let k = 0; k < n; k++) { let a = hash(h * 9.1 + k * 3.3) * 6.2832, x = R.W / 2, y = R.H / 2; const len = (0.25 + hash(k * 1.7 + h) * 0.75) * Math.hypot(R.W, R.H) * 0.6 * easeOut(age / 0.18); const segs = 9; for (let s = 0; s < segs; s++) { a += (hash(h * 4.3 + k * 7.7 + s * 1.9) - 0.5) * 0.9; const nx = x + Math.cos(a) * len / segs, ny = y + Math.sin(a) * len / segs; R.line2(x, y, nx, ny, k % 3 ? C.wh : C.amb, 2.6 - s * 0.2, clamp(1.2 - age * 0.5) * (0.5 + 0.5 * duck)); x = nx; y = ny; } } }
  return { ca: 4 + 22 * Math.exp(-since * 8), glitch: 0.75 * Math.exp(-since * 7), flash: 0.6 * Math.exp(-since * 14), label: 'LAST CALL', lyr: { a: C.mag, b: C.amb }, invert: 0 };
}
function scOutro(R, t) {
  const stop = easeIn(clamp((t - T.stop) / (T.end - T.stop))); const wind = smooth(T.wind, T.stop, t);
  const hue = Math.floor((barOf(t).bar) % 3 + 3) % 3; const pals = [3, 0, 2];
  const r = scCity(R, t, { pal: t < T.wind ? pals[hue] : 0, mode: wind > 0 ? 'high' : 'low', t0: wind > 0 ? T.wind : T.outro, t1: 230, label: wind > 0 ? 'FADE OUT' : 'FULL SEND', ring: t < T.wind, sculpt: t < T.wind ? { t0: T.outro, t1: T.wind + 0.3, seq: ['VIBE!', 'sphere', 'knot', 'cube', 'icosa'], dy: 16 } : null });
  if (wind > 0) { const z0 = 12, portrait = R.H > R.W; const a = smooth(T.wind + 0.4, T.wind + 1.4, t); const words = portrait ? ["DON'T KILL", 'THE VIBE'] : ["DON'T KILL THE VIBE"]; words.forEach((wd, wi) => { const m = textMesh('sync', wd, 0.22); const s = R.spanAt(z0, portrait ? 0.78 : 0.66) / m.w; R.text(m, { x: 0, y: R.H * z0 / R.f * 0.06 - wi * s * 1.7, z: z0, s }, { fill: '#fff', fillA: a, stroke: C.mag, strokeW: 1.6, strokeA: a, echo: 3, echoDz: 0.6, echoColor: C.cy, echoA: 0.5 * a, glow: 0.8 }); }); }
  r.squash = stop * 0.992; r.glitch = (r.glitch || 0) + (t > T.stop ? 0.5 * stop + 0.2 : 0); r.ca += 20 * stop; r.dropY = stop * stop * 0.25; r.fade = smooth(T.end - 0.12, T.end, t); if (t >= T.outro && t < T.outro + 1) r.flash += Math.exp(-(t - T.outro) * 4);
  return r;
}
function scCredits(R, t) {
  R.setCam({ pos: [0, 0, 0], yaw: 0, pitch: 0, fov: 60 }); R.begin(null, null); const a = smooth(T.end + 0.5, T.end + 1.3, t) * (1 - smooth(T.total - 1.0, T.total - 0.2, t)); const z0 = 12, portrait = R.H > R.W;
  const dot = Math.exp(-(t - T.end) * 5); if (dot > 0.02) { R.line2(R.W / 2 - R.W * 0.25 * dot, R.H / 2, R.W / 2 + R.W * 0.25 * dot, R.H / 2, C.wh, 3, dot); }
  if (a > 0) { const m = textMesh('sync', 'XEN ONG', 0.6); const s = R.spanAt(z0, portrait ? 0.5 : 0.26) / m.w; R.text(m, { x: 0, y: 0.3, z: z0, s }, { fill: '#fff', fillA: a, stroke: C.cy, strokeW: 1.4, strokeA: a * 0.8, glow: 0.7 }); const m2 = textMesh('sync', "DON'T KILL THE VIBE", 0.4); const s2 = R.spanAt(z0, portrait ? 0.6 : 0.3) / m2.w; R.text(m2, { x: 0, y: -1.1 * s - 0.3, z: z0, s: s2 }, { fill: C.mag, fillA: a * 0.9, glow: 0.5 }); }
  return { ca: 2, label: '', hudA: 0, noLyr: true };
}

function pick(R, t) {
  if (t < T.build) return scIntro(R, t);
  if (t < T.drop1) return scBuild(R, t);
  if (t < 43.85) return scCity(R, t, { pal: 0, mode: 'low', t0: T.drop1, t1: 43.85, label: 'NIGHT CITY' });
  if (t < T.drop2) return scCity(R, t, { pal: 1, mode: 'high', t0: 43.85, t1: T.drop2, riser: 53.6, label: 'SKYLINE', sculpt: { t0: 43.85, t1: 56.6, seq: ['sphere', 'icosa', 'knot', 'cube'], dy: -17 } });
  if (t < T.verse) return scWarp(R, t);
  if (t < T.pre) return scCity(R, t, { pal: 1, mode: 'verse', t0: 83.95, t1: T.pre, label: 'VERSE' });
  if (t < T.chorus) return scTunnel(R, t, { t0: T.pre, t1: T.chorus, bend: 0.5, twist: 0.6, pulse: 0.15, rollSpeed: 0.12, fov: 76, shake: 3, grow: true, riser: 121.8, bg: '#040010', label: 'LIGHTS LOW', lyr: t > 123.2 ? { a: C.mag, b: C.cy } : { a: C.vio, b: C.cy } });
  if (t < T.post) return scChorus(R, t, { t0: T.chorus, label: 'CHORUS' });
  if (t < T.brk) return scCity(R, t, { pal: 2, mode: 'low', t0: T.post, t1: T.brk, roll: 143.45, ring: true, label: 'DROP', sculpt: { t0: T.post, t1: T.brk, seq: ['VIBE', 'octa', 'knot', 'saturn'], dy: 16 } });
  if (t < T.drop3) return scBreak(R, t);
  if (t < T.bridge) return scTunnel(R, t, { t0: T.drop3, t1: T.bridge, bend: 0.9, twist: 1.6, pulse: 0.45, rollSpeed: 0.5, fov: 96, step: 11, shake: 9, gates: true, rays: true, flashIn: true, bg: '#020a02', pal: { a: C.lime, b: C.mag, c: C.cy }, label: 'HYPERLOOP' });
  if (t < T.final) return scBridge(R, t);
  if (t < T.last) return scChorus(R, t, { t0: T.final, final: true, label: 'FINAL CHORUS' });
  if (t < T.outro) return scLast(R, t);
  if (t < T.end) return scOutro(R, t);
  return scCredits(R, t);
}

export function drawFrame(R, t) {
  const p = pick(R, t); const frame = Math.round(t * FPS);
  R.snapshot();
  { const cr = R.cr, sr = R.sr; R.cr = 1; R.sr = 0; if (!p.noLyr) drawLyrics(R, t, p.lyr || { a: C.mag, b: C.cy }, p); R.flush(); R.cr = cr; R.sr = sr; }
  if ((p.hudA ?? 0.5) > 0) hud(R, t, p.label || '', p.hudA ?? 0.5);
  R.end({ bloom: p.bloom ?? 0.95, wide: p.wide ?? 0.6, flash: p.flash || 0, grain: p.grain ?? 0.07, seed: frame, fade: p.fade || 0 });
  return R.pixels({ ca: p.ca || 0, glitch: (p.glitch || 0) > 0.08 && hash(frame * 0.77) < 0.25 + (p.glitch || 0) ? p.glitch : 0, seed: frame * 1.31, squash: p.squash || 0 });
}
