"""Tonspur des Spots: Sounds synthetisieren, Musik schneiden, Stimme anlegen, mischen und mastern.

Ziele (Auftrag): Stimme -14 LUFS, Musik -36 LUFS, fertiger Mix -12 LUFS (integriert, ITU-R BS.1770).
Stimme und Musik werden als Stems auf ihre Zielwerte gebracht, die Summe wird anschließend
mit einem True-Peak-Limiter auf -12 LUFS gemastert (Obergrenze -1 dBTP).

    python3 -I tools/audio.py            # schreibt audio/mix.wav und audio/stems/*.wav

Alle Zeiten kommen aus timing.json (Wort-Cues), dieselben Formeln wie in assets/spot.js.
"""
import json
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
T = json.load(open(os.path.join(ROOT, 'timing.json')))
C = T['cues']
S = {s['id']: s for s in T['scenes']}
TOTAL = T['total']
N = int(round(TOTAL * SR))

TARGET_VO = -14.0
TARGET_MUSIC = -36.0
TARGET_SFX = -25.0
TARGET_MIX = -12.0
CEILING_DBTP = -1.5
MUSIC_FILE = os.path.join(ROOT, 'audio/music/shiny-tech_kevin-macleod.mp3')
# Quelle: Spiegel der CC-BY-Titel von Kevin MacLeod auf GitHub, fester Commit und Prüfsumme; nicht im Repo eingecheckt
MUSIC_URL = 'https://raw.githubusercontent.com/noobsandnerdsgroup/audio/24a545705ba6277d03c2c2d736048a72ff12d681/Shiny%20Tech.mp3'
MUSIC_SHA256 = '1889779e953b392ae07c57219066e2a14407e796eaa5a167da5cea6fc622d357'
VOICE_TEMPO = json.load(open(os.path.join(ROOT, 'vo/script.json')))['voice'].get('tempo', 1.0)
MUSIC_DROP = 7.012  # erster Takt nach dem Intro in "Shiny Tech" (Beat-Analyse mit librosa)
MUSIC_BEAT = 0.6502  # 92,3 BPM

rng = np.random.default_rng(20271007)


# ---------------------------------------------------------------- Bausteine
def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def env_ad(n, attack, decay, curve=4.0):
    a = int(attack * SR)
    e = np.ones(n)
    if a > 0:
        e[:a] = np.linspace(0, 1, a) ** 2
    rest = n - a
    e[a:] = np.exp(-curve * np.linspace(0, 1, rest) * (rest / SR) / max(decay, 1e-3))
    return e


def glide(f0, f1, dur, curve='exp'):
    t = t_axis(dur)
    if curve == 'exp':
        f = f0 * (f1 / f0) ** (t / dur)
    else:
        f = f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'lowpass', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'highpass', fs=SR, output='sos'), x)


def sweep_filter(x, f_start, f_end, kind='bandpass', q=1.2, blocks=64):
    """Filter mit wanderndem Mittenwert, blockweise (für Whooshes und Riser)."""
    out = np.zeros_like(x)
    edges = np.linspace(0, len(x), blocks + 1).astype(int)
    zi = None
    for i in range(blocks):
        f = f_start * (f_end / f_start) ** (i / (blocks - 1))
        if kind == 'bandpass':
            lo, hi = f / (1 + 1 / (2 * q)), f * (1 + 1 / (2 * q))
            sos = signal.butter(2, [max(lo, 20), min(hi, SR / 2 - 100)], 'bandpass', fs=SR, output='sos')
        else:
            sos = signal.butter(2, min(f, SR / 2 - 100), kind, fs=SR, output='sos')
        if zi is None or zi.shape != (sos.shape[0], 2):
            zi = np.zeros((sos.shape[0], 2))
        out[edges[i]:edges[i + 1]], zi = signal.sosfilt(sos, x[edges[i]:edges[i + 1]], zi=zi)
    return out


