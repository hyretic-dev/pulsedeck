import { Routes } from '@angular/router';
import { adminGuard } from './shared/guards/admin.guard';
import { issueTrackerGuard } from './shared/guards/issue-tracker.guard';

import { organizationGuard } from './shared/guards/organization.guard';

export const routes: Routes = [
    // Dev Access
    {
        path: 'dev-access',
        loadComponent: () => import('./features/auth/dev-access.component').then(m => m.DevAccessComponent)
    },

    // Public Landing
    {
        path: '',

        loadComponent: () => import('./features/public/landing-page/landing-page').then(m => m.LandingPage)
    },

    // Auth
    {
        path: 'login',

        loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent)
    },
    {
        path: 'auth/callback',
        loadComponent: () => import('./features/auth/auth-callback.component').then(m => m.AuthCallbackComponent)
    },

    // Organization Management
    {
        path: 'registrieren',

        loadComponent: () => import('./features/organizations/register-organization.component').then(m => m.RegisterOrganizationComponent)
    },
    {
        path: 'erstellen',

        loadComponent: () => import('./features/organizations/create-organization/create-organization.component').then(m => m.CreateOrganizationComponent)
    },
    {
        path: 'organisationen',

        loadComponent: () => import('./features/organizations/select-organization.component').then(m => m.SelectOrganizationComponent)
    },

    // Legal Pages
    {
        path: 'impressum',

        loadComponent: () => import('./features/legal/impressum.component').then(m => m.ImpressumComponent)
    },
    {
        path: 'datenschutz',

        loadComponent: () => import('./features/legal/datenschutz.component').then(m => m.DatenschutzComponent)
    },
    {
        path: 'docs',
        loadComponent: () => import('./features/public/docs/docs.component').then(m => m.DocsComponent)
    },

    // Legacy dashboard route (redirect to organization select)
    {
        path: 'dashboard',
        redirectTo: 'organisationen',
        pathMatch: 'full'
    },

    // Public Event Details
    {
        path: 'event/:id',
        loadComponent: () => import('./features/public/event-details/event-details.component').then(m => m.EventDetailsComponent)
    },

    // Organization Routes (/:slug/...)
    {
        path: ':slug',

        children: [
            // Public landing page for the organization
            {
                path: '',
                loadComponent: () => import('./features/organizations/org-public-page/org-public-page.component').then(m => m.OrgPublicPageComponent)
            },
            // Internal dashboard (protected)
            {
                path: 'dashboard',
                canActivate: [organizationGuard],
                loadComponent: () => import('./layout/main-layout/main-layout').then(m => m.MainLayout),
                children: [
                    { path: '', loadComponent: () => import('./features/dashboard/dashboard-home/dashboard-home').then(m => m.DashboardHome) },
                    { path: 'feed', loadComponent: () => import('./features/dashboard/feed/feed').then(m => m.FeedComponent) },
                    { path: 'wiki', loadComponent: () => import('./features/dashboard/wiki/wiki').then(m => m.WikiComponent) },
                    { path: 'members', canActivate: [adminGuard], loadComponent: () => import('./features/dashboard/members/members').then(m => m.MembersComponent) },
                    { path: 'calendar', loadComponent: () => import('./features/dashboard/calendar/calendar').then(m => m.CalendarComponent) },
                    { path: 'gruppen', loadComponent: () => import('./features/dashboard/working-groups/working-groups').then(m => m.WorkingGroupsComponent) },
                    { path: 'files', loadComponent: () => import('./features/dashboard/files/files.component').then(m => m.FilesComponent) },
                    { path: 'profile', loadComponent: () => import('./features/dashboard/profile/profile').then(m => m.ProfileComponent) },
                    { path: 'issue-tracker', canActivate: [issueTrackerGuard], loadComponent: () => import('./features/dashboard/issue-tracker/issue-tracker.component').then(m => m.IssueTrackerComponent) },
                    { path: 'roadmap', loadComponent: () => import('./features/dashboard/roadmap/roadmap.component').then(m => m.RoadmapComponent) },
                    { path: 'settings', canActivate: [adminGuard], loadComponent: () => import('./features/dashboard/settings/settings').then(m => m.SettingsComponent) },
                    { path: 'logs', redirectTo: 'audit' }, // Alias
                    { path: 'audit', loadComponent: () => import('./features/dashboard/logs/logs.component').then(m => m.LogsComponent) }
                ]
            }
        ]
    }
];
