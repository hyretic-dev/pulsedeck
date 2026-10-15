import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { apiFehler } from '../common/http-error';

/** Übliche Mail-Ports; verhindert, dass ein SMTP-Ziel zum Portscanner wird. */
export const ERLAUBTE_SMTP_PORTS = [25, 465, 587, 2525] as const;

function ipv4Privat(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Loopback, private, Link-Local-, Carrier-NAT-, Multicast- und reservierte Adressen (IPv4 und IPv6). */
export function istNichtOeffentlich(adresse: string): boolean {
  const art = isIP(adresse);
  if (art === 4) {
    const [a, b] = adresse.split('.').map(Number);
    return ipv4Privat(a, b);
  }
  if (art === 6) {
    const klein = adresse.toLowerCase();
    const abgebildet = klein.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (abgebildet) return istNichtOeffentlich(abgebildet[1]);
    return klein === '::' || klein === '::1' || /^f[cd]/.test(klein) || /^fe[89ab]/.test(klein) || klein.startsWith('ff') || klein.startsWith('64:ff9b:') || klein.startsWith('2001:db8');
  }
  return true;
}

/**
 * Prüft ein vom Nutzer angegebenes SMTP-Ziel und liefert die aufgelöste Adresse, mit der verbunden werden soll
 * (kein erneutes Auflösen zwischen Prüfung und Verbindung: Schutz vor DNS-Rebinding).
 * Private Ziele sind nur mit `erlaubePrivat` (Betreiberentscheidung) zulässig.
 */
export async function pruefeSmtpZiel(host: string, port: number, erlaubePrivat: boolean): Promise<{ adresse: string }> {
  if (!(ERLAUBTE_SMTP_PORTS as readonly number[]).includes(port)) {
    throw apiFehler(400, 'smtp_port_not_allowed', `Erlaubte SMTP-Ports: ${ERLAUBTE_SMTP_PORTS.join(', ')}`);
  }
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || host.startsWith('-')) {
    throw apiFehler(400, 'smtp_host_invalid', 'Der SMTP-Server ist kein gültiger Hostname');
  }
  let adressen: Array<{ address: string }>;
  try {
    adressen = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw apiFehler(400, 'smtp_host_unresolvable', 'Der SMTP-Server ist nicht erreichbar (Namensauflösung fehlgeschlagen)');
  }
  if (adressen.length === 0) throw apiFehler(400, 'smtp_host_unresolvable', 'Der SMTP-Server ist nicht erreichbar (Namensauflösung fehlgeschlagen)');
  if (!erlaubePrivat && adressen.some((a) => istNichtOeffentlich(a.address))) {
    throw apiFehler(400, 'smtp_host_not_allowed', 'Der SMTP-Server liegt in einem nicht öffentlichen Netz und ist nicht erlaubt');
  }
  return { adresse: adressen[0].address };
}
