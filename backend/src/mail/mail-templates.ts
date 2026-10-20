import { LINK_VALIDITY_HOURS } from '../auth/link-validity';

import type { MailMessage } from './mail-transport';

/** Betreff und Inhalt einer Mail; der Empfänger kommt vom Aufrufer. */
export type MailContent = Omit<MailMessage, 'to'>;

export function maskiere(wert: string): string {
  return wert
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function zusammensetzen(
  betreff: string,
  einleitung: string,
  linkText: string,
  link: string,
  schluss: string
): MailContent {
  const gueltigkeit = `Der Link ist ${LINK_VALIDITY_HOURS} Stunden gültig und kann nur einmal verwendet werden.`;
  const text = [
    'Hallo,',
    '',
    einleitung,
    '',
    link,
    '',
    gueltigkeit,
    '',
    schluss,
    '',
    'Dein PulseDeck-Team',
  ].join('\n');
  const html = [
    '<p>Hallo,</p>',
    `<p>${maskiere(einleitung)}</p>`,
    `<p><a href="${maskiere(link)}">${maskiere(linkText)}</a></p>`,
    `<p>Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${maskiere(link)}</p>`,
    `<p>${maskiere(gueltigkeit)}</p>`,
    `<p>${maskiere(schluss)}</p>`,
    '<p>Dein PulseDeck-Team</p>',
  ].join('\n');
  return { subject: betreff, text, html };
}

export function verificationMail(link: string): MailContent {
  return zusammensetzen(
    'Bitte bestätige deine E-Mail-Adresse bei PulseDeck',
    'bitte bestätige deine E-Mail-Adresse, um dein PulseDeck-Konto zu aktivieren.',
    'E-Mail-Adresse bestätigen',
    link,
    'Wenn du dich nicht bei PulseDeck registriert hast, kannst du diese Mail ignorieren.'
  );
}

export function magicLinkMail(link: string): MailContent {
  return zusammensetzen(
    'Dein Anmelde-Link für PulseDeck',
    'mit diesem Link meldest du dich bei PulseDeck an, ohne ein Passwort einzugeben.',
    'Bei PulseDeck anmelden',
    link,
    'Wenn du diesen Link nicht angefordert hast, kannst du diese Mail ignorieren.'
  );
}

export function invitationMail(link: string, organizationName: string): MailContent {
  return zusammensetzen(
    `Einladung zu ${organizationName} bei PulseDeck`,
    `du wurdest zu „${organizationName}“ bei PulseDeck eingeladen. Mit diesem Link meldest du dich an, ohne ein Passwort einzugeben.`,
    'Einladung annehmen',
    link,
    'Wenn du diese Einladung nicht erwartet hast, kannst du diese Mail ignorieren.'
  );
}

export function passwordResetMail(link: string): MailContent {
  return zusammensetzen(
    'Passwort für PulseDeck zurücksetzen',
    'über diesen Link kannst du ein neues Passwort für dein PulseDeck-Konto festlegen.',
    'Neues Passwort festlegen',
    link,
    'Wenn du das Zurücksetzen nicht angefordert hast, kannst du diese Mail ignorieren; dein Passwort bleibt unverändert.'
  );
}

export interface GastEinladung {
  gastName: string | null;
  gastgeber: string;
  titel: string;
  datum: string;
  beginn: string | null;
  ort: string | null;
  link: string;
}

/** Einladung einer Gastorganisation zu einem Termin (Ersatz für die Mail der Edge Function send-guest-invitation). */
export function gastEinladungMail(e: GastEinladung): MailContent {
  const zeilen = [`Datum: ${e.datum}`, `Beginn: ${e.beginn ? `${e.beginn} Uhr` : 'wird bekannt gegeben'}`, `Ort: ${e.ort || 'wird bekannt gegeben'}`];
  const anrede = e.gastName ? `Hallo ${e.gastName},` : 'Hallo,';
  const einleitung = `${e.gastgeber} lädt euch herzlich zu diesem Termin ein: ${e.titel}`;
  const text = [anrede, '', einleitung, '', ...zeilen, '', `Details ansehen: ${e.link}`, '', 'Diese Einladung wurde über PulseDeck versendet.'].join('\n');
  const html = [
    `<p>${maskiere(anrede)}</p>`,
    `<p>${maskiere(einleitung)}</p>`,
    `<ul>${zeilen.map((z) => `<li>${maskiere(z)}</li>`).join('')}</ul>`,
    `<p><a href="${maskiere(e.link)}">Termin-Details ansehen</a></p>`,
    '<p>Diese Einladung wurde über PulseDeck versendet.</p>',
  ].join('\n');
  return { subject: `Einladung von ${e.gastgeber}: ${e.titel}`, text, html };
}

/** Absätze aus Leerzeilen; einzelne Zeilenumbrüche bleiben als <br> erhalten. */
function absaetze(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((a) => `<p>${maskiere(a.trim()).replaceAll('\n', '<br>')}</p>`)
    .join('\n');
}

/** Persönliche Rückmeldung auf eine Meldung („ist jetzt live“); der Text kommt vom Plattformadministrator. */
export function feedbackRueckmeldungMail(text: string, ursprung: string): MailContent {
  const zitat = ursprung.trim().slice(0, 500);
  const klartext = [
    text.trim(),
    '',
    'Deine Meldung damals:',
    ...zitat.split('\n').map((z) => `> ${z}`),
    '',
    'Danke, dass du PulseDeck mitgestaltest.',
    '',
    'Dein PulseDeck-Team',
  ].join('\n');
  const html = [
    absaetze(text),
    `<p><em>Deine Meldung damals:</em></p><blockquote>${maskiere(zitat).replaceAll('\n', '<br>')}</blockquote>`,
    '<p>Danke, dass du PulseDeck mitgestaltest.</p>',
    '<p>Dein PulseDeck-Team</p>',
  ].join('\n');
  return { subject: 'Rückmeldung zu deinem Feedback bei PulseDeck', text: klartext, html };
}