def reverb(x, length=0.9, mix=0.25, damp=3500):
    """Kleiner Raum: Faltung mit abklingendem, gefiltertem Rauschen, links/rechts dekorreliert."""
    n = int(length * SR)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        ir = lp(rng.standard_normal(n), damp) * np.exp(-6.5 * t / length)
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    wet = np.stack([signal.fftconvolve(x, ir) for ir in irs], axis=1)
    dry = np.zeros((len(x) + n - 1, 2))
    dry[: len(x)] = x[:, None]
    return dry * (1 - mix) + wet * mix


def pan(x, p=0.0):
    """Konstante Leistung, p in [-1, 1]; Stereo-Eingang wird nur gewichtet."""
    a = (p + 1) * np.pi / 4
    if x.ndim == 1:
        return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)
    return x * np.array([np.cos(a), np.sin(a)]) * np.sqrt(2)


def norm(x, peak_db=-1.0):
    return x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)


# ---------------------------------------------------------------- Sounds
def sfx_pop(pitch=1.0):
    d = 0.12
    x = glide(640 * pitch, 380 * pitch, d) * env_ad(int(d * SR), 0.002, 0.05)
    click = hp(noise(0.004), 3000) * 0.3
    x[: len(click)] += click
    return reverb(x, 0.35, 0.12)


def sfx_ping():
    d = 1.1
    t = t_axis(d)
    out = np.zeros(len(t))
    for f, delay, amp in ((1568, 0.0, 1.0), (2349, 0.075, 0.8)):
        k = int(delay * SR)
        tt = t[: len(t) - k]
        mod = np.sin(2 * np.pi * f * 1.4 * tt) * 2.2 * np.exp(-tt * 9)
        out[k:] += amp * np.sin(2 * np.pi * f * tt + mod) * np.exp(-tt * 5.5)
    return reverb(out * env_ad(len(out), 0.002, 2), 0.8, 0.22)


def sfx_thud():
    d = 0.45
    x = glide(110, 42, d) * env_ad(int(d * SR), 0.003, 0.16)
    x += lp(noise(d), 180) * env_ad(int(d * SR), 0.001, 0.05) * 0.8
    x = np.tanh(x * 2.2) / np.tanh(2.2)
    return reverb(x, 0.6, 0.15, 2000)


def sfx_pen(dur):
    x = bp(noise(dur), 1800, 6000)
    strokes = np.abs(lp(noise(dur), 9, 1))
    strokes = strokes / (strokes.max() + 1e-9)
    e = np.minimum(1, np.minimum(np.arange(len(x)) / (0.03 * SR), (len(x) - np.arange(len(x))) / (0.06 * SR)))
    return pan(x * (0.35 + strokes) * e * 0.6, 0.1)


def sfx_whoosh(dur=0.5, f0=250, f1=3200, f2=700, p0=-0.6, p1=0.6):
    n = int(dur * SR)
    half = n // 2
    x = noise(dur)
    a = sweep_filter(x[:half], f0, f1, q=0.9)
    b = sweep_filter(x[half:], f1, f2, q=0.9)
    y = np.concatenate([a, b]) * np.sin(np.linspace(0, np.pi, n)) ** 1.6
    pans = np.linspace(p0, p1, n)
    ang = (pans + 1) * np.pi / 4
    return np.stack([y * np.cos(ang), y * np.sin(ang)], axis=1)


def sfx_riser(dur):
    n = int(dur * SR)
    x = sweep_filter(noise(dur), 300, 9000, kind='highpass', blocks=96) * 0.7
    x += glide(140, 880, dur) * 0.25
    e = np.linspace(0, 1, n) ** 2.4
    return reverb(x * e, 0.9, 0.3)


def sfx_breath(dur):
    n = int(dur * SR)
    x = lp(hp(noise(dur), 200), 1400)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return pan(x * e * 0.5, 0)


def sfx_heartbeat():
    def thump(f0, f1, d, amp):
        x = glide(f0, f1, d) * env_ad(int(d * SR), 0.004, d * 0.45)
        x = np.tanh(x * 2.6) / np.tanh(2.6)
        x += lp(noise(d), 300) * env_ad(int(d * SR), 0.001, 0.02) * 0.4
        return x * amp
    lub = thump(78, 46, 0.32, 1.0)
    dub = thump(70, 44, 0.26, 0.8)
    k = int(0.23 * SR)
    out = np.zeros(k + len(dub))
    out[: len(lub)] += lub
    out[k:] += dub
    return reverb(out, 0.7, 0.18, 1500)


