"""Step 2a — word-level timestamps of the sung vocal with faster-whisper.

Usage:  python tools/transcribe.py [data/song.wav] [--model large-v3-turbo] [--lang en|zh]
        python tools/transcribe.py --from 150 --to 165   # re-check one stretch
Output: data/lyrics_raw.json  {duration, segments[], words[{w,start,end,prob}]}
        (with --from/--to: printed only, nothing is overwritten)

Whisper often skips shouted hooks over loud music, or puts a repeated line in
the wrong place. Re-transcribing a 10-20 s window around the gap usually finds it.

Runs on CPU (int8). The default model is large-v3-turbo: free and open source,
~1.6 GB downloaded once on first run into ./.models (keep the repo on D: so it
stays off C:), and about 2-3 GB of RAM while running. It is much more accurate
than "small" on sung and Chinese vocals. On a very tight machine, use --model small.
"""
import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("HF_HOME", str(ROOT / ".models"))

from faster_whisper import WhisperModel  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("audio", nargs="?", default=str(ROOT / "data" / "song.wav"))
ap.add_argument("--model", default="large-v3-turbo")
ap.add_argument("--lang", default="en")
ap.add_argument("--from", dest="t0", type=float)
ap.add_argument("--to", dest="t1", type=float)
a = ap.parse_args()
window = a.t0 is not None and a.t1 is not None

model = WhisperModel(a.model, device="cpu", compute_type="int8")
segments, info = model.transcribe(
    a.audio,
    language=a.lang,
    word_timestamps=True,
    vad_filter=False,               # VAD tends to drop shouted hooks over loud music
    condition_on_previous_text=False,  # stops repeated choruses from collapsing
    **({"clip_timestamps": [a.t0, a.t1]} if window else {}),
)

out = {"duration": info.duration, "segments": [], "words": []}
for seg in segments:
    words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
              "prob": round(w.probability, 3)} for w in (seg.words or [])]
    out["segments"].append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                            "text": seg.text.strip(), "words": words})
    out["words"].extend(words)
    print(f"[{seg.start:7.2f} -> {seg.end:7.2f}] {seg.text.strip()}", flush=True)
    if window:
        print("   " + "  ".join(f"{w['w']}@{w['start']:.2f}-{w['end']:.2f}" for w in words))

if window:
    raise SystemExit(0)

dst = ROOT / "data" / "lyrics_raw.json"
dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(out['words'])} words, {info.duration:.1f}s -> {dst}")
