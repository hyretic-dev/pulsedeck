import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from '../../core/session.service';

/** Startadresse der Anwendung (app.…/): Angemeldete landen bei ihren Organisationen, alle anderen bei der Anmeldung. */
export const startGuard: CanActivateFn = () => {
    const router = inject(Router);
    return router.createUrlTree([inject(SessionService).istAngemeldet() ? '/organisationen' : '/login']);
};
