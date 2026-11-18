"""Step 2b — align your canonical lyrics to whisper's word timings.

Usage:  python tools/align_lyrics.py
Input:  data/lyrics.txt       canonical lyrics, one sung line per row,
                              section headers like [Chorus] on their own row,
                              repeat a line as many times as it is actually sung
        data/lyrics_raw.json  from tools/transcribe.py
Output: data/lyrics.json      [{section,text,start,end,estimated,words[{w,start,end}]}]

Text always comes from lyrics.txt; only the timings come from whisper.
Words whisper missed are interpolated between their neighbours and the line
is flagged "estimated": true, as is any line squeezed into < 0.2 s per word
(a sign whisper matched it to the wrong place). Check flagged lines by ear
(tools/preview.py) and re-transcribe just that stretch:
    python tools/transcribe.py --from 150 --to 165
then copy the times into data/lyrics.json by hand.
"""
import difflib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
raw = json.loads((ROOT / "data" / "lyrics_raw.json").read_text(encoding="utf-8"))["words"]

norm = lambda s: re.sub(r"[^a-z0-9']", "", s.lower().replace("’", "'"))

# ---- canonical lyrics -> flat token list ----
lines, section = [], "Verse"
for row in (ROOT / "data" / "lyrics.txt").read_text(encoding="utf-8").splitlines():
    row = row.strip()
    if not row or row.startswith("("):
        continue
    m = re.match(r"^\[(.+?)\]$", row)
    if m:
        section = m.group(1)
        continue
    toks = [t for t in row.split() if norm(t)]
    lines.append({"section": section, "text": row, "toks": toks})

canon = [(li, t) for li, l in enumerate(lines) for t in l["toks"]]
A = [norm(t) for _, t in canon]
B = [norm(w["w"]) for w in raw]

# ---- sequence alignment ----
# equal   -> take whisper's timing
# replace -> whisper misheard the word(s) (e.g. "vibe" -> "fire"): keep the timing,
#            spreading it evenly if the word counts differ
# delete  -> whisper did not hear it at all: guessed below, line flagged "estimated"
timing = [None] * len(canon)
for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes():
    if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
        for k in range(i2 - i1):
            w = raw[j1 + k]
            timing[i1 + k] = (w["start"], w["end"])
    elif op == "replace":
        s0, s1 = raw[j1]["start"], raw[j2 - 1]["end"]
        step = (s1 - s0) / (i2 - i1)
        for k in range(i2 - i1):
            timing[i1 + k] = (s0 + step * k, s0 + step * (k + 1))

# ---- guess the words whisper missed ----
# A run that starts a line is placed just before the next heard word,
# otherwise just after the previous heard word, ~0.35 s per word.
WORD = 0.35
line_start = {sum(len(l["toks"]) for l in lines[:li]) for li in range(len(lines))}
est = [t is None for t in timing]
i = 0
while i < len(timing):
    if timing[i] is not None:
        i += 1
        continue
    j = i
    while j < len(timing) and timing[j] is None:
        j += 1
    n = j - i
    prev_end = timing[i - 1][1] if i > 0 else None
    next_start = timing[j][0] if j < len(timing) else None
    if prev_end is not None and next_start is not None:
        dur = min(WORD, (next_start - prev_end) / n)
    else:
        dur = WORD
    if next_start is not None and (i in line_start or prev_end is None):
        t0 = next_start - dur * n - (0.2 if i in line_start else 0)
    else:
        t0 = prev_end
    for k in range(n):
        timing[i + k] = (round(t0 + dur * k, 3), round(t0 + dur * (k + 1), 3))
    i = j

# ---- whisper stretches the first word after a pause back into silence ----
MAX_LEAD = 0.6
for k in range(len(timing)):
    s, e = timing[k]
    gap = s - timing[k - 1][1] if k else 9
    if gap > 0.3 and e - s > 0.75:
        timing[k] = (e - MAX_LEAD, e)

out, k = [], 0
for li, l in enumerate(lines):
    words = []
    for t in l["toks"]:
        s, e = timing[k]
        words.append({"w": t, "start": round(s, 2), "end": round(e, 2)})
        k += 1
    n_est = sum(est[k - len(l["toks"]):k])
    squashed = (words[-1]["end"] - words[0]["start"]) / len(words) < 0.2  # whisper latched onto the wrong spot
    out.append({"section": l["section"], "text": l["text"], "start": words[0]["start"],
                "end": words[-1]["end"], "estimated": bool(n_est or squashed), "words": words})

(ROOT / "data" / "lyrics.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
for l in out:
    flag = "  <- ESTIMATED, check by ear" if l["estimated"] else ""
    print(f"{l['section']:13} {l['start']:7.2f}-{l['end']:7.2f}  {l['text']}{flag}")
