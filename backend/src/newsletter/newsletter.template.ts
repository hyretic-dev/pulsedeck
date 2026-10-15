import { maskiere } from '../mail/mail-templates';

export interface NewsletterBeitrag {
  title: string;
  content: string | null;
  url: string | null;
  created_at: Date;
  author_name: string | null;
}

export interface NewsletterGestaltung {
  organisation: string;
  logo_url: string | null;
  footer_text: string | null;
  primary_color: string | null;
  appBaseUrl: string;
}

const istHttp = (wert: string | null | undefined): wert is string => !!wert && /^https?:\/\/\S+$/.test(wert);
const farbe = (wert: string | null): string => (wert && /^#[0-9a-fA-F]{6}$/.test(wert) ? wert : '#DE0000');

function vorschau(inhalt: string | null): string {
  const text = (inhalt ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 150 ? `${text.slice(0, 150)}…` : text;
}

/**
 * Newsletter als einfache, barrierearme Linkliste. Alle Inhalte (Titel, Autor, Vorschau, Fußzeile) werden maskiert
 * und Adressen nur als http(s) übernommen: Der Bestand fügte Titel unmaskiert in das HTML ein (Inhaltseinschleusung).
 */
export function newsletterMail(beitraege: NewsletterBeitrag[], g: NewsletterGestaltung): { subject: string; text: string; html: string } {
  const f = farbe(g.primary_color);
  const fallback = `${g.appBaseUrl}/dashboard/feed`;
  const zeilen = beitraege.map((b) => {
    const link = istHttp(b.url) ? b.url : fallback;
    const datum = b.created_at.toLocaleDateString('de-DE', { timeZone: 'UTC' });
    const vor = vorschau(b.content);
    return { b, link, datum, vor };
  });
  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${maskiere(g.organisation)} Newsletter</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:4px;">
<tr><td style="padding:24px;border-bottom:2px solid ${f};">${istHttp(g.logo_url) ? `<img src="${maskiere(g.logo_url)}" alt="${maskiere(g.organisation)}" style="max-height:40px;max-width:150px;">` : `<span style="font-size:24px;font-weight:bold;color:${f};">${maskiere(g.organisation)}</span>`}</td></tr>
<tr><td style="padding:24px 24px 8px;"><h1 style="margin:0;font-size:20px;color:#333;">Neue Beiträge</h1><p style="margin:8px 0 0;color:#666;font-size:14px;">Hier sind die neuesten Artikel und Links für dich:</p></td></tr>
<tr><td style="padding:0 24px;"><table width="100%" cellpadding="0" cellspacing="0">${zeilen
    .map(
      ({ b, link, datum, vor }) => `
<tr><td style="padding:12px 0;border-bottom:1px solid #eee;"><a href="${maskiere(link)}" style="color:${f};text-decoration:none;font-weight:600;font-size:16px;">${maskiere(b.title)}</a><br><small style="color:#666;">${maskiere(datum)} - ${maskiere(b.author_name ?? 'Unbekannt')}</small>${vor ? `<p style="margin:8px 0 0;color:#333;line-height:1.5;">${maskiere(vor)}</p>` : ''}</td></tr>`
    )
    .join('')}
</table></td></tr>
<tr><td style="padding:24px;text-align:center;border-top:1px solid #eee;"><small style="color:#999;font-size:12px;">${maskiere(g.footer_text ?? g.organisation)}</small></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Neue Beiträge von ${g.organisation}`,
    '',
    ...zeilen.map(({ b, link, datum, vor }) => `- ${b.title} (${datum}, ${b.author_name ?? 'Unbekannt'})\n  ${link}${vor ? `\n  ${vor}` : ''}`),
    '',
    g.footer_text ?? g.organisation,
  ].join('\n');
  return { subject: `Neue Beiträge von ${g.organisation} (${beitraege.length})`, text, html };
}
