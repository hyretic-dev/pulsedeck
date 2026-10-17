#!/usr/bin/env bash
# Rendert den Spot und legt den Master-Mix (audio/mix.wav, -12 LUFS) direkt ins MP4,
# damit der Ton nur einmal AAC-kodiert wird. Danach Lautheit des Ergebnisses prüfen.
#   bash tools/deliver.sh [ausgabe.mp4]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-renders/pulsedeck-spot.mp4}
mkdir -p "$(dirname "$OUT")"
npx --yes hyperframes@0.8.169 render --quality delivery --output renders/.video.mp4
ffmpeg -loglevel error -y -i renders/.video.mp4 -i audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -movflags +faststart -shortest "$OUT"
rm -f renders/.video.mp4
ffmpeg -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -A14 Summary | grep -E '^\s+(I|Peak):'
