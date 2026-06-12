import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OrganizationService } from '../services/organization.service';
import { SupabaseService } from '../services/supabase';

/**
 * Guard that loads the organization by slug from the URL
 * and stores it in the OrganizationService.
 * Also checks if user is authenticated.
 */
export const organizationGuard: CanActivateFn = async (route) => {
    const orgService = inject(OrganizationService);
    const supabase = inject(SupabaseService);
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

    // Check if user is authenticated (wait for session)
    const { data: { session } } = await supabase.client.auth.getSession();

    if (!session) {
        // Redirect to login, then back to intended destination
        router.navigate(['/login']);
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

    // Direct database check for membership to prevent race conditions
    // and enforce strict access control
    const { data, error } = await supabase.client
        .from('members')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', session.user.id)
        .single();

    if (error || !data) {
        console.warn('Zugriff verweigert: Kein Mitglied dieser Organisation');
        router.navigate(['/organisationen']);
        return false;
    }

    return true;
};
