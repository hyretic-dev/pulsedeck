import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const issueTrackerGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.hasPermission('view_issue_tracker')) {
        return true;
    }

    return router.createUrlTree(['/dashboard']);
};
