import { maskiere, type MailContent } from '../mail/mail-templates';

import { WOCHENTAGE } from './konstanten';
import { berlinUhr, endStunde, wochentag } from './zeit';

/** „Di, 3.11.2026, 18–20 Uhr“ bzw. über mehrere Tage „Di, 3.11.2026, 18 Uhr bis Mi, 4.11.2026, 12 Uhr“. */
export function zeitraumText(start: Date, ende: Date): string {
  const b = berlinUhr(start);
  const e = berlinUhr(ende);
  const datum = (u: { jahr: number; monat: number; tag: number }) => `${WOCHENTAGE[wochentag(u.jahr, u.monat, u.tag)]}, ${u.tag}.${u.monat}.${u.jahr}`;
  const bis = endStunde(ende);
  return b.tag === e.tag && b.monat === e.monat && b.jahr === e.jahr
    ? `${datum(b)}, ${b.stunde}–${bis} Uhr`
    : `${datum(b)}, ${b.stunde} Uhr bis ${datum(e)}, ${bis} Uhr`;
}

interface MailDaten {
  planName: string;
  titel: string;
  zeitraum: string;
  link: string;
}

function baue(betreff: string, zeilen: string[], link: string, linkText: string): MailContent {
  const text = ['Hallo,', '', ...zeilen, '', `${linkText}: ${link}`, '', 'Dein PulseDeck-Team'].join('\n');
  const html = [
    '<p>Hallo,</p>',
    ...zeilen.filter(Boolean).map((z) => `<p>${maskiere(z)}</p>`),
    `<p><a href="${maskiere(link)}">${maskiere(linkText)}</a></p>`,
    '<p>Dein PulseDeck-Team</p>',
  ].join('\n');
  return { subject: betreff, text, html };
}

/** Neue Anfrage → Verwaltung und Leitung des Plans. */
export function neueAnfrageMail(d: MailDaten & { vonName: string }): MailContent {
  return baue(
    `Neue Anfrage für ${d.planName}: ${d.titel}`,
    [`${d.vonName} hat „${d.planName}“ angefragt.`, `Wofür: ${d.titel}`, `Wann: ${d.zeitraum}`, 'Du kannst die Anfrage annehmen oder ablehnen.'],
    d.link,
    'Anfragen ansehen'
  );
}

/** Entscheidung → anfragende Person. */
export function entscheidungMail(d: MailDaten & { entscheidung: 'angenommen' | 'abgelehnt' | 'automatisch_abgelehnt' | 'geloescht'; grund?: string | null }): MailContent {
  const kopf = {
    angenommen: [`Gute Nachricht: Deine Anfrage für „${d.planName}“ ist angenommen.`],
    abgelehnt: [`Deine Anfrage für „${d.planName}“ wurde leider abgelehnt.`],
    automatisch_abgelehnt: [`Deine Anfrage für „${d.planName}“ wurde abgelehnt, weil der Zeitraum anderweitig vergeben wurde.`],
    geloescht: [`Deine Belegung von „${d.planName}“ wurde gelöscht.`],
  }[d.entscheidung];
  const betreff = {
    angenommen: `Angenommen: ${d.titel}`,
    abgelehnt: `Abgelehnt: ${d.titel}`,
    automatisch_abgelehnt: `Abgelehnt: ${d.titel}`,
    geloescht: `Gelöscht: ${d.titel}`,
  }[d.entscheidung];
  return baue(betreff, [...kopf, `Wofür: ${d.titel}`, `Wann: ${d.zeitraum}`, ...(d.grund ? [`Begründung: ${d.grund}`] : [])], d.link, 'In PulseDeck ansehen');
}
