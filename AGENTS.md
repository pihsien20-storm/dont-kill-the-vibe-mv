# AGENTS.md — guide for AI coding assistants

> 中文说明：这份文件是写给 AI 助手看的（Claude Code、Codex、Cursor 等）。把它和你的需求一起交给 AI，它就知道这个项目怎么运作、该改哪里。人类读者请看 README.md。

This repo renders a full 3D neon music video **from code only**: no game engine, no WebGL, no GPU, no video editor. Node draws every frame on a Skia canvas, pipes raw RGBA frames into FFmpeg, and the song is muxed in at the end. Everything on screen is a pure function of time `t` plus audio-analysis data, so any frame can be rendered on its own and any time range can be re-rendered without touching the rest.

## Pipeline

```
data/song.wav
  ├─ tools/transcribe.py  ─► data/lyrics_raw.json   (faster-whisper word timestamps)
  │    + data/lyrics.txt  ─► tools/align_lyrics.py ─► data/lyrics.json
  │                                    └─ tools/preview.py ─► data/preview.html (human checks by ear)
  ├─ tools/beats.py       ─► data/beats.json        ({bpm, beats[]})
  └─ tools/energy.py      ─► data/energy.json       (per-frame bands + 24-band spectrum)
                                   │
scenes.mjs (reads the three JSON files at import) ──► drawFrame(R, t)
engine.mjs (Renderer) ◄────────────────────────────────┘
render.mjs  ─► --stills t1,t2 → JPGs      |  --from a --to b → MP4 chunk
tools/render_all.sh ─► chunks in parallel → concat (-c copy) → + song.wav → final.mp4 + share.mp4
```

Commands: `npm install`, `pip install -r requirements.txt`, then the order shown in README.md. Needs Node ≥ 18, Python ≥ 3.10 and `ffmpeg` on PATH.

## Data formats

- `lyrics.json`: `[{section, text, start, end, estimated, words:[{w, start, end}]}]`, times in seconds. `section` picks the lyric animation (see `MODE` below). The last line is always drawn in the special `final` mode.
- `beats.json`: `{bpm, beats:[seconds]}`.
- `energy.json`: `{fps, low, mid, high, rms, loud, kick, hat, on, spec}`. Each array has one value per video frame at `fps`; `spec` is `[frame][24]`. Values are normalised so the 99.5th percentile is 1.0, clipped at 1.5.

## engine.mjs — `Renderer`

A small vector 3D renderer. World axes: x right, y up, z forward (the camera usually flies along +z).

- `setCam({pos, yaw, pitch, roll, fov, sx, sy})` / `lookAt(pos, target, extra)`. `sx`/`sy` are screen-space shake offsets in pixels.
- `line(a, b, color, width, alpha, fog)`, `poly(points, …)`, `point(p, color, size, alpha, fog)`: world-space primitives. They are clipped at the near plane, faded with distance (`R.far`), batched by colour/width/alpha, and drawn on `flush()`.
- `line2` / `point2`: screen-space versions.
- `fillScreen(path, color, alpha, glow, op)`: filled `Path2D`, used as an occluder (building walls) or a solid light. It flushes the batches first, so draw order is preserved.
- `textMesh(font, str, tracking)` (exported function): outlines a font with opentype.js into contours, centred, cap height = 1 unit, cached. Fonts: `anton`, `chakra`, `chakraL`, `sync`, `shoulders` (Fontsource packages).
- `text(mesh, o, style)`: draws a text mesh in **camera space**. `o = {x, y, z, s, rx, ry, rz, lx, ly}`, where `s` is the cap height in view units. `style = {fill, fillA, stroke, strokeW, strokeA, glow, echo, echoDz, echoColor, echoA, jitter}`; `echo` stacks extruded copies behind the text to fake 3D depth.
- `spanAt(z, frac)`: view-space width that covers `frac` of the screen at depth `z`. Use it to size text to the screen.
- Frame lifecycle: `begin(bgFn, feedback)` → draw → `snapshot()` (stores the pre-lyrics frame for the zoom-trail feedback) → draw lyrics/HUD → `end({bloom, wide, flash, grain, fade, seed})` → `pixels({ca, glitch, squash, seed})`, which returns an RGBA Buffer.
  - Glow is a 4× downsampled copy of everything drawn, blurred and added back (`bloom`), plus a 16× copy (`wide`).
  - `ca` = chromatic aberration in px; `glitch` = horizontal slice displacement (0–1); `squash` = CRT vertical collapse (0–1).
- Deterministic randomness only: `hash(n)`, `hash2(a, b)`, `noise1(x)`. Never use `Math.random()`: chunks are rendered in separate processes and must agree frame for frame.
- `stroke widths` are multiplied by `R.unit` (= min(W, H) / 1080), so the same scene works at any resolution and in portrait.

## scenes.mjs — what is song-specific

