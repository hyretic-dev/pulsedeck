"""Sprecherstimme über die ElevenLabs-API (Stimme Lola, Modell eleven_v4, Deutsch).

Erzeugt pro Segment aus vo/script.json eine MP3 und die Zeichen-Zeitmarken (vo/<id>.alignment.json).
Danach tools/timing.mjs (Szenen an die echten Wortzeiten anpassen) und tools/audio.py (Mix) ausführen.

    ELEVENLABS_API_KEY=... python3 -I tools/voiceover.py [segment-id ...]
    ELEVENLABS_VOICE=draft ...   # Entwurfsstimme aus vo/script.json (draftVoice) statt Lola

Lola ist eine Stimme aus der Voice Library: über die API erst ab dem Creator-Tarif nutzbar.
ELEVENLABS_FORMAT setzt das Ausgabeformat (Standard mp3_44100_128, ab Creator z. B. mp3_44100_192).
Der Schlüssel kommt nur aus der Umgebung und wird nirgends gespeichert.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format={fmt}'


def tts(cfg, text, prev_text, next_text, use_context=True):
    body = {
        'text': text,
        'model_id': cfg['model'],
        'language_code': cfg['language'],
        'voice_settings': {'stability': 0.5, 'similarity_boost': 0.8, 'style': 0.25, 'use_speaker_boost': True},
    }
    if use_context:
        body['previous_text'] = prev_text
        body['next_text'] = next_text
    req = urllib.request.Request(
        API.format(voice=cfg['voiceId'], fmt=os.environ.get('ELEVENLABS_FORMAT', 'mp3_44100_128')),
        data=json.dumps(body).encode(),
        headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY'], 'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    if not os.environ.get('ELEVENLABS_API_KEY'):
        sys.exit('ELEVENLABS_API_KEY fehlt')
    script = json.load(open(os.path.join(ROOT, 'vo/script.json')))
    cfg = dict(script['voice'])
    if os.environ.get('ELEVENLABS_VOICE') == 'draft':
        cfg.update(script['draftVoice'])
    print(f"Stimme: {cfg['name']} ({cfg['voiceId']}), Modell {cfg['model']}")
    segs = script['segments']
    only = set(sys.argv[1:])
    for i, seg in enumerate(segs):
        if only and seg['id'] not in only:
            continue
        text = seg.get('spoken', seg['text'])
        prev_text = ' '.join(s.get('spoken', s['text']) for s in segs[:i])[-600:]
        next_text = ' '.join(s.get('spoken', s['text']) for s in segs[i + 1:])[:600]
        try:
            res = tts(cfg, text, prev_text, next_text)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')
            if e.code in (400, 422) and 'previous_text' in detail:
                res = tts(cfg, text, prev_text, next_text, use_context=False)
            else:
                sys.exit(f'{seg["id"]}: HTTP {e.code} {detail[:400]}')
        open(os.path.join(ROOT, f'vo/{seg["id"]}.mp3'), 'wb').write(base64.b64decode(res['audio_base64']))
        json.dump(res.get('alignment') or res['normalized_alignment'], open(os.path.join(ROOT, f'vo/{seg["id"]}.alignment.json'), 'w'), ensure_ascii=False)
        print(f'{seg["id"]}: ok')
    json.dump({'voiceId': cfg['voiceId'], 'name': cfg['name'], 'model': cfg['model']}, open(os.path.join(ROOT, 'vo/voice.json'), 'w'), ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
