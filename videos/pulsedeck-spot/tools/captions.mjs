// Deutsche Untertitel (WebVTT) aus den Wortzeiten der Sprecherin: ein Satz je Untertitel,
// lange Sätze werden an Kommas geteilt. Angezeigt wird der Text aus vo/script.json, nicht die Sprechfassung
// ("Mikrotasks" statt "Mikro-Tasks"); beide haben gleich viele Wörter.
//   node tools/captions.mjs <ausgabe.vtt>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const timing = JSON.parse(readFileSync(join(root, 'timing.json'), 'utf8'));
const script = JSON.parse(readFileSync(join(root, 'vo/script.json'), 'utf8'));
const MAX = 42; // Zeichen je Zeile, höchstens zwei Zeilen

const ts = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
};

// Zwei ausgewogene Zeilen, umbrochen an einer Wortgrenze
function lines(text) {
  if (text.length <= MAX) return text;
  const words = text.split(' ');
  let best = text;
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const sc = Math.abs(a.length - b.length) + (Math.max(a.length, b.length) > MAX ? 100 : 0);
    if (sc < score) { score = sc; best = `${a}\n${b}`; }
  }
  return best;
}

const cues = [];
for (const seg of timing.segments) {
  const shown = script.segments.find((s) => s.id === seg.id).text.split(/\s+/);
  const words = seg.words.map((w, i) => ({ ...w, w: shown.length === seg.words.length ? shown[i] : w.w }));
  let cur = [];
  const flush = () => {
    if (cur.length) cues.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(' ') });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const len = cur.map((x) => x.w).join(' ').length;
    if (/[.?!:]$/.test(w.w) || (/,$/.test(w.w) && len > MAX)) flush();
  }
  flush();
}

// Untertitel stehen bis kurz vor den nächsten, aber nicht länger als 1,2 s nach dem letzten Wort
const out = ['WEBVTT', ''];
cues.forEach((c, i) => {
  const next = cues[i + 1];
  const end = Math.min(c.e + 1.2, next ? next.s - 0.05 : c.e + 1.2);
  out.push(String(i + 1), `${ts(c.s)} --> ${ts(Math.max(end, c.e))}`, lines(c.text), '');
});
writeFileSync(process.argv[2], out.join('\n'));
console.log(`${cues.length} Untertitel -> ${process.argv[2]}`);