def sfx_shimmer(dur=1.6):
    t = t_axis(dur)
    out = np.zeros(len(t))
    for i, f in enumerate((1760, 2217.5, 2637, 3520, 4186)):
        k = int(i * 0.06 * SR)
        tt = t[: len(t) - k]
        out[k:] += np.sin(2 * np.pi * f * tt) * np.exp(-tt * 2.6) * (0.9 - i * 0.12) * (1 + 0.3 * np.sin(2 * np.pi * 7 * tt))
    return reverb(out * env_ad(len(out), 0.01, 3), 1.6, 0.45)


def sfx_click(bright=1.0):
    d = 0.03
    x = hp(noise(d), 2500) * env_ad(int(d * SR), 0.0005, 0.006)
    x += np.sin(2 * np.pi * 1900 * bright * t_axis(d)) * env_ad(int(d * SR), 0.0005, 0.008) * 0.6
    return reverb(x, 0.25, 0.1)


def sfx_tick(pitch=1.0):
    d = 0.05
    x = np.sin(2 * np.pi * 3100 * pitch * t_axis(d)) * env_ad(int(d * SR), 0.0005, 0.012)
    return pan(x, 0)


def sfx_chime(notes, gap=0.09, dur=0.9):
    out = np.zeros(int((gap * len(notes) + dur) * SR))
    for i, f in enumerate(notes):
        t = t_axis(dur)
        x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.1 * np.sin(2 * np.pi * 3.01 * f * t)) * np.exp(-t * 5)
        k = int(i * gap * SR)
        out[k:k + len(x)] += x * env_ad(len(x), 0.003, 3)
    return reverb(out, 0.9, 0.28)


def sfx_stamp():
    x = sfx_thud()[:, 0]
    c = sfx_click(0.7)[:, 0]
    x[: len(c)] += c * 0.6
    return reverb(x, 0.5, 0.12, 2500)


def sfx_typing(n_keys=10, span=0.7, seed=3):
    r = np.random.default_rng(seed)
    times = np.sort(r.uniform(0, span, n_keys))
    out = np.zeros(int((span + 0.1) * SR))
    for t0 in times:
        c = sfx_click(r.uniform(0.8, 1.3))[:, 0] * r.uniform(0.5, 1)
        k = int(t0 * SR)
        out[k:k + len(c)] += c[: len(out) - k]
    return pan(out, 0.2)


def sfx_ratchet(dur=0.9, n=18):
    """Zähler rattert hoch (Ticks werden langsamer, wie der Zahlen-Tween mit power2.out)."""
    out = np.zeros(int((dur + 0.1) * SR))
    for i in range(n):
        u = i / (n - 1)
        t0 = dur * (1 - np.sqrt(1 - u))
        c = sfx_tick(1.0 + 0.3 * u)[:, 0]
        k = int(t0 * SR)
        out[k:k + len(c)] += c
    return pan(out, 0)