| Symbol | Purpose | Change when you swap the song? |
|---|---|---|
| `T` | Section start times in seconds (`hit, build, drop1, …, end, total`). `total` sets the video length (`NF` frames). | **Yes**. Read the loudness map and quiet gaps printed by `tools/energy.py`, and the section starts in `lyrics.json`. |
| `SP` | `[time, speed]` keyframes for camera travel speed. Integrated into `DIST`, so speed changes never jump the camera. | **Yes**. Fast in drops, near 0 in breakdowns. |
| `pick(R, t)` | Maps each time range to a scene function and its options. It also contains a few literal times (e.g. `43.85`, `53.6`, `143.45`). | **Yes**. |
| Literal times inside scene functions | e.g. `scBuild` riser `28.3–30.42`, `scBreak` `161.8`, `scBridge` `184 / 189.6–191.5`, `scWarp` `62.7–64.75` / `80.9–82.5`, `drawLyrics` grow shake `119–124.2`. | **Yes**. Search for numbers > 10 in `scenes.mjs`. |
| `MODE` | lyric `section` → animation: `shout` (one huge word at a time, previous word shatters into particles), `neon` (word-by-word tube light-up, two rows), `grow` (rows that scale up and shake into the drop), `slam` (pop-in 3D block letters), `float` (slow, orbiting). | Only if your section names differ. |
| `C` | Palette. | Optional. |
| `hud()`, `scIntro()`, `scOutro()`, `scCredits()` | Title, artist name, the "144 BPM" label. | **Yes** (text). |

Audio helpers used everywhere: `A(key, t)` reads `energy.json`, `spec(t, band)` reads the spectrum, `bp(t)` is a beat pulse (decays after each beat, gated by low-end energy so quiet parts do not pulse), `beatInfo(t)` / `barOf(t)` give beat and bar phase, and `dist(t)` is the camera travel distance.

Scene building blocks: `grid`, `globe`, `stars`, `city` (procedural buildings with occluding walls, lit windows, signs and antennas; heights follow the spectrum), `tunnel`, `rays`, `specRing`, and `sculpture` (1500 particles morphing between shapes and words on a beat schedule; shapes: `sphere, cube, octa, icosa, knot, helix, saturn, wave`, or any uppercase string, which becomes a text outline).

A scene function returns post-processing settings: `{ca, glitch, flash, fade, bloom, wide, grain, label, hudA, lyr:{a, b, txt}, noLyr, squash}`. `drawFrame` draws the lyrics on top with an un-rolled camera, so lyrics stay level while the world rolls.

## How to work on this repo (rules that matter)

1. **Every frame must be a pure function of `t`.** The only state carried between frames is the zoom-trail feedback buffer, and `render.mjs` pre-rolls 14 frames before any start time so chunk edges match. Do not add other state that depends on previous frames.
2. **Check with stills before any full render.** `node render.mjs --stills 12.5,48,127.3 --outdir stills`, then `tools/sheet.sh sheet.jpg 3 stills/*.jpg` to look at many at once. Pick the busiest moments: chorus words, drops, transitions, the last line. A full render costs about 12 minutes on 8 cores, or much longer on a laptop.
3. **Re-render only what changed.** Delete `out/<WxH>/pNN.mp4` for the affected 28 s chunks and rerun `tools/render_all.sh`; it skips chunks that already exist.
4. **Check portrait too.** Lyric layout has separate portrait rules in `lay()` (more rows, larger fraction of the width). Render a few stills at `--w 1080 --h 1920`.
5. **Lyric timing problems belong in `data/lyrics.json`, not in the scene code.** Whisper commonly drops shouted hooks over loud music and misplaces repeated lines; `align_lyrics.py` flags those lines as `estimated`. Re-transcribe a window (`tools/transcribe.py --from A --to B`) and fix the times by hand.
6. **Performance:** about 100–250 ms per 1080p frame on one core. Path batching matters, so do not stroke per segment. Thousands of points are fine; tens of thousands are not. Keep `R.far` as small as the shot allows.
7. **Delivery:** `final.mp4` is a high-bitrate master (around 50 Mbps, 1.4 GB for 3:42). Upload `share.mp4` (about 10 Mbps).

## Adapting to a new song — checklist

1. Put the song at `data/song.wav` and the lyrics in `data/lyrics.txt`.
2. Run `transcribe.py` → `align_lyrics.py` → `preview.py`, and have a human confirm the timing.
3. Run `beats.py` and `energy.py`; read the loudness map and quiet gaps.
4. Rewrite `T`, `SP`, `pick()` and the literal times in the scene functions to match the new structure. Map high-energy sections to `scCity` / `scWarp` / `scChorus` / `scTunnel`, quiet ones to `scBreak` / `scBridge`, and the last sung line to `scLast`.
5. Change the title, artist name and BPM text.
6. Render stills at every section boundary, in landscape and portrait, and fix them.
7. Run `tools/render_all.sh`.
