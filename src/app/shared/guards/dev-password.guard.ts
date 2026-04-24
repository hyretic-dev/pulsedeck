import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../../environments/environment';

const DEV_PASSWORD = 'pulsedeck2026'; // Einfaches Dev-Passwort
const STORAGE_KEY = 'dev_access_granted';

/**
 * Guard für Entwicklungs-Passwortschutz
 * Verhindert öffentlichen Zugang während der Development-Phase
 */
export const devPasswordGuard: CanActivateFn = () => {
    const router = inject(Router);

    // In Development temporär deaktiviert für einfacheres Testen
    if (!environment.production) return true;

    const accessGranted = sessionStorage.getItem(STORAGE_KEY);

    if (accessGranted === 'true') {
        return true;
    }

    return router.createUrlTree(['/dev-access']);
};

/**
 * Prüft ob Dev-Zugang gewährt ist
 */
export function isDevAccessGranted(): boolean {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Gewährt Dev-Zugang mit Passwort
 */
export function grantDevAccess(password: string): boolean {
    if (password === DEV_PASSWORD) {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        return true;
    }
    return false;
}
