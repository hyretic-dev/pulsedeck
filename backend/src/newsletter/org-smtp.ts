import type { Queryable } from '../common/db';
import type { SecretBox } from '../common/secret-box';
import { SmtpMailTransport } from '../mail/smtp.transport';
import { pruefeSmtpZiel } from '../mail/smtp-host-guard';
import type { MailTransport } from '../mail/mail-transport';

export const newsletterKontext = (orgId: string): string => `newsletter:${orgId}`;

/**
 * Baut den SMTP-Transport der Organisation aus `newsletter_config` oder liefert null, wenn dort kein Server
 * eingetragen ist. Das Ziel wird vor jeder Nutzung erneut geprüft und per aufgelöster Adresse angesprochen
 * (TLS-Prüfung weiter gegen den Hostnamen), damit ein später geänderter DNS-Eintrag keinen internen Zugriff ermöglicht.
 */
export async function baueOrgTransport(db: Queryable, orgId: string, geheimnisse: SecretBox, erlaubePrivat: boolean): Promise<MailTransport | null> {
  const { rows } = await db.query(
    'SELECT smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_from, smtp_secure FROM newsletter_config WHERE organization_id = $1',
    [orgId]
  );
  const c = rows[0];
  if (!c?.smtp_host) return null;
  const port = c.smtp_port ?? 587;
  const ziel = await pruefeSmtpZiel(c.smtp_host, port, erlaubePrivat);
  const passwort = c.smtp_pass_encrypted ? geheimnisse.open(c.smtp_pass_encrypted, newsletterKontext(orgId)) : undefined;
  return new SmtpMailTransport({
    host: ziel.adresse,
    port,
    secure: c.smtp_secure ?? port === 465,
    ...(c.smtp_user && passwort !== undefined ? { user: c.smtp_user, password: passwort } : {}),
    from: c.smtp_from,
    tls: { servername: c.smtp_host },
  });
}
