import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthError } from '../auth/auth.error';

/** Einheitlicher Fehlervertrag: HTTP-Status korrekt, Body immer { code, message }. */
const CODES_NACH_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'internal_error',
};

@Catch()
export class ErrorContractFilter implements ExceptionFilter {
  private readonly logger = new Logger('Fehler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AuthError) {
      response
        .status(exception.status)
        .json({ code: exception.code, message: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
        response.status(status).json({ code: body.code, message: body.message });
        return;
      }
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: unknown[] }).message[0] as string)
            : ((body as { message?: unknown }).message as string | undefined) ??
              exception.message;
      response
        .status(status)
        .json({ code: CODES_NACH_STATUS[status] ?? 'error', message });
      return;
    }

    // Unbekannte Fehler: Details nur ins Server-Log (keine Secrets nach außen), mit Request-ID zur Korrelation.
    const requestId = host.switchToHttp().getRequest<{ requestId?: string }>().requestId;
    this.logger.error(
      `Unbehandelter Fehler${requestId ? ` (requestId=${requestId})` : ''}`,
      exception instanceof Error ? exception.stack : undefined
    );
    response.status(500).json({ code: 'internal_error', message: 'Interner Serverfehler' });
  }
}
