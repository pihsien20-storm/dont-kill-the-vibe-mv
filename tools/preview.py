"""Step 2c — build data/preview.html to check lyrics.json against the song by ear.

Usage:  python tools/preview.py   then double-click data/preview.html
Space = play/pause, arrows = seek / jump line, M = mark a wrong line.
Lyrics and beats are embedded in the page, so re-run this after editing
data/lyrics.json. The page plays data/song.wav from the same folder."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data"
lyrics = json.loads((ROOT / "lyrics.json").read_text(encoding="utf-8"))
beats = json.loads((ROOT / "beats.json").read_text(encoding="utf-8"))["beats"]

HTML = r"""<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>歌词时间轴预览</title>
<style>
  :root { --bg:#0b0b12; --panel:#14141f; --line:#26263a; --text:#e8e8f2; --dim:#7c7c96;
          --magenta:#ff3d9a; --cyan:#35e0ff; --warn:#ffb020; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:20px 16px 40px; }
  .stage { background:var(--panel); border:1px solid var(--line); border-radius:12px;
           padding:20px; position:sticky; top:0; z-index:2; }
  .meta { display:flex; align-items:center; gap:12px; color:var(--dim); font-size:14px; }
  #beat { width:14px; height:14px; border-radius:50%; background:var(--cyan); opacity:.15; }
  #section { color:var(--cyan); font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
  #clock { margin-left:auto; font-variant-numeric:tabular-nums; font-size:20px; color:var(--text); }
  #est { color:var(--warn); display:none; }
  #line { min-height:120px; display:flex; flex-wrap:wrap; align-items:center; justify-content:center;
          gap:.3em; font-size:40px; font-weight:700; text-align:center; padding:16px 0; }
  #line span { color:#3d3d55; transition:color .05s; }
  #line span.sung { color:var(--text); }
  #line span.now { color:var(--magenta); text-shadow:0 0 18px var(--magenta); }
  #line.idle { color:var(--dim); font-size:18px; font-weight:400; }
  audio { width:100%; margin-top:4px; }
  .controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px;
              color:var(--dim); font-size:13px; }
  button { background:#1e1e2e; color:var(--text); border:1px solid var(--line); border-radius:6px;
           padding:5px 10px; cursor:pointer; font:inherit; }
  button:hover, button.on { border-color:var(--cyan); color:var(--cyan); }
  table { width:100%; border-collapse:collapse; margin-top:18px; font-size:15px; }
  th { text-align:left; color:var(--dim); font-weight:500; padding:6px 8px;
       border-bottom:1px solid var(--line); }
  td { padding:7px 8px; border-bottom:1px solid var(--line); }
  td.t { font-variant-numeric:tabular-nums; color:var(--dim); white-space:nowrap; }
  td.s { color:var(--cyan); white-space:nowrap; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:#181826; }
  tr.active { background:#231428; }
  tr.active td.x { color:var(--magenta); font-weight:600; }
  tr.bad td.x::after { content:" ⚑ 有问题"; color:var(--warn); font-size:12px; }
  #notes { width:100%; margin-top:14px; min-height:70px; background:var(--panel); color:var(--text);
           border:1px solid var(--line); border-radius:8px; padding:10px; font:13px Consolas,monospace; }
  .hint { color:var(--dim); font-size:13px; margin-top:6px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="stage">
    <div class="meta">
      <div id="beat" title="节拍 (beats.json)"></div>
      <span id="section">—</span><span id="est">估算</span>
      <span id="clock">0.00</span>
    </div>
    <div id="line" class="idle">按空格开始播放</div>
    <audio id="audio" src="song.wav" controls preload="auto"></audio>
    <div class="controls">
      <span>速度</span>
      <button data-rate="0.5">0.5×</button><button data-rate="0.75">0.75×</button>
      <button data-rate="1" class="on">1×</button>
      <span style="margin-left:12px">空格 播放/暂停 · ←/→ 退/进 2 秒 · ↑/↓ 上一句/下一句 · M 标记当前句有问题</span>
    </div>
  </div>

  <table>
    <thead><tr><th>#</th><th>段落</th><th>开始</th><th>结束</th><th>歌词（点击跳到该句前 1 秒）</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <textarea id="notes" readonly placeholder="按 M 标记的句子会列在这里，确认完把这段文字复制给我。"></textarea>
  <div class="hint">标记只保存在这个页面里，刷新后会清空。</div>
</div>

<script>
const LYRICS = __LYRICS__;
const BEATS = __BEATS__;
const audio = document.getElementById('audio');
const lineEl = document.getElementById('line');
const sectionEl = document.getElementById('section');
const estEl = document.getElementById('est');
const clockEl = document.getElementById('clock');
const beatEl = document.getElementById('beat');
const rowsEl = document.getElementById('rows');
const notesEl = document.getElementById('notes');
const HOLD = 1.2;            // keep a line on screen this long after it ends
const bad = new Set();
let shown = -2, activeRow = -1;

LYRICS.forEach((l, i) => {
  const tr = document.createElement('tr');
  tr.className = 'row';
  tr.innerHTML = `<td class="t">${i + 1}</td><td class="s"></td><td class="t">${l.start.toFixed(2)}</td>` +
                 `<td class="t">${l.end.toFixed(2)}</td><td class="x"></td>`;
  tr.children[1].textContent = l.section + (l.estimated ? ' (估算)' : '');
  tr.children[4].textContent = l.text;
  tr.onclick = () => seekLine(i);
  rowsEl.appendChild(tr);
});

function seekLine(i) {
  i = Math.max(0, Math.min(LYRICS.length - 1, i));
  audio.currentTime = Math.max(0, LYRICS[i].start - 1);
  audio.play();
}

// Index of the line to display at time t, or -1.
function lineAt(t) {
  for (let i = LYRICS.length - 1; i >= 0; i--) {
    if (t >= LYRICS[i].start) return t <= LYRICS[i].end + HOLD ? i : -1;
  }
  return -1;
}
// Last line that has started (for ↑/↓ and M), or -1.
function lastStarted(t) {
  let k = -1;
  LYRICS.forEach((l, i) => { if (t >= l.start) k = i; });
  return k;
}

function render() {
  const t = audio.currentTime;
  clockEl.textContent = t.toFixed(2);

  let b = -1;
  for (let i = 0; i < BEATS.length && BEATS[i] <= t; i++) b = i;
  const pulse = b < 0 ? 0 : Math.exp(-(t - BEATS[b]) * 9);
  beatEl.style.opacity = 0.15 + 0.85 * pulse;
  beatEl.style.transform = `scale(${1 + 0.5 * pulse})`;

  const i = lineAt(t);
  if (i !== shown) {
    shown = i;
    lineEl.innerHTML = '';
    if (i < 0) {
      lineEl.className = 'idle';
      lineEl.textContent = '♪';
      sectionEl.textContent = '—';
      estEl.style.display = 'none';
    } else {
      lineEl.className = '';
      LYRICS[i].words.forEach(w => {
        const s = document.createElement('span');
        s.textContent = w.w;
        lineEl.appendChild(s);
      });
      sectionEl.textContent = LYRICS[i].section;
      estEl.style.display = LYRICS[i].estimated ? '' : 'none';
    }
    if (i !== activeRow) {
      if (activeRow >= 0) rowsEl.children[activeRow].classList.remove('active');
      activeRow = i;
      if (i >= 0) {
        rowsEl.children[i].classList.add('active');
        rowsEl.children[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
  if (i >= 0) {
    LYRICS[i].words.forEach((w, k) => {
      const s = lineEl.children[k];
      s.className = t >= w.start && t < w.end ? 'now' : (t >= w.start ? 'sung' : '');
    });
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

function toggleBad() {
  const i = lastStarted(audio.currentTime);
  if (i < 0) return;
  bad.has(i) ? bad.delete(i) : bad.add(i);
  rowsEl.children[i].classList.toggle('bad', bad.has(i));
  notesEl.value = [...bad].sort((a, b) => a - b)
    .map(k => `#${k + 1} [${LYRICS[k].section}] ${LYRICS[k].start.toFixed(2)}s  ${LYRICS[k].text}`)
    .join('\n');
}

document.querySelectorAll('button[data-rate]').forEach(btn => {
  btn.onclick = () => {
    audio.playbackRate = parseFloat(btn.dataset.rate);
    document.querySelectorAll('button[data-rate]').forEach(x => x.classList.toggle('on', x === btn));
  };
});

document.addEventListener('keydown', e => {
  if (e.target === notesEl) return;
  const k = e.key;
  if (k === ' ') { audio.paused ? audio.play() : audio.pause(); }
  else if (k === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 2);
  else if (k === 'ArrowRight') audio.currentTime += 2;
  else if (k === 'ArrowUp') seekLine(lastStarted(audio.currentTime) - 1);
  else if (k === 'ArrowDown') seekLine(lastStarted(audio.currentTime) + 1);
  else if (k === 'm' || k === 'M') toggleBad();
  else return;
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
</script>
</body>
</html>
"""

html = (HTML.replace("__LYRICS__", json.dumps(lyrics, ensure_ascii=False))
            .replace("__BEATS__", json.dumps(beats)))
(ROOT / "preview.html").write_text(html, encoding="utf-8")
print(f"data/preview.html written: {len(lyrics)} lines, {len(beats)} beats")
