// Renders frames of the music video. See AGENTS.md.
// node render.mjs --w 1920 --h 1080 --from 0 --to 30 --out part.mp4      (video chunk)
// node render.mjs --stills 12.5,31.2 --outdir stills                     (jpg stills)
import { spawn } from 'child_process';
import fs from 'fs';
import { createCanvas } from '@napi-rs/canvas';
import { Renderer } from './engine.mjs';
import { drawFrame, FPS, NF } from './scenes.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), PRE = 14;
const R = new Renderer(W, H);
const runTo = (f) => { let buf; for (let k = Math.max(0, f - PRE); k <= f; k++) buf = drawFrame(R, k / FPS); return buf; };
if (arg('stills')) {
  const dir = arg('outdir', 'stills'); fs.mkdirSync(dir, { recursive: true });
  for (const s of arg('stills').split(',')) { const t0 = Date.now(); const buf = runTo(Math.round(+s * FPS)); const cc = createCanvas(W, H); const id = cc.getContext('2d').createImageData(W, H); id.data.set(buf); cc.getContext('2d').putImageData(id, 0, 0); const jpg = cc.toBuffer('image/jpeg', 88); fs.writeFileSync(`${dir}/${arg('prefix', 's')}_${(+s).toFixed(2).padStart(6, '0')}.jpg`, jpg); console.log(s, 'ms/frame', Math.round((Date.now() - t0) / (PRE + 1))); }
  process.exit(0);
}
const f0 = Math.round(+arg('from', 0) * FPS), f1 = Math.min(NF, Math.round(+arg('to', NF / FPS) * FPS)), out = arg('out', 'out.mp4'), tmp = out.replace(/\.mp4$/, '.part.mp4');
const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', arg('preset', 'veryfast'), '-crf', arg('crf', '17'), '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res) => ff.on('close', res));
for (let k = Math.max(0, f0 - PRE); k < f0; k++) drawFrame(R, k / FPS);
const t0 = Date.now();
for (let f = f0; f < f1; f++) { const buf = drawFrame(R, f / FPS); if (!ff.stdin.write(Buffer.from(buf))) await new Promise(r => ff.stdin.once('drain', r)); if ((f - f0) % 150 === 0) console.log(out, f - f0, '/', f1 - f0, ((Date.now() - t0) / (f - f0 + 1)).toFixed(0), 'ms/f'); }
ff.stdin.end(); const code = await done; if (code === 0) { fs.renameSync(tmp, out); console.log('done', out); } else { console.error('ffmpeg failed', code); process.exit(1); }
