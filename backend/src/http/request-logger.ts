import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/** Gültiges Format einer vom Proxy übernommenen Request-ID (verhindert Log-Injection über den Header). */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export type RequestWithContext = Request & { requestId?: string; userId?: string };

/**
 * Vergibt je Anfrage eine Request-ID (übernimmt `X-Request-Id` des Proxys, wenn sie gültig ist),
 * liefert sie im Antwort-Header zurück und schreibt nach der Antwort **eine JSON-Zeile**:
 * Zeit, ID, Methode, Pfad ohne Query-String, Status, Dauer, Konto-ID (nur aus dem verifizierten Token).
 *
 * Bewusst nicht geloggt: Query-String, Header (Authorization, Cookie), Body, IP-Adressen, E-Mails.
 * Einlöse-Links, Kalender-Token und Passwörter dürfen nie in Logs landen (Gesamtauftrag §5, §10).
 */
export function requestLogger(write: (zeile: string) => void) {
  return (request: RequestWithContext, response: Response, next: NextFunction): void => {
    const eingehend = request.headers['x-request-id'];
    const requestId =
      typeof eingehend === 'string' && REQUEST_ID.test(eingehend) ? eingehend : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    const start = performance.now();
    response.on('finish', () => {
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level: 'info',
          msg: 'http_request',
          requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          status: response.statusCode,
          durationMs: Math.round(performance.now() - start),
          ...(request.userId ? { userId: request.userId } : {}),
        })
      );
    });
    next();
  };
}
