#!/bin/bash
# usage: sheet.sh out.jpg cols file...
out=$1; cols=$2; shift 2; n=$#; rows=$(( (n+cols-1)/cols ))
args=(); for f in "$@"; do args+=(-i "$f"); done
ffmpeg -loglevel error -y "${args[@]}" -filter_complex "$(for i in $(seq 0 $((n-1))); do echo -n "[$i:v]scale=${SW:-960}:-1[v$i];"; done)$(for i in $(seq 0 $((n-1))); do echo -n "[v$i]"; done)xstack=inputs=$n:layout=$(for i in $(seq 0 $((n-1))); do c=$((i%cols)); r=$((i/cols)); x=$([ $c -eq 0 ] && echo 0 || (for k in $(seq 1 $c); do echo -n "w0+"; done | sed 's/+$//')); y=$([ $r -eq 0 ] && echo 0 || (for k in $(seq 1 $r); do echo -n "h0+"; done | sed 's/+$//')); echo -n "${x}_${y}|"; done | sed 's/|$//')" -frames:v 1 -q:v 3 "$out"
