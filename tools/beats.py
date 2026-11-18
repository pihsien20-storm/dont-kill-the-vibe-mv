"""Step 3a — beat grid.

Usage:  python tools/beats.py [data/song.wav]
Output: data/beats.json  {bpm, beats[seconds]}
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
src = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "data" / "song.wav")
y, sr = librosa.load(src, sr=22050, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
bpm = float(np.atleast_1d(tempo)[0])
json.dump({"bpm": bpm, "beats": [round(float(b), 3) for b in beats]},
          open(ROOT / "data" / "beats.json", "w"))
print(f"{bpm:.2f} BPM, {len(beats)} beats, first at {beats[0]:.2f}s")