# ---------------------------------------------------------------- Platzierung
def build_sfx():
    track = np.zeros((N + SR * 3, 2))

    def put(x, t, db=0.0, p=None):
        if x.ndim == 1:
            x = pan(x, p or 0)
        elif p is not None:
            x = pan(x, p)
        k = int(round(t * SR))
        if k < 0:
            x, k = x[-k:], 0
        track[k:k + len(x)] += x * 10 ** (db / 20)

    W = sfx_whoosh
    # 1 Chaos
    for k, t in enumerate(T['ev']['bubbles']):
        put(norm(sfx_pop(1.0 + 0.08 * ((k * 7) % 5))), t, -17 + 6 * k / 17, 0.25 if k % 4 == 3 else -0.1)
    for i in range(3):
        put(norm(sfx_ping()), C['hook.chat'] + i * 0.3, -15 - i, 0.45)
    put(norm(W(0.55, 400, 4000, 900)), C['hook.sommerfest'] - 0.4, -26)
    put(norm(sfx_ratchet()), C['hook.n300'] - 0.1, -22)
    put(norm(sfx_thud()), C['hook.n300'] - 0.1, -17)
    t_imp = C['turn.start'] - 0.55
    for q in ('q1', 'q2', 'q3'):
        put(norm(sfx_thud()), C['hook.' + q] - 0.06, -13)
        put(norm(sfx_pen(0.5)), C['hook.' + q] + 0.12, -22)
    put(norm(sfx_pen(t_imp - C['hook.chat'])), C['hook.chat'], -30)
    put(norm(sfx_riser(1.6)), t_imp - 1.5, -17)
    put(norm(W(0.5, 5000, 400, 120, 0.5, -0.5))[::-1], t_imp, -15)

    # 2 Durchatmen -> Puls -> Logo
    put(norm(sfx_breath(1.6)), C['turn.start'] + 0.1, -27)
    put(norm(sfx_heartbeat()), C['brand.brand'] - 0.3, -8)
    put(norm(sfx_shimmer()), C['brand.brand'] + 0.3, -20)
    put(norm(W(0.6, 300, 2500, 800, -0.3, 0.3)), C['brand.brand'] + 0.38, -25)

    # 3 Claim
    put(norm(W(0.7, 200, 2200, 500, -0.8, 0.0)), C['claim.start'] - 0.4, -23)
    for k in range(5):
        put(norm(sfx_pop(1.25)), C['claim.start'] - 0.05 + k * 0.34, -25, -0.4)
    put(norm(sfx_pen(0.35)), C['claim.geht'] + 0.1, -16)

    # 4 Feed
    put(norm(W(0.7, 250, 4500, 600, -0.9, 0.9)), S['feed']['start'] - 0.1, -17)
    put(norm(sfx_click(0.8)), C['feed.feed'] + 0.05, -20)
    put(norm(sfx_pop(1.4)), C['feed.bleibt'], -19)
    put(norm(sfx_click(1.2)), C['feed.poll'], -20)
    put(norm(sfx_riser(0.9)) * 0.6, C['feed.poll'] + 0.05, -27)
    put(norm(W(0.6, 600, 5000, 1500, 0.4, -0.6)), C['feed.news'] - 0.15, -21)
    put(norm(W(0.6, 200, 1800, 400, 0.8, 0.5)), C['feed.push'] - 0.5, -25)
    put(norm(sfx_ping()), C['feed.push'] + 0.05, -13, 0.4)

    # 5 Schichten
    put(norm(W(0.55, 300, 5000, 900, 0.9, -0.9)), S['shifts']['start'] - 0.05, -17)
    for cue in ('termin', 'schichten', 'link'):
        put(norm(sfx_pop(1.1)), C['shifts.' + cue] - 0.12, -20, -0.5)
    put(norm(W(0.6, 250, 2000, 500, 0.2, 0.6)), C['shifts.schichten'] - 0.05, -26)
    put(norm(sfx_click()), C['shifts.link'] + 0.05, -14, 0.5)
    put(norm(W(0.6, 200, 1800, 400, 0.8, 0.5)), C['shifts.link'] + 0.2, -25)
    put(norm(W(0.35, 800, 6000, 2000, 0.2, 0.7)), C['shifts.gruppe'] - 0.2, -22)
    put(norm(sfx_pop(1.3)), C['shifts.gruppe'] - 0.15, -18, 0.5)
    for k in range(5):
        put(norm(sfx_pop(1.0 + 0.1 * k)), C['shifts.jeder'] + 0.05 + k * 0.17, -21, 0.1)
    for k in range(3):
        put(norm(sfx_pop(1.2 + 0.1 * k)), C['shifts.jeder'] + 0.13 + k * 0.22, -22, 0.5)
    put(norm(sfx_click(0.6)), C['shifts.jeder'] + 0.13 + 2 * 0.22 + 0.25, -19, 0.5)
    put(norm(sfx_click()), C['shifts.klickt'], -12, 0.1)
    put(norm(sfx_chime([784, 1175])), C['shifts.klickt'] + 0.15, -18)
    put(norm(sfx_pen(0.42)), C['shifts.besetzt'] - 0.05, -17, 0.2)

    # 6 Aktivieren
    put(norm(W(0.55, 300, 6000, 2000, 0, 0)), S['activ']['start'] - 0.05, -17)
    put(norm(sfx_shimmer(1.4)), C['activ.aktive'], -22)
    notes = [523.3, 659.3, 784, 1046.5]
    for j in range(4):
        put(norm(sfx_chime([notes[j]], dur=0.7)), C['activ.quest'] + 0.25 + j * 0.3, -20)
    put(norm(sfx_riser(1.35)) * 0.5, C['activ.quest'] + 0.15, -28)
    put(norm(W(0.6, 250, 2200, 500, -0.3, 0.3)), C['activ.micro'] - 0.1, -24)
    for i in range(3):
        put(norm(sfx_tick(0.9 + 0.12 * i)), C['activ.skills'] - 0.3 + i * 0.14, -20, -0.3)

    # 7 Wissen
    put(norm(W(0.55, 200, 3000, 600, 0, 0)), S['wissen']['start'] - 0.05, -17)
    for cue, p in (('wiki', -0.6), ('dateien', 0.0), ('ag', 0.1)):
        put(norm(W(0.45, 300, 2600, 700, p - 0.2, p + 0.2)), C['wissen.' + cue] - 0.2, -25)
    put(norm(W(0.6, 250, 2400, 600, 0.9, 0.6)), C['wissen.wunsch'] - 0.2, -23)
    t_ask = C['wissen.wunsch'] + 0.25
    t_ans = min(C['wissen.ki'] + 0.45, C['wissen.doku'] - 0.2)
    put(norm(sfx_pop(1.3)), t_ask, -19, 0.6)
    for i in range(4):
        put(norm(sfx_tick(0.55)), t_ask + 0.4 + i * 0.16, -30, 0.6)
    put(norm(sfx_chime([1046.5, 1568], gap=0.07)), t_ans, -20, 0.5)
    put(norm(sfx_pen(0.6)), t_ans + 0.1, -26, 0.2)

    # 8 Vertrauen
    put(norm(W(0.7, 250, 4500, 600, -0.9, 0.9)), S['trust']['start'] - 0.1, -17)
    for i, cue in enumerate(('de', 'tel', 'track', 'os')):
        t = max(C['trust.' + cue] - 0.1, S['trust']['start'] + 0.42)
        put(norm(sfx_stamp()), t, -14, [-0.3, 0.3, -0.3, 0.3][i])

    # 9 Abschluss
    put(norm(W(0.5, 4000, 300, 120, 0.4, -0.4))[::-1], S['cta']['start'], -20)
    put(norm(sfx_heartbeat()), C['cta.brand'] - 0.3, -13)
    put(norm(sfx_shimmer()), C['cta.brand'] - 0.1, -21)
    put(norm(sfx_pop(1.0)), C['cta.jetzt'] - 0.1, -17)
    put(norm(sfx_tick(1.1)), C['cta.url'] - 0.25, -21)
    put(norm(sfx_heartbeat()), TOTAL - 1.25, -9)
    return track[:N]


