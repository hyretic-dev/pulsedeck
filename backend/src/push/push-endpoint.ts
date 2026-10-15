/**
 * Push-Dienste, an die das Backend Nachrichten schicken darf. Die Abo-Adresse stammt vom Client; ohne Prüfung
 * ließe sich das Backend per Abo auf beliebige (auch interne) Ziele lenken (SSRF).
 */
const ERLAUBTE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  'web.push.apple.com',
  '.push.apple.com',
];

export function istErlaubterPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  return ERLAUBTE_HOSTS.some((h) => (h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h));
}
