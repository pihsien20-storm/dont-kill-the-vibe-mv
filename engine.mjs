// Tiny neon vector 3D engine on Skia canvas. Every frame is a function of time.
import { createCanvas, Path2D, GlobalFonts } from '@napi-rs/canvas';
import opentype from 'opentype.js';
import fs from 'fs';

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = (t) => Math.pow(clamp(t), 3);
export const easeIO = (t) => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const backOut = (t) => { t = clamp(t); const c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function hash2(a, b) { return hash(a * 157.31 + b * 73.97 + 0.123); }
export function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }

const FONT_DIR = new URL('./node_modules/@fontsource/', import.meta.url).pathname;
const FONT_FILES = {
  anton: 'anton/files/anton-latin-400-normal.woff',
  chakra: 'chakra-petch/files/chakra-petch-latin-600-normal.woff',
  chakraL: 'chakra-petch/files/chakra-petch-latin-300-normal.woff',
  sync: 'syncopate/files/syncopate-latin-700-normal.woff',
  shoulders: 'big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff',
};
const fonts = {};
function font(name) {
  if (!fonts[name]) { const b = fs.readFileSync(FONT_DIR + FONT_FILES[name]); fonts[name] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  return fonts[name];
}
GlobalFonts.registerFromPath(FONT_DIR + 'chakra-petch/files/chakra-petch-latin-500-normal.woff', 'Chakra');

// ---- text → vector contours (y up, centred on cap-height middle, cap height = 1 unit) ----
const meshCache = new Map();
export function textMesh(fontName, str, tracking = 0) {
  const key = fontName + '|' + str + '|' + tracking;
  if (meshCache.has(key)) return meshCache.get(key);
  const f = font(fontName); const S = 1000;
  const cap = (f.tables.os2 && f.tables.os2.sCapHeight ? f.tables.os2.sCapHeight : f.ascender * 0.7) / f.unitsPerEm * S;
  const path = f.getPath(str, 0, 0, S, { letterSpacing: tracking });
  const contours = []; let cur = null, px = 0, py = 0;
  const N = 7;
  for (const c of path.commands) {
    if (c.type === 'M') { cur = [[c.x, c.y]]; contours.push(cur); px = c.x; py = c.y; }
    else if (c.type === 'L') { cur.push([c.x, c.y]); px = c.x; py = c.y; }
    else if (c.type === 'Q') { for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; cur.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y]); } px = c.x; py = c.y; }
    else if (c.type === 'C') { for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; cur.push([u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y]); } px = c.x; py = c.y; }
  }
  let minX = 1e9, maxX = -1e9;
  for (const c of contours) for (const p of c) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; }
  if (!contours.length) { minX = 0; maxX = 0; }
  const adv = f.getAdvanceWidth(str, S, { letterSpacing: tracking });
  const cx = (minX + maxX) / 2;
  const out = contours.filter(c => c.length > 2).map(c => c.map(p => [(p[0] - cx) / cap, (-p[1] - cap / 2) / cap]));
  // perimeter sample points
  const segs = []; let total = 0;
  for (const c of out) for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, l]); total += l; }
  const mesh = { contours: out, w: (maxX - minX) / cap, adv: adv / cap, segs, total, _pts: new Map() };
  mesh.points = (n) => {
    if (mesh._pts.has(n)) return mesh._pts.get(n);
    const pts = []; let si = 0, acc = 0;
    for (let i = 0; i < n; i++) { const d = (i + 0.5) / n * total; while (si < segs.length - 1 && acc + segs[si][2] < d) { acc += segs[si][2]; si++; } const s = segs[si]; const t = s[2] ? (d - acc) / s[2] : 0; pts.push([lerp(s[0][0], s[1][0], t), lerp(s[0][1], s[1][1], t)]); }
    mesh._pts.set(n, pts); return pts;
  };
  meshCache.set(key, mesh); return mesh;
}