# ---------------------------------------------------------------- Musik
def fetch_music():
    import hashlib
    import urllib.request
    if not os.path.exists(MUSIC_FILE):
        os.makedirs(os.path.dirname(MUSIC_FILE), exist_ok=True)
        urllib.request.urlretrieve(MUSIC_URL, MUSIC_FILE)
    digest = hashlib.sha256(open(MUSIC_FILE, 'rb').read()).hexdigest()
    if digest != MUSIC_SHA256:
        sys.exit(f'Musikdatei weicht ab (sha256 {digest})')


def build_music():
    fetch_music()
    y, sr = sf.read(MUSIC_FILE) if MUSIC_FILE.endswith('.wav') else load_mp3(MUSIC_FILE)
    assert sr == SR
    brand = C['brand.brand']
    # 1) Intro + Hauptteil: der Drop des Tracks landet auf dem Wort "PulseDeck"
    start_track = brand - MUSIC_DROP
    out = np.zeros((N, 2))
    src0 = max(0, int(round(-start_track * SR)))
    dst0 = max(0, int(round(start_track * SR)))
    # 2) Schluss: der letzte Schlag des Tracks (215,50 s) liegt auf dem Logo-Herzschlag, Übergang auf einer Taktzeit
    end_hit_src = 215.504
    hit_target = TOTAL - 1.25
    beats_after_drop = round((hit_target - brand) / MUSIC_BEAT)
    hit_spot = brand + beats_after_drop * MUSIC_BEAT
    xfade_spot = hit_spot - 8 * MUSIC_BEAT
    main_len = int(round((xfade_spot + MUSIC_BEAT - start_track) * SR)) - src0
    main = y[src0:src0 + main_len]
    out[dst0:dst0 + len(main)] += main[: N - dst0]
    tail_src = int(round((end_hit_src - 8 * MUSIC_BEAT) * SR))
    tail = y[tail_src:]
    k = int(round(xfade_spot * SR))
    xf = int(MUSIC_BEAT * SR)
    fade = np.linspace(0, 1, xf)[:, None]
    out[k:k + xf] *= 1 - fade
    out[k + xf:] = 0
    seg = tail[: N - k].copy()
    seg[:xf] *= fade[: len(seg[:xf])]
    out[k:k + len(seg)] += seg
    # Leises Einblenden am Anfang, sanft aus am Ende
    fi = int(1.2 * SR)
    out[dst0:dst0 + fi] *= np.linspace(0, 1, fi)[:, None]
    fo = int(0.9 * SR)
    out[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2

    # 3) "Durchatmen": Tiefpass und Absenkung bis zum Drop, dann geht der Klang wieder auf
    filt = np.stack([lp(out[:, c], 380, 4) for c in range(2)], axis=1)
    t = np.arange(N) / SR
    a0, a1 = C['turn.start'] - 0.6, C['turn.start'] - 0.1
    e = np.clip((t - a0) / (a1 - a0), 0, 1) * (t < brand - 0.02)
    e = e[:, None]
    out = out * (1 - e) + filt * e * 0.55
    return out, {'start_track': start_track, 'xfade_spot': xfade_spot, 'hit_spot': hit_spot}


def load_tempo(path, tempo):
    """Stimme tonhöhen- und formanterhaltend beschleunigen (Rubberband in ffmpeg)."""
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        # Tempo, Trittschall weg, sanfte Sprachkompression (weniger Spitzen, damit der Master-Limiter kaum arbeiten muss)
        stretch = f'rubberband=tempo={tempo}:formant=preserved:transients=mixed:window=standard,' if abs(tempo - 1) > 1e-6 else ''
        chain = stretch + 'highpass=f=80,acompressor=threshold=-24dB:ratio=3:attack=5:release=90:knee=4:makeup=2,alimiter=limit=0.89:attack=2:release=40:level=disabled'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path, '-af', chain, '-ar', str(SR), tmp.name], check=True)
        y, sr = sf.read(tmp.name)
    return y, sr


