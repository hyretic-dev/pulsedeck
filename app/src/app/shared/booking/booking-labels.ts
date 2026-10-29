import type { BuchungsStatus } from './booking.models';

export const MONATSNAMEN = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

export const MONATSKUERZEL = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'] as const;

/** Index 0 = Montag, passend zu `wochentag()`. */
export const WOCHENTAG_KUERZEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const WOCHENTAG_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'] as const;

export const STATUS_TEXT: Record<BuchungsStatus, string> = {
    requested: 'angefragt',
    approved: 'bestätigt',
    declined: 'abgelehnt',
    cancelled: 'storniert',
};

export function uhrzeit(stunde: number): string {
    return `${String(stunde).padStart(2, '0')}:00`;
}
