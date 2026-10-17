import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (auth.isAdmin()) {
        return true;
    }

    // Redirect to dashboard if not admin
    router.navigate(['/dashboard']);
    return false;
};