def load_mp3(path):
    import librosa
    y, sr = librosa.load(path, sr=SR, mono=False)
    return y.T, sr


# ---------------------------------------------------------------- Stimme
def build_vo():
    out = np.zeros((N, 2))
    found = 0
    for seg in T['segments']:
        p = os.path.join(ROOT, f"vo/{seg['id']}.wav")
        if not os.path.exists(p):
            p = os.path.join(ROOT, f"vo/{seg['id']}.mp3")
        if not os.path.exists(p):
            continue
        y, _ = load_tempo(p, VOICE_TEMPO)
        if y.ndim == 1:
            y = np.stack([y, y], axis=1)
        k = int(round(seg['start'] * SR))
        out[k:k + len(y)] += y[: N - k]
        found += 1
    return out, found


# ---------------------------------------------------------------- Lautheit
METER = pyln.Meter(SR)


def lufs(x):
    return METER.integrated_loudness(x) if np.max(np.abs(x)) > 0 else float('-inf')


def to_lufs(x, target):
    cur = lufs(x)
    return (x * 10 ** ((target - cur) / 20), cur) if np.isfinite(cur) else (x, cur)


def true_peak_limit(x, ceiling_db, lookahead=0.0015, release=0.08):
    """Vorausschauender Limiter auf 4-fach überabgetasteten Spitzen (True Peak nach BS.1770)."""
    up = signal.resample_poly(x, 4, 1, axis=0)
    peak = np.max(np.abs(up), axis=1)
    peak = peak.reshape(-1, 4).max(axis=1)[: len(x)]
    ceil = 10 ** (ceiling_db / 20)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    la = int(lookahead * SR)
    need = _min_window(need, la)
    g = np.empty_like(need)
    rel = np.exp(-1 / (release * SR))
    cur = 1.0
    for i, v in enumerate(need):
        cur = v if v < cur else v + (cur - v) * rel
        g[i] = cur
    return x * g[:, None]


