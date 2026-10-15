import { MailDeliveryError, type MailMessage, type MailTransport } from './mail-transport';

export interface ResendTransportOptions {
  apiKey: string;
  from: string;
  endpoint?: string;
  timeoutMs?: number;
}

const STANDARD_ENDPOINT = 'https://api.resend.com/emails';
const STANDARD_TIMEOUT_MS = 10_000;

/** Versand über die Resend-HTTP-API (POST /emails, Bearer-Key). */
export class ResendMailTransport implements MailTransport {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResendTransportOptions) {
    this.endpoint = options.endpoint ?? STANDARD_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? STANDARD_TIMEOUT_MS;
  }

  async send(message: MailMessage): Promise<void> {
    let antwort: Response;
    try {
      antwort = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (fehler) {
      // Die Rohmeldung kann Host/URL enthalten; nur die Art des Fehlers weitergeben.
      const zeitueberschreitung = fehler instanceof Error && fehler.name === 'TimeoutError';
      throw new MailDeliveryError(
        zeitueberschreitung ? 'Resend: Zeitüberschreitung' : 'Resend nicht erreichbar'
      );
    }

    if (!antwort.ok) {
      const grund = await leseProviderMeldung(antwort);
      throw new MailDeliveryError(
        `Resend antwortete mit HTTP ${antwort.status}${grund ? `: ${grund}` : ''}`
      );
    }
  }
}

async function leseProviderMeldung(antwort: Response): Promise<string> {
  try {
    const koerper: unknown = await antwort.json();
    const meldung = (koerper as { message?: unknown }).message;
    return typeof meldung === 'string' ? meldung.slice(0, 200) : '';
  } catch {
    return '';
  }
}
