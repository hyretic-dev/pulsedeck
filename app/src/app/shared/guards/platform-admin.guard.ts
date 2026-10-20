import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/** Nur Plattformadministratoren (`auth_users.is_platform_admin`, der Server prüft es bei jedem Aufruf erneut). */
export const platformAdminGuard: CanActivateFn = async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.whenReady();
    return auth.account()?.isPlatformAdmin === true ? true : router.createUrlTree(['/dashboard']);
};