def _min_window(a, w):
    """Minimum über das Fenster [i, i+w] (Vorausschau), O(n) mit monotoner Schlange."""
    from collections import deque
    n = len(a)
    out = np.empty(n)
    dq = deque()
    j = 0
    for i in range(n):
        while j < n and j <= i + w:
            while dq and a[dq[-1]] >= a[j]:
                dq.pop()
            dq.append(j)
            j += 1
        while dq[0] < i:
            dq.popleft()
        out[i] = a[dq[0]]
    return out


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.max(np.abs(up)) + 1e-12)


def main():
    os.makedirs(os.path.join(ROOT, 'audio/stems'), exist_ok=True)
    vo, n_vo = build_vo()
    music, mus_info = build_music()
    sfx = build_sfx()

    vo, vo_raw = to_lufs(vo, TARGET_VO) if n_vo else (vo, float('-inf'))
    music, _ = to_lufs(music, TARGET_MUSIC)
    sfx, _ = to_lufs(sfx, TARGET_SFX)

    mix = vo + music + sfx
    pre = lufs(mix)
    if n_vo:
        master = mix * 10 ** ((TARGET_MIX - pre) / 20)
        for _ in range(8):
            master = true_peak_limit(master, CEILING_DBTP)
            cur = lufs(master)
            if abs(cur - TARGET_MIX) < 0.02:
                break
            master *= 10 ** ((TARGET_MIX - cur) / 20)
        master = true_peak_limit(master, CEILING_DBTP)
    else:
        # Ohne Stimme nur Vorschau: Mastergain so, wie er mit Stimme ungefähr ausfiele, kein Hochziehen auf -12 LUFS
        pre = TARGET_VO
        master = true_peak_limit(mix * 10 ** ((TARGET_MIX - TARGET_VO) / 20), CEILING_DBTP)

    for name, x in (('vo', vo), ('music', music), ('sfx', sfx)):
        sf.write(os.path.join(ROOT, f'audio/stems/{name}.wav'), x.astype(np.float32), SR, subtype='FLOAT')
    sf.write(os.path.join(ROOT, 'audio/mix.wav'), master.astype(np.float32), SR, subtype='PCM_24')
    # Kompakte Fassung für die Komposition (AAC 320k); für die Auslieferung wird mix.wav direkt ins MP4 gelegt
    import subprocess
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', os.path.join(ROOT, 'audio/mix.wav'), '-c:a', 'aac', '-b:a', '320k', os.path.join(ROOT, 'audio/mix.m4a')], check=True)

    gain = TARGET_MIX - pre
    report = {
        'stimme_stem_lufs': round(lufs(vo), 2) if n_vo else None,
        'stimme_segmente': n_vo,
        'musik_stem_lufs': round(lufs(music), 2),
        'sfx_stem_lufs': round(lufs(sfx), 2),
        'summe_vor_master_lufs': round(pre, 2),
        'master_gain_db': round(gain, 2),
        'mix_lufs': round(lufs(master), 2),
        'mix_true_peak_dbtp': round(true_peak_db(master), 2),
        'musik': {k: round(v, 3) for k, v in mus_info.items()},
    }
    json.dump(report, open(os.path.join(ROOT, 'audio/loudness.json'), 'w'), indent=2)
    print(json.dumps(report, indent=2))
    if not n_vo:
        print('HINWEIS: keine Sprachaufnahmen in vo/ gefunden, die Stimme fehlt im Mix.', file=sys.stderr)


if __name__ == '__main__':
    main()
