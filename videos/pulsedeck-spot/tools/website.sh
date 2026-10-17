#!/usr/bin/env bash
# Website-Fassung des Spots für den Video-Platz auf der Startseite (website/src/pages/index.astro):
#   Video   website/public/video/pulsedeck-in-60-sekunden.mp4 (H.264, Faststart, Ton direkt aus audio/mix.wav)
#   Poster  website/src/assets/video/pulsedeck-spot-poster.webp (Bild aus dem Claim "Euer Chat bleibt. Das Chaos geht.")
#   Untertitel website/public/video/pulsedeck-in-60-sekunden.de.vtt (aus den Wortzeiten der Sprecherin)
#   bash tools/website.sh [render.mp4]     (Standard: renders/pulsedeck-spot.mp4 aus tools/deliver.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=${1:-renders/pulsedeck-spot.mp4}
WEB=../../website
NAME=pulsedeck-in-60-sekunden
mkdir -p "$WEB/public/video" "$WEB/src/assets/video"

ffmpeg -loglevel error -y -i "$SRC" -i audio/mix.wav -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 22 -profile:v high -pix_fmt yuv420p -tune animation \
  -c:a aac -b:a 160k -ar 48000 -movflags +faststart -shortest "$WEB/public/video/$NAME.mp4"

POSTER_T=$(node -e "const t=require('./timing.json');console.log((t.cues['claim.geht']+0.7).toFixed(2))")
ffmpeg -loglevel error -y -ss "$POSTER_T" -i "$SRC" -frames:v 1 -c:v libwebp -quality 82 "$WEB/src/assets/video/pulsedeck-spot-poster.webp"

node tools/captions.mjs "$WEB/public/video/$NAME.de.vtt"
ls -la "$WEB/public/video" "$WEB/src/assets/video"
