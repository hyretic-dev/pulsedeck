export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export type PlanRolle = 'lead' | 'manager' | 'requester';
export type BuchungsStatus = 'requested' | 'approved' | 'declined' | 'cancelled';

/** Grund, der beim Annehmen für überschneidende offene Anfragen gespeichert wird. */
export const GRUND_ANDERWEITIG_VERGEBEN = 'Zeitraum anderweitig vergeben';

export const MAX_DAUER_TAGE = 14;
