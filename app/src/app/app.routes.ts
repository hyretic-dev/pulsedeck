import { Routes } from '@angular/router';
import { adminGuard } from './shared/guards/admin.guard';
import { issueTrackerGuard } from './shared/guards/issue-tracker.guard';

import { organizationGuard } from './shared/guards/organization.guard';
import { startGuard } from './shared/guards/start.guard';

export const routes: Routes = [
    // Startseite der Anwendung: leitet je nach Anmeldung weiter. Die Produktseite (Startseite, Handbuch, Impressum, Datenschutz)
    // ist eine eigene Website (Ordner website/) und nicht Teil der Anwendung.
    {
        path: '',
        pathMatch: 'full',
        canActivate: [startGuard],
        children: []
    },

    // Auth
    {
        path: 'login', title: 'Anmelden',

        loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent)
    },
    {
        path: 'auth/callback', title: 'Anmeldung',
        loadComponent: () => import('./features/auth/auth-callback.component').then(m => m.AuthCallbackComponent)
    },

    // Organization Management
    {
        path: 'registrieren', title: 'Registrieren',

        loadComponent: () => import('./features/organizations/register-organization.component').then(m => m.RegisterOrganizationComponent)
    },
    {
        path: 'erstellen', title: 'Organisation anlegen',

        loadComponent: () => import('./features/organizations/create-organization/create-organization.component').then(m => m.CreateOrganizationComponent)
    },
    {
        path: 'organisationen', title: 'Organisation wählen',

        loadComponent: () => import('./features/organizations/select-organization.component').then(m => m.SelectOrganizationComponent)
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
                    { path: '', title: 'Dashboard', loadComponent: () => import('./features/dashboard/dashboard-home/dashboard-home').then(m => m.DashboardHome) },
                    { path: 'feed', title: 'Aktuelles', loadComponent: () => import('./features/dashboard/feed/feed').then(m => m.FeedComponent) },
                    { path: 'wiki', title: 'Wiki', loadComponent: () => import('./features/dashboard/wiki/wiki').then(m => m.WikiComponent) },
                    { path: 'members', title: 'Mitglieder', canActivate: [adminGuard], loadComponent: () => import('./features/dashboard/members/members').then(m => m.MembersComponent) },
                    { path: 'calendar', title: 'Termine', loadComponent: () => import('./features/dashboard/calendar/calendar').then(m => m.CalendarComponent) },
                    { path: 'gruppen', title: 'Gruppen', loadComponent: () => import('./features/dashboard/working-groups/working-groups').then(m => m.WorkingGroupsComponent) },
                    { path: 'contacts', title: 'Kontakte', loadComponent: () => import('./features/dashboard/contacts/contacts').then(m => m.ContactsComponent) },
                    { path: 'files', title: 'Dateien', loadComponent: () => import('./features/dashboard/files/files.component').then(m => m.FilesComponent) },
                    { path: 'profile', title: 'Profil', loadComponent: () => import('./features/dashboard/profile/profile').then(m => m.ProfileComponent) },
                    { path: 'issue-tracker', title: 'Feedback', canActivate: [issueTrackerGuard], loadComponent: () => import('./features/dashboard/issue-tracker/issue-tracker.component').then(m => m.IssueTrackerComponent) },
                    { path: 'roadmap', title: 'Roadmap', loadComponent: () => import('./features/dashboard/roadmap/roadmap.component').then(m => m.RoadmapComponent) },
                    { path: 'settings', title: 'Einstellungen', canActivate: [adminGuard], loadComponent: () => import('./features/dashboard/settings/settings').then(m => m.SettingsComponent) },
                    { path: 'logs', redirectTo: 'audit' }, // Alias
                    { path: 'audit', title: 'Änderungsprotokoll', loadComponent: () => import('./features/dashboard/logs/logs.component').then(m => m.LogsComponent) }
                ]
            }
        ]
    }
];
