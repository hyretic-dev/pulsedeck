import { HttpException } from '@nestjs/common';

/** Fachlicher Fehler im einheitlichen Vertrag `{ code, message }` (E18). */
export function apiFehler(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

export const nichtGefunden = (was: string) => apiFehler(404, 'not_found', `${was} nicht gefunden`);
export const verboten = (message = 'Keine Berechtigung') => apiFehler(403, 'forbidden', message);
export const ungueltig = (message: string) => apiFehler(400, 'validation_failed', message);
export const konflikt = (code: string, message: string) => apiFehler(409, code, message);
