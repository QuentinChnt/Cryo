#!/usr/bin/env bash
# Turns the Playwright .webm capture into a widely playable .mp4.
#
# The raw file also contains the page load that happens before the scenario
# starts; record-demo.js writes that lead-in to out/capture.json and it is
# trimmed off here so the clip opens on the freezer map.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=out/cryomap-demo.webm
DST=out/cryomap-demo.mp4
[ -f "$SRC" ] || { echo "missing $SRC — run record-demo.js first" >&2; exit 1; }

LEAD=$(node -e 'try{console.log(require("./out/capture.json").leadIn)}catch(e){console.log(0)}')
DUR=$(node -e 'try{console.log(require("./out/capture.json").duration)}catch(e){console.log(30)}')

echo "trim ${LEAD}s, keep ${DUR}s"

# -ss after -i so the seek is frame-accurate on this VP8 stream; the constant
# frame rate and yuv420p pixel format keep the result playable everywhere
# (QuickTime included), and +faststart puts the index up front for the web.
ffmpeg -y -v warning -stats \
  -i "$SRC" \
  -ss "$LEAD" -t "$DUR" \
  -vf "fps=30,scale=1280:800:flags=lanczos,format=yuv420p" \
  -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 20 \
  -movflags +faststart -an \
  "$DST"

echo
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,r_frame_rate,codec_name -of default=noprint_wrappers=1 "$DST"
echo "-> $(cd "$(dirname "$DST")" && pwd)/$(basename "$DST")"