// ---- renderer ----
export class Renderer {
  constructor(W, H) {
    this.W = W; this.H = H; this.GS = 4;
    this.c = createCanvas(W, H); this.g = this.c.getContext('2d');
    this.gc = createCanvas(W / this.GS, H / this.GS); this.gg = this.gc.getContext('2d');
    this.gb = createCanvas(W / this.GS, H / this.GS); this.gbg = this.gb.getContext('2d');
    this.gw = createCanvas(W / 16, H / 16); this.gwg = this.gw.getContext('2d');
    this.prev = createCanvas(W, H); this.pg = this.prev.getContext('2d');
    this.lines = new Map(); this.pts = new Map();
    this.cam = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, fov: 70, sx: 0, sy: 0 };
    this.far = 900; this.near = 0.4;
    this.unit = Math.min(W, H) / 1080; // stroke scale
    // static overlays
    this.vig = createCanvas(W, H); const vg = this.vig.getContext('2d');
    const gr = vg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)'); vg.fillStyle = gr; vg.fillRect(0, 0, W, H);
    this.scan = createCanvas(W, H); const sg = this.scan.getContext('2d'); sg.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 0; y < H; y += 3) sg.fillRect(0, y, W, 1);
    this.noise = createCanvas(512, 512); const ng = this.noise.getContext('2d'); const id = ng.createImageData(512, 512);
    for (let i = 0; i < 512 * 512; i++) { const v = Math.floor(hash(i * 1.37) * 255); id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ng.putImageData(id, 0, 0);
  }
  setCam(c) {
    Object.assign(this.cam, { roll: 0, sx: 0, sy: 0, fov: 70 }, c);
    const cm = this.cam; const cy = Math.cos(cm.yaw), sy = Math.sin(cm.yaw), cp = Math.cos(cm.pitch), sp = Math.sin(cm.pitch);
    this.R = [cy, 0, -sy, /*right*/  -sy * sp, cp, -cy * sp, /*up*/  sy * cp, sp, cy * cp /*fwd*/];
    const base = this.W >= this.H ? this.H / 2 : this.W / 2 * 1.15;
    this.f = base / Math.tan(cm.fov * Math.PI / 360);
    this.cr = Math.cos(cm.roll); this.sr = Math.sin(cm.roll);
  }
  lookAt(pos, target, extra = {}) {
    const dx = target[0] - pos[0], dy = target[1] - pos[1], dz = target[2] - pos[2];
    this.setCam({ pos, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), ...extra });
  }
  view(p) { const c = this.cam.pos, R = this.R; const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2]; return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z]; }
  scr(v) { const k = this.f / v[2]; const x = v[0] * k, y = -v[1] * k; return [this.W / 2 + x * this.cr - y * this.sr + this.cam.sx, this.H / 2 + x * this.sr + y * this.cr + this.cam.sy]; }
  project(p) { const v = this.view(p); if (v[2] < this.near) return null; const s = this.scr(v); s.push(v[2]); return s; }
  fade(z) { return clamp(1 - z / this.far); }
  _bucket(color, width, alpha) { const a = Math.max(1, Math.round(clamp(alpha) * 10)); const key = color + '|' + width + '|' + a; let b = this.lines.get(key); if (!b) { b = { color, width, alpha: a / 10, path: new Path2D() }; this.lines.set(key, b); } return b; }
  // world-space line
  line(a, b, color, width = 1.5, alpha = 1, fog = true) {
    let va = this.view(a), vb = this.view(b); const n = this.near;
    if (va[2] < n && vb[2] < n) return;
    if (va[2] < n) { const t = (n - va[2]) / (vb[2] - va[2]); va = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t), n]; }
    else if (vb[2] < n) { const t = (n - vb[2]) / (va[2] - vb[2]); vb = [lerp(vb[0], va[0], t), lerp(vb[1], va[1], t), n]; }
    const z = Math.min(va[2], vb[2]); if (z > this.far) return;
    const fa = fog ? alpha * Math.pow(this.fade((va[2] + vb[2]) / 2), 1.4) : alpha; if (fa < 0.04) return;
    const s1 = this.scr(va), s2 = this.scr(vb);
    const W = this.W, H = this.H; if ((s1[0] < -W && s2[0] < -W) || (s1[0] > 2 * W && s2[0] > 2 * W) || (s1[1] < -H && s2[1] < -H) || (s1[1] > 2 * H && s2[1] > 2 * H)) return;
    const bk = this._bucket(color, width, fa); bk.path.moveTo(s1[0], s1[1]); bk.path.lineTo(s2[0], s2[1]);
  }
  poly(ptsArr, color, width = 1.5, alpha = 1, closed = true, fog = true) { const n = ptsArr.length; for (let i = 0; i < (closed ? n : n - 1); i++) this.line(ptsArr[i], ptsArr[(i + 1) % n], color, width, alpha, fog); }
  line2(x1, y1, x2, y2, color, width = 1.5, alpha = 1) { const bk = this._bucket(color, width, alpha); bk.path.moveTo(x1, y1); bk.path.lineTo(x2, y2); }
  point(p, color, size = 2, alpha = 1, fog = true) {
    const s = this.project(p); if (!s) return; const a = fog ? alpha * this.fade(s[2]) : alpha; if (a < 0.04) return;
    const sz = Math.max(1, size * this.f / s[2] * 0.05); this.point2(s[0], s[1], color, Math.min(sz, 8 * this.unit), a);
  }
  point2(x, y, color, size, alpha = 1) { const a = Math.max(1, Math.round(clamp(alpha) * 10)); const key = color + '|' + a; let b = this.pts.get(key); if (!b) { b = { color, alpha: a / 10, path: new Path2D() }; this.pts.set(key, b); } b.path.rect(x - size / 2, y - size / 2, size, size); }
  flush(glow = 1) {
    const g = this.g, gg = this.gg, u = this.unit;
    g.globalCompositeOperation = 'lighter'; gg.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; gg.lineCap = 'round';
    for (const b of this.lines.values()) {
      g.strokeStyle = b.color; g.globalAlpha = b.alpha; g.lineWidth = b.width * u; g.stroke(b.path);
      if (glow > 0) { gg.strokeStyle = b.color; gg.globalAlpha = Math.min(1, b.alpha * glow); gg.lineWidth = Math.max(1.2, b.width * u * 0.9); gg.stroke(b.path); }
    }
    for (const b of this.pts.values()) {
      g.fillStyle = b.color; g.globalAlpha = b.alpha; g.fill(b.path);
      if (glow > 0) { gg.fillStyle = b.color; gg.globalAlpha = Math.min(1, b.alpha * glow); gg.fill(b.path); }
    }
    g.globalAlpha = 1; gg.globalAlpha = 1; this.lines.clear(); this.pts.clear();
  }
  // filled screen polygon (occluder or solid), flushes first to keep order
  fillScreen(path, color, alpha = 1, glow = 0, op = 'source-over') {
    this.flush(); const g = this.g, gg = this.gg;
    g.globalCompositeOperation = op; g.globalAlpha = alpha; g.fillStyle = color; g.fill(path, 'evenodd');
    gg.globalCompositeOperation = op; gg.globalAlpha = op === 'source-over' && !glow ? alpha : Math.min(1, alpha * glow); gg.fillStyle = color; gg.fill(path, 'evenodd');
    g.globalAlpha = 1; gg.globalAlpha = 1;
  }
  // Text placed in CAMERA space: o = {x,y,z, s (cap height in view units), rx,ry,rz}
  textPath(mesh, o, dz = 0, jitter = null) {
    const path = new Path2D(); const cx = Math.cos(o.rx || 0), sx = Math.sin(o.rx || 0), cy = Math.cos(o.ry || 0), sy = Math.sin(o.ry || 0), cz = Math.cos(o.rz || 0), sz = Math.sin(o.rz || 0);
    const s = o.s; let ok = true;
    for (let ci = 0; ci < mesh.contours.length; ci++) {
      const c = mesh.contours[ci];
      for (let i = 0; i < c.length; i++) {
        let x = c[i][0] * s + (o.lx || 0), y = c[i][1] * s + (o.ly || 0), z = dz;
        if (jitter) { const j = jitter(c[i], ci, i); x += j[0]; y += j[1]; z += j[2]; }
        let t = x * cz - y * sz; y = x * sz + y * cz; x = t;      // roll
        t = y * cx - z * sx; z = y * sx + z * cx; y = t;          // pitch
        t = x * cy + z * sy; z = -x * sy + z * cy; x = t;         // yaw
        const v = [x + o.x, y + o.y, z + o.z];
        if (v[2] < this.near) { ok = false; break; }
        const p = this.scr(v); if (i === 0) path.moveTo(p[0], p[1]); else path.lineTo(p[0], p[1]);
      }
      if (!ok) break; path.closePath();
    }
    return ok ? path : null;
  }
  // style: {fill, fillA, stroke, strokeW, strokeA, glow, echo, echoDz, echoColor}
  text(mesh, o, st) {
    this.flush(); const g = this.g, gg = this.gg, u = this.unit;
    const n = st.echo || 0;
    for (let k = n; k >= 0; k--) {
      const path = this.textPath(mesh, o, k * (st.echoDz || 0.25) * o.s, st.jitter); if (!path) continue;
      const front = k === 0; const ea = front ? 1 : (st.echoA ?? 0.5) * (1 - (k - 1) / n);
      if (front && st.fill) {
        for (const [ctx, m] of [[g, 1], [gg, st.glow ?? 0.6]]) { if (m <= 0) continue; ctx.globalCompositeOperation = st.op || 'source-over'; ctx.globalAlpha = clamp((st.fillA ?? 1) * (ctx === g ? 1 : m)); ctx.fillStyle = st.fill; ctx.fill(path, 'evenodd'); }
      }
      const sc = front ? st.stroke : (st.echoColor || st.stroke); if (!sc) continue;
      for (const [ctx, m] of [[g, 1], [gg, st.glow ?? 0.6]]) { if (m <= 0) continue; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((st.strokeA ?? 1) * ea * (ctx === g ? 1 : m)); ctx.strokeStyle = sc; ctx.lineJoin = 'round'; ctx.lineWidth = ctx === g ? (st.strokeW || 2) * u : Math.max(1.2, (st.strokeW || 2) * u * 0.8); ctx.stroke(path); }
    }
    g.globalAlpha = 1; gg.globalAlpha = 1; g.globalCompositeOperation = 'lighter'; gg.globalCompositeOperation = 'lighter';
  }
  // view-space units at depth z that span fraction `frac` of the screen width
  spanAt(z, frac) { return frac * this.W * z / this.f; }
  begin(bg, fb) {
    const g = this.g, W = this.W, H = this.H, gs = this.GS;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    if (bg) bg(g, W, H); else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    if (fb && fb.a > 0) { // zoom-trail feedback of the previous frame
      const z = fb.zoom || 1.02; g.globalAlpha = fb.a; g.globalCompositeOperation = fb.op || 'lighter';
      g.translate(W / 2 + (fb.dx || 0), H / 2 + (fb.dy || 0)); g.rotate(fb.rot || 0); g.scale(z, z); g.drawImage(this.prev, -W / 2, -H / 2); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    }
    this.gg.setTransform(1, 0, 0, 1, 0, 0); this.gg.globalCompositeOperation = 'source-over'; this.gg.fillStyle = '#000'; this.gg.fillRect(0, 0, W / gs, H / gs); this.gg.setTransform(1 / gs, 0, 0, 1 / gs, 0, 0);
  }
  // keep the pre-bloom world (without lyrics) for the zoom-trail feedback
  snapshot() { this.flush(); this.pg.globalCompositeOperation = 'copy'; this.pg.drawImage(this.c, 0, 0); this.pg.globalCompositeOperation = 'source-over'; this._snapped = true; }
  // post: o = {bloom, wide, flash, flashColor, scan, grain, vig, seed, fade}
  end(o = {}) {
    this.flush(); const g = this.g, W = this.W, H = this.H, gs = this.GS;
    if (!this._snapped) this.snapshot(); this._snapped = false;
    const bg = this.gbg; bg.globalCompositeOperation = 'copy'; bg.filter = `blur(${Math.round(3 * this.unit * 10) / 10 + 1}px)`; bg.drawImage(this.gc, 0, 0); bg.filter = 'none';
    const wg = this.gwg; wg.globalCompositeOperation = 'copy'; wg.filter = 'blur(3px)'; wg.drawImage(this.gc, 0, 0, W / 16, H / 16); wg.filter = 'none';
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'lighter'; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.globalAlpha = o.bloom ?? 0.9; g.drawImage(this.gb, 0, 0, W, H);
    g.globalAlpha = o.wide ?? 0.55; g.drawImage(this.gw, 0, 0, W, H);
    if (o.flash > 0.01) { g.globalAlpha = clamp(o.flash); g.fillStyle = o.flashColor || '#fff'; g.fillRect(0, 0, W, H); }
    if ((o.grain ?? 0.06) > 0) { g.globalAlpha = o.grain ?? 0.06; const ox = Math.floor(hash((o.seed || 0) * 3.1) * 512), oy = Math.floor(hash((o.seed || 0) * 7.7) * 512); for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) g.drawImage(this.noise, x, y); }
    g.globalCompositeOperation = 'source-over';
    if ((o.vig ?? 1) > 0) { g.globalAlpha = o.vig ?? 1; g.drawImage(this.vig, 0, 0); }
    if ((o.scan ?? 1) > 0) { g.globalAlpha = o.scan ?? 1; g.drawImage(this.scan, 0, 0); }
    if (o.fade > 0.003) { g.globalAlpha = clamp(o.fade); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    g.globalAlpha = 1;
  }
  // pixel post: chromatic aberration + glitch slices + tape collapse. returns Buffer RGBA
  pixels(o = {}) {
    const W = this.W, H = this.H; const src = this.c.data(); const ca = Math.round((o.ca || 0) * this.unit);
    const gl = o.glitch || 0, seed = o.seed || 0;
    if (!ca && gl <= 0 && !o.squash) return src;
    const out = this._out || (this._out = Buffer.alloc(W * H * 4)); const s32 = new Uint32Array(src.buffer, src.byteOffset, W * H), o32 = new Uint32Array(out.buffer, out.byteOffset, W * H);
    // row offsets for glitch
    const rowOff = this._ro || (this._ro = new Int32Array(H)); rowOff.fill(0);
    if (gl > 0) { const bands = 3 + Math.floor(hash(seed) * 6 * gl); for (let b = 0; b < bands; b++) { const y0 = Math.floor(hash(seed + b * 3.3) * H), h = Math.floor(8 + hash(seed + b * 5.1) * H * 0.09), dx = Math.round((hash(seed + b * 9.7) - 0.5) * W * 0.16 * gl); for (let y = y0; y < Math.min(H, y0 + h); y++) rowOff[y] = dx; } }
    const xmR = this._xr || (this._xr = new Int32Array(W)), xmB = this._xb || (this._xb = new Int32Array(W));
    for (let x = 0; x < W; x++) { const k = (x - W / 2) / (W / 2); const d = Math.round(ca * (0.35 + 0.65 * Math.abs(k)) * (k < 0 ? -1 : 1)); xmR[x] = d; xmB[x] = -d; }
    const sq = o.squash || 0; // 0..1 vertical CRT collapse
    for (let y = 0; y < H; y++) {
      let sy = y; if (sq > 0) { const k = 1 - sq; const yy = (y - H / 2) / Math.max(0.004, k) + H / 2; if (yy < 0 || yy >= H) { o32.fill(0xff000000, y * W, y * W + W); continue; } sy = yy | 0; }
      const ro = rowOff[y], base = sy * W, ob = y * W;
      for (let x = 0; x < W; x++) {
        let xg = x + ro; if (xg < 0) xg += W; else if (xg >= W) xg -= W;
        let xr = xg + xmR[x], xb = xg + xmB[x]; if (xr < 0) xr = 0; else if (xr >= W) xr = W - 1; if (xb < 0) xb = 0; else if (xb >= W) xb = W - 1;
        o32[ob + x] = (s32[base + xr] & 0x000000ff) | (s32[base + xg] & 0x0000ff00) | (s32[base + xb] & 0x00ff0000) | 0xff000000;
      }
    }
    return out;
  }
}
