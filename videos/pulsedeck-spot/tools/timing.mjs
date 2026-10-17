// Legt den Zeitplan des Spots fest: Sprechersegmente, Wort-Cues und Szenengrenzen.
// Quelle der Wahrheit sind vo/script.json und, sobald vorhanden, die echten Sprachaufnahmen
// (vo/<id>.mp3 + vo/<id>.alignment.json von ElevenLabs). Ohne Aufnahmen wird geschätzt.
// Schreibt timing.json und timing.js und stempelt data-start/data-duration in index.html.
//   node tools/timing.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const script = JSON.parse(readFileSync(join(root, 'vo/script.json'), 'utf8'));

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}.-]/gu, '').replace(/[.-]+$/, '');

function words(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ w: m[0], i: m.index, j: m.index + m[0].length });
  return out;
}

// Grobe Schätzung für deutsche Werbesprache (~14 Zeichen/s), Satzzeichen als Pausen.
function estimate(text) {
  let t = 0;
  return {
    words: words(text).map(({ w }) => {
      const s = t;
      t += 0.056 * w.length + 0.06;
      const e = t;
      if (/[.?!:]$/.test(w)) t += 0.3;
      else if (/,$/.test(w)) t += 0.14;
      return { w, s, e };
    }),
    dur: t - 0.15,
  };
}

function measured(seg) {
  const mp3 = join(root, `vo/${seg.id}.mp3`);
  const al = join(root, `vo/${seg.id}.alignment.json`);
  if (!existsSync(mp3) || !existsSync(al)) return null;
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString());
  const a = JSON.parse(readFileSync(al, 'utf8'));
  const chars = a.characters.join('');
  // Die Aufnahme wird in tools/audio.py um voice.tempo beschleunigt, die Zeitmarken entsprechend gestaucht
  const k = script.voice.tempo ?? 1;
  const ws = words(chars).map(({ w, i, j }) => ({ w, s: a.character_start_times_seconds[i] / k, e: a.character_end_times_seconds[j - 1] / k }));
  return { words: ws, dur: dur / k };
}

const segs = script.segments.map((seg) => {
  const m = measured(seg);
  return { ...seg, ...(m ?? estimate(seg.text)), source: m ? 'aufnahme' : 'schaetzung' };
});

// Lücken so verteilen, dass der Spot auf script.total endet (Lücken mindestens 0,2 s).
const speech = segs.reduce((n, s) => n + s.dur, 0);
const gaps = segs.map((s) => s.gapAfter);
const fixed = script.preroll + script.tail;
const free = script.total - fixed - speech;
const gapSum = gaps.reduce((a, b) => a + b, 0);
const scale = gapSum > 0 ? Math.max(0.2 / Math.max(...gaps), free / gapSum) : 1;
let t = script.preroll;
const out = segs.map((s, k) => {
  const start = t;
  const end = start + s.dur;
  t = end + (k < segs.length - 1 ? Math.max(s.minGap ?? 0.2, s.gapAfter * scale) : 0);
  return { id: s.id, source: s.source, start, end, dur: s.dur, words: s.words.map((w) => ({ w: w.w, s: +(start + w.s).toFixed(3), e: +(start + w.e).toFixed(3) })) };
});
const total = Math.round((t + script.tail) * 30) / 30;

const cues = {};
for (const [k, seg] of script.segments.entries()) {
  const o = out[k];
  cues[`${seg.id}.start`] = +o.start.toFixed(3);
  cues[`${seg.id}.end`] = +o.end.toFixed(3);
  for (const [name, word] of Object.entries(seg.cues)) {
    const hit = o.words.find((w) => norm(w.w) === norm(word)) ?? o.words.find((w) => norm(w.w).startsWith(norm(word)));
    if (!hit) throw new Error(`Cue ${seg.id}.${name}: Wort "${word}" nicht gefunden`);
    cues[`${seg.id}.${name}`] = hit.s;
  }
}

// Szenen: Szene k beginnt kurz vor ihrem Sprechersegment und überlappt die nächste für den Übergang.
const LEAD = 0.4;
const OVERLAP = 0.7;
const sceneSegs = out.filter((o, k) => script.segments[k].scene !== false);
const scenes = sceneSegs.map((o, k) => {
  const start = k === 0 ? 0 : +(o.start - LEAD).toFixed(3);
  const next = sceneSegs[k + 1];
  const end = next ? +(next.start - LEAD + OVERLAP).toFixed(3) : total;
  return { id: o.id, start, end: Math.min(end, total) };
});

// Chat-Nachrichten der ersten Szene: immer dichter, bis zur letzten Frage (Bild und Ton lesen dieselben Zeiten)
const BUBBLES = 18;
const ev = {
  bubbles: Array.from({ length: BUBBLES }, (_, k) => +(0.35 + (cues['hook.q3'] - 0.3 - 0.35) * Math.pow(k / (BUBBLES - 1), 0.62)).toFixed(3)),
};

const timing = { total, scenes, cues, ev, segments: out };
writeFileSync(join(root, 'timing.json'), JSON.stringify(timing, null, 2) + '\n');
writeFileSync(join(root, 'timing.js'), `// Erzeugt von tools/timing.mjs, nicht von Hand ändern.\nwindow.SPOT_T = ${JSON.stringify({ total, scenes, cues, ev })};\n`);

// data-start/data-duration der Szenen und die Gesamtlänge in index.html stempeln
const indexPath = join(root, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf8');
  html = html.replace(/(data-composition-id="main"[^>]*?data-duration=")[\d.]+"/s, `$1${total}"`);
  for (const s of scenes) {
    const re = new RegExp(`(data-scene="${s.id}"[^>]*?data-start=")[\\d.]+("[^>]*?data-duration=")[\\d.]+"`, 's');
    if (!re.test(html)) throw new Error(`Szene ${s.id} in index.html nicht gefunden`);
    html = html.replace(re, `$1${s.start}$2${+(s.end - s.start).toFixed(3)}"`);
  }
  html = html.replace(/(id="mix"[^>]*?data-duration=")[\d.]+"/s, `$1${total}"`);
  writeFileSync(indexPath, html);
}

const src = [...new Set(out.map((o) => o.source))].join('+');
console.log(`Gesamtlänge ${total.toFixed(2)} s, Sprache ${speech.toFixed(2)} s, Quelle: ${src}`);
for (const o of out) console.log(`  ${o.id.padEnd(7)} ${o.start.toFixed(2).padStart(6)} - ${o.end.toFixed(2).padStart(6)}`);
