import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from '../../core/session.service';
import { AuthService } from '../services/auth.service';
import { OrganizationService } from '../services/organization.service';

/**
 * Guard that loads the organization by slug from the URL, stores it in the OrganizationService and
 * makes it the active organization of the signed-in member. Access control itself happens in the
 * backend (every request checks the membership); this guard only provides the routing experience.
 */
export const organizationGuard: CanActivateFn = async (route, state) => {
    const orgService = inject(OrganizationService);
    const auth = inject(AuthService);
    const session = inject(SessionService);
    const router = inject(Router);

    // Get slug from route or parent route
    let slug = route.paramMap.get('slug');
    if (!slug && route.parent) {
        slug = route.parent.paramMap.get('slug');
    }

    if (!slug) {
        router.navigate(['/']);
        return false;
    }

    if (!session.istAngemeldet()) {
        // Redirect to login, then back to intended destination
        router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
        return false;
    }

    // Konto und Mitgliedschaften sind geladen, bevor entschieden wird
    await auth.whenReady();
    if (!session.istAngemeldet()) {
        router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
        return false;
    }

    // Load organization
    const loaded = await orgService.loadBySlug(slug);
    if (!loaded) {
        // Organization not found - redirect to public page or home
        router.navigate(['/', slug]);
        return false;
    }

    const orgId = orgService.currentOrgId();
    if (!orgId) {
        return false;
    }

    if (!auth.getMembershipForOrg(orgId)) {
        console.warn('Zugriff verweigert: Kein Mitglied dieser Organisation');
        router.navigate(['/organisationen']);
        return false;
    }

    if (auth.currentOrgId() !== orgId || !auth.currentMember()) {
        await auth.setActiveOrganization(orgId);
    }
    return true;
};
