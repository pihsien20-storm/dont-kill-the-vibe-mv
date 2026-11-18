"""Step 3b — per-frame audio features that drive the visuals, plus a section map.

Usage:  python tools/energy.py [data/song.wav] [--fps 30]
Output: data/energy.json  one value per video frame for each key:
          low  (30-140 Hz, kick/bass)      mid  (200-2500 Hz, vocal/guitar)
          high (4-14 kHz, hats/air)        rms  (overall loudness)
          loud (rms smoothed over 1 s)     kick/hat/on (onset strength per band)
          spec (24 log-spaced bands, for spectrum rings / building heights)
        All values are normalised so the 99.5th percentile = 1.0 (clipped at 1.5).
Prints: a 2-second loudness map and the quiet gaps — use it to set the
        section times (T) in scenes.mjs.
"""
import argparse
import json
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("audio", nargs="?", default=str(ROOT / "data" / "song.wav"))
ap.add_argument("--fps", type=int, default=30)
a = ap.parse_args()

y, sr = librosa.load(a.audio, sr=44100)
FPS = a.fps
hop = sr // FPS
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
f = librosa.fft_frequencies(sr=sr, n_fft=2048)


def band(lo, hi):
    return S[(f >= lo) & (f < hi)].sum(0)


def norm(x):
    x = np.nan_to_num(x / max(np.percentile(x, 99.5), 1e-9))
    return np.clip(x, 0, 1.5)


def flux(b):
    return norm(np.maximum(0, np.diff(np.log1p(b * 20), prepend=0)))


low, mid, high = norm(band(30, 140)), norm(band(200, 2500)), norm(band(4000, 14000))
rms = norm(librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0])
loud = np.convolve(rms, np.ones(FPS) / FPS, "same")
edges = np.geomspace(40, 14000, 25)
spec = np.array([norm(band(edges[i], edges[i + 1])) for i in range(24)])

r = lambda x: np.round(x, 3).tolist()
json.dump({"fps": FPS, "low": r(low), "mid": r(mid), "high": r(high), "rms": r(rms), "loud": r(loud),
           "kick": r(flux(band(30, 140))), "hat": r(flux(band(6000, 14000))), "on": r(flux(band(200, 5000))),
           "spec": np.round(spec.T, 2).tolist()},
          open(ROOT / "data" / "energy.json", "w"))

n = len(rms)
print(f"{n} frames = {n / FPS:.1f}s @ {FPS}fps\n\n  t   loud  low   (2-second map)")
for s in range(0, int(n / FPS), 2):
    sl = slice(s * FPS, (s + 2) * FPS)
    print(f"{s:4d}  {rms[sl].mean():.2f}  {low[sl].mean():.2f}  " + "#" * int(rms[sl].mean() * 30))
print("\nquiet gaps (good cut points):")
q, st = rms < 0.06, None
for i in range(n):
    if q[i] and st is None:
        st = i
    if not q[i] and st is not None:
        if i - st >= 5:
            print(f"  {st / FPS:7.2f} - {i / FPS:7.2f}")
        st = None
