"""Sprecherstimme über die ElevenLabs-API (Modell eleven_v4, Deutsch), als ein durchgehender Take.

Der ganze Sprechertext aus vo/script.json geht in einer Anfrage raus, damit Betonung und Fluss natürlich bleiben.
Danach wird der Take an den Pausen zwischen den Segmenten geschnitten (Zeichen-Zeitmarken von ElevenLabs):
vo/<id>.wav und vo/<id>.alignment.json je Segment, der Rohtake liegt in vo/take.mp3.
Danach tools/timing.mjs (Szenen an die echten Wortzeiten anpassen) und tools/audio.py (Mix) ausführen.

    ELEVENLABS_API_KEY=... python3 -I tools/voiceover.py
    ELEVENLABS_VOICE=draft ...   # Entwurfsstimme aus vo/script.json (draftVoice) statt Lola
    ... tools/voiceover.py redo <szene> [varianten]   # eine Szene neu sprechen (z. B. nach einem Versprecher)

Beim Neusprechen gehen der Text davor und danach als Kontext mit, damit Tonfall und Fluss zum Take passen.
Jede Variante wird mit ElevenLabs Scribe transkribiert; genommen wird die mit der sichersten Erkennung
(höchster schlechtester Wort-Logprob), angepasst an die Lautheit der ersetzten Szene.

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


def tts(cfg, text, prev_text=None, next_text=None):
    body = {'text': text, 'model_id': cfg['model'], 'language_code': cfg['language']}
    if prev_text is not None:
        body['previous_text'] = prev_text
        body['next_text'] = next_text
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


def stt_confidence(path):
    """Schlechtester und mittlerer Wort-Logprob der Scribe-Transkription."""
    out = subprocess.run(['curl', '-s', '-m', '300', '-X', 'POST', 'https://api.elevenlabs.io/v1/speech-to-text',
                          '-H', f"xi-api-key: {os.environ['ELEVENLABS_API_KEY']}", '-F', 'model_id=scribe_v1',
                          '-F', 'language_code=deu', '-F', f'file=@{path}'], capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    lp = [w.get('logprob', 0.0) for w in d.get('words', []) if w.get('type') == 'word']
    return (min(lp), sum(lp) / len(lp), d.get('text', '')) if lp else (-99.0, -99.0, '')


def redo(cfg, segs, sid, variants):
    import numpy as np
    import pyloudnorm as pyln
    import soundfile as sf
    k = [s['id'] for s in segs].index(sid)
    texts = [s.get('spoken', s['text']) for s in segs]
    prev_text, next_text = ' '.join(texts[:k])[-600:], ' '.join(texts[k + 1:])[:600]
    os.makedirs(os.path.join(VO, 'redo'), exist_ok=True)
    best = None
    for v in range(1, variants + 1):
        res = tts(cfg, texts[k], prev_text, next_text)
        mp3 = os.path.join(VO, 'redo', f'{sid}_v{v}.mp3')
        open(mp3, 'wb').write(base64.b64decode(res['audio_base64']))
        al = res.get('alignment') or res['normalized_alignment']
        worst, mean, said = stt_confidence(mp3)
        print(f'  Variante {v}: schlechtestes Wort {worst:.3f}, Mittel {mean:.3f}  | {said}')
        if best is None or worst > best[0]:
            best = (worst, mp3, al)
    worst, mp3, al = best
    starts, ends = al['character_start_times_seconds'], al['character_end_times_seconds']
    cut_a = max(0.0, starts[0] - LEAD)
    cut_b = min(duration(mp3), ends[-1] + TAIL)
    out = os.path.join(VO, f'{sid}.wav')
    ref, sr = sf.read(out)
    target = pyln.Meter(sr).integrated_loudness(ref)
    tmp = os.path.join(VO, 'redo', f'{sid}_cut.wav')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{cut_a:.3f}', '-t', f'{cut_b - cut_a:.3f}', '-i', mp3,
                    '-af', f'afade=t=in:d=0.012,afade=t=out:st={max(0, cut_b - cut_a - 0.04):.3f}:d=0.04', '-ar', str(sr), '-ac', '1' if ref.ndim == 1 else '2',
                    '-c:a', 'pcm_s16le', tmp], check=True)
    y, _ = sf.read(tmp)
    y = y * 10 ** ((target - pyln.Meter(sr).integrated_loudness(y)) / 20)
    sf.write(out, np.clip(y, -1, 1), sr, subtype='PCM_16')
    json.dump({'characters': al['characters'],
               'character_start_times_seconds': [round(x - cut_a, 3) for x in starts],
               'character_end_times_seconds': [round(x - cut_a, 3) for x in ends]},
              open(os.path.join(VO, f'{sid}.alignment.json'), 'w'), ensure_ascii=False)
    meta = json.load(open(os.path.join(VO, 'voice.json')))
    meta.setdefault('neu_gesprochen', {})[sid] = os.path.basename(mp3)
    json.dump(meta, open(os.path.join(VO, 'voice.json'), 'w'), ensure_ascii=False, indent=2)
    print(f'{sid}: {os.path.basename(mp3)} eingesetzt (schlechtestes Wort {worst:.3f}), Lautheit an Szene angepasst ({target:.1f} LUFS)')


def main():
    if not os.environ.get('ELEVENLABS_API_KEY'):
        sys.exit('ELEVENLABS_API_KEY fehlt')
    script = json.load(open(os.path.join(VO, 'script.json')))
    cfg = dict(script['voice'])
    if os.environ.get('ELEVENLABS_VOICE') == 'draft':
        cfg.update(script['draftVoice'])
    if len(sys.argv) > 2 and sys.argv[1] == 'redo':
        print(f"Stimme: {cfg['name']} ({cfg['voiceId']}), Szene {sys.argv[2]} neu")
        redo(cfg, script['segments'], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
        return
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
