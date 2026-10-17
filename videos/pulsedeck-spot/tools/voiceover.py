"""Sprecherstimme über die ElevenLabs-API (Modell eleven_v4, Deutsch), als ein durchgehender Take.

Der ganze Sprechertext aus vo/script.json geht in einer Anfrage raus, damit Betonung und Fluss natürlich bleiben.
Danach wird der Take an den Pausen zwischen den Segmenten geschnitten (Zeichen-Zeitmarken von ElevenLabs):
vo/<id>.wav und vo/<id>.alignment.json je Segment, der Rohtake liegt in vo/take.mp3.
Danach tools/timing.mjs (Szenen an die echten Wortzeiten anpassen) und tools/audio.py (Mix) ausführen.

    ELEVENLABS_API_KEY=... python3 -I tools/voiceover.py
    ELEVENLABS_VOICE=draft ...   # Entwurfsstimme aus vo/script.json (draftVoice) statt Lola

Lola ist eine Stimme aus der Voice Library: über die API erst ab dem Creator-Tarif nutzbar.
ELEVENLABS_FORMAT setzt das Ausgabeformat (Standard mp3_44100_128, ab Creator z. B. mp3_44100_192).
Der Schlüssel kommt nur aus der Umgebung und wird nirgends gespeichert.
"""
import base64
import glob
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VO = os.path.join(ROOT, 'vo')
API = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format={fmt}'
TAIL = 0.28  # Nachklang nach dem letzten Zeichen eines Segments
LEAD = 0.1  # Atem vor dem ersten Zeichen


def tts(cfg, text):
    body = {'text': text, 'model_id': cfg['model'], 'language_code': cfg['language']}
    req = urllib.request.Request(
        API.format(voice=cfg['voiceId'], fmt=os.environ.get('ELEVENLABS_FORMAT', 'mp3_44100_128')),
        data=json.dumps(body).encode(),
        headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY'], 'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'HTTP {e.code} {e.read().decode(errors="replace")[:400]}')


def duration(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                                capture_output=True, text=True, check=True).stdout)


def main():
    if not os.environ.get('ELEVENLABS_API_KEY'):
        sys.exit('ELEVENLABS_API_KEY fehlt')
    script = json.load(open(os.path.join(VO, 'script.json')))
    cfg = dict(script['voice'])
    if os.environ.get('ELEVENLABS_VOICE') == 'draft':
        cfg.update(script['draftVoice'])
    print(f"Stimme: {cfg['name']} ({cfg['voiceId']}), Modell {cfg['model']}, ein Take")

    segs = script['segments']
    texts = [s.get('spoken', s['text']) for s in segs]
    full = ' '.join(texts)
    res = tts(cfg, full)
    take = os.path.join(VO, 'take.mp3')
    open(take, 'wb').write(base64.b64decode(res['audio_base64']))
    al = res.get('alignment') or res['normalized_alignment']
    json.dump(al, open(os.path.join(VO, 'take.alignment.json'), 'w'), ensure_ascii=False)
    chars = ''.join(al['characters'])
    if chars != full:
        sys.exit('Zeitmarken passen nicht zum Text (normalisierter Text?), Schnitt abgebrochen')
    starts, ends = al['character_start_times_seconds'], al['character_end_times_seconds']
    total = duration(take)

    # Zeichenbereiche der Segmente im Gesamttext
    spans, pos = [], 0
    for t in texts:
        spans.append((pos, pos + len(t)))
        pos += len(t) + 1

    for f in glob.glob(os.path.join(VO, '*.mp3')):
        if not f.endswith('take.mp3'):
            os.remove(f)
    for k, (seg, (a, b)) in enumerate(zip(segs, spans)):
        first, last = starts[a], ends[b - 1]
        prev_end = ends[spans[k - 1][1] - 1] if k else 0.0
        next_start = starts[spans[k + 1][0]] if k + 1 < len(spans) else total
        cut_a = max((prev_end + first) / 2 if k else 0.0, first - LEAD)
        cut_b = min((last + next_start) / 2 if k + 1 < len(spans) else total, last + TAIL)
        d = cut_b - cut_a
        out = os.path.join(VO, f"{seg['id']}.wav")
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{cut_a:.3f}', '-t', f'{d:.3f}', '-i', take,
                        '-af', f'afade=t=in:d=0.012,afade=t=out:st={max(0, d - 0.04):.3f}:d=0.04', '-c:a', 'pcm_s16le', out], check=True)
        seg_al = {
            'characters': al['characters'][a:b],
            'character_start_times_seconds': [round(x - cut_a, 3) for x in starts[a:b]],
            'character_end_times_seconds': [round(x - cut_a, 3) for x in ends[a:b]],
        }
        json.dump(seg_al, open(os.path.join(VO, f"{seg['id']}.alignment.json"), 'w'), ensure_ascii=False)
        print(f"{seg['id']:7s} {cut_a:6.2f} - {cut_b:6.2f} s  ({d:.2f} s)")
    json.dump({'voiceId': cfg['voiceId'], 'name': cfg['name'], 'model': cfg['model'], 'take_seconds': round(total, 2)},
              open(os.path.join(VO, 'voice.json'), 'w'), ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
