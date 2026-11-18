#!/usr/bin/env bash
# Step 6 — render the whole video in parallel chunks, join them, add the song.
#
# usage: tools/render_all.sh [W] [H] [OUTDIR] [JOBS] [CHUNK_SECONDS]
#   tools/render_all.sh                      # 1920x1080 -> out/1920x1080/final.mp4
#   tools/render_all.sh 1080 1920            # vertical 9:16
#   tools/render_all.sh 1920 1080 out/hd 4   # 4 parallel jobs
#
# Chunks that already exist are skipped, so after changing one scene you can
# delete only the affected out/<size>/pNN.mp4 files and run this again.
set -euo pipefail
cd "$(dirname "$0")/.."
W=${1:-1920}; H=${2:-1080}; DIR=${3:-out/${W}x${H}}; JOBS=${4:-2}; CHUNK=${5:-28}
mkdir -p "$DIR"
TOTAL=$(node --input-type=module -e "import { NF, FPS } from './scenes.mjs'; console.log(NF / FPS)")
N=$(python3 -c "import math; print(math.ceil($TOTAL / $CHUNK))")
echo "rendering ${TOTAL}s at ${W}x${H} in $N chunks, $JOBS at a time"

render_chunk() {
  local i=$1 a b f
  a=$(python3 -c "print($i * $CHUNK)"); b=$(python3 -c "print(min($TOTAL, ($i + 1) * $CHUNK))")
  f=$(printf "%s/p%02d.mp4" "$DIR" "$i")
  [ -f "$f" ] && return 0
  node render.mjs --w "$W" --h "$H" --from "$a" --to "$b" --out "$f" > "$DIR/log$i.txt" 2>&1
}
export -f render_chunk; export W H DIR CHUNK TOTAL
seq 0 $((N - 1)) | xargs -P "$JOBS" -I{} bash -c 'render_chunk {}'

: > "$DIR/list.txt"
for i in $(seq 0 $((N - 1))); do printf "file 'p%02d.mp4'\n" "$i" >> "$DIR/list.txt"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$DIR/list.txt" -c copy "$DIR/video.mp4"
ffmpeg -loglevel error -y -i "$DIR/video.mp4" -i data/song.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart "$DIR/final.part.mp4"
mv "$DIR/final.part.mp4" "$DIR/final.mp4"

# smaller copy for upload / sharing (~10 Mbps)
ffmpeg -loglevel error -y -i "$DIR/final.mp4" -c:v libx264 -preset faster -crf 22 \
  -maxrate 10M -bufsize 20M -pix_fmt yuv420p -c:a copy -movflags +faststart "$DIR/share.part.mp4"
mv "$DIR/share.part.mp4" "$DIR/share.mp4"
echo "done: $DIR/final.mp4 (master)  $DIR/share.mp4 (upload copy)"
