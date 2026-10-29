import { TestBed } from '@angular/core/testing';

import { ApiService } from '../../core/api.service';
import { ContactsService } from './contacts.service';
import { EventsService } from './events.service';
import { MembersService } from './members.service';
import { OrganizationService } from './organization.service';
import { WikiService } from './wiki.service';
import { WorkingGroupsService } from './working-groups.service';

/**
 * Das Backend lehnt unbekannte Felder und ungültige Formate ab (Whitelist-Validierung). Diese Tests sichern, dass die
 * Oberflächen-Dienste nur erlaubte Felder senden und leere Eingabefelder als „nicht gesetzt“ (null) statt als ''.
 */
describe('Nutzlasten der API-Dienste', () => {
    let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        api = { get: vi.fn().mockResolvedValue([]), post: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) };
        TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
        TestBed.inject(OrganizationService).currentOrganization.set({ id: 'org-1', slug: 'a', name: 'A', primary_color: '#fff', subscription_tier: 'free', max_members: 10 });
    });

    it('Termine: sendet keine Fremdfelder (AG-Name, Organisation) und macht aus leerem Ende/Ort-Typ null', async () => {
        const events = TestBed.inject(EventsService);

        await events.updateEvent('e1', { title: 'Treffen', end_time: '', location_type: '', description: '', ag_name: 'Fremd', organization_id: 'x', id: 'e1' } as never);
        await events.addEvent({ title: 'Neu', date: '2026-11-01', start_time: '19:00', location: 'Halle', end_time: '', ag_name: 'Fremd', location_type: null, is_recurring: false } as never);

        expect(api.patch).toHaveBeenCalledWith('/orgs/org-1/events/e1', { title: 'Treffen', end_time: null, location_type: null, description: null });
        expect(api.post).toHaveBeenCalledWith('/orgs/org-1/events', { title: 'Neu', date: '2026-11-01', start_time: '19:00', location: 'Halle' });
    });

    it('Termine: sendet den Belegungsplan nur, wenn er gesetzt ist; null entfernt eine Reservierung, nicht gesetzt lässt sie unverändert', async () => {
        const events = TestBed.inject(EventsService);

        await events.addEvent({ title: 'Mit Ort', date: '2026-11-01', start_time: '19:00', end_time: '21:00', location: '', location_type: 'onsite', booking_calendar_id: 'p1', booking: { id: 'b' } } as never);
        expect(api.post).toHaveBeenLastCalledWith('/orgs/org-1/events', { title: 'Mit Ort', date: '2026-11-01', start_time: '19:00', end_time: '21:00', location: '', location_type: 'onsite', booking_calendar_id: 'p1' });

        await events.updateEvent('e1', { title: 'Nur Titel', booking: { id: 'b' } } as never);
        expect(api.patch).toHaveBeenLastCalledWith('/orgs/org-1/events/e1', { title: 'Nur Titel' });

        await events.updateEvent('e1', { booking_calendar_id: null } as never);
        expect(api.patch).toHaveBeenLastCalledWith('/orgs/org-1/events/e1', { booking_calendar_id: null });
    });

    it('Organisation anlegen: Herkunft und Pilot-Wunsch nur senden, wenn angegeben; leerer Wunschzeitraum entfällt', async () => {
        const orgs = TestBed.inject(OrganizationService);

        await orgs.create('Ortsverband Nord', 'ov nord', 'Dora');
        await orgs.create('Ortsverband Süd', 'ov-sued', undefined, { acquisition_source: 'workshop', acquisition_ref: 'kv-nord', pilot_requested: true, pilot_wish: '  abends  ' });
        await orgs.create('Verein Ost', 'verein-ost', undefined, { acquisition_source: 'blog', pilot_requested: false, pilot_wish: 'wird ignoriert' });
        await orgs.create('Verein West', 'verein-west', undefined, { acquisition_source: 'suche', pilot_requested: true, pilot_wish: '   ' });

        expect(api.post).toHaveBeenNthCalledWith(1, '/orgs', { name: 'Ortsverband Nord', slug: 'ov-nord', owner_name: 'Dora' });
        expect(api.post).toHaveBeenNthCalledWith(2, '/orgs', { name: 'Ortsverband Süd', slug: 'ov-sued', acquisition_source: 'workshop', acquisition_ref: 'kv-nord', pilot_requested: true, pilot_wish: 'abends' });
        expect(api.post).toHaveBeenNthCalledWith(3, '/orgs', { name: 'Verein Ost', slug: 'verein-ost', acquisition_source: 'blog' });
        expect(api.post).toHaveBeenNthCalledWith(4, '/orgs', { name: 'Verein West', slug: 'verein-west', acquisition_source: 'suche', pilot_requested: true });
    });

    it('Kontakte: leeres Telefon und leere Bildadresse werden null', async () => {
        await TestBed.inject(ContactsService).addContact({ name: 'M', role: 'R', description: 'D', email: 'm@example.org', location: 'L', phone: '', image_url: '' });

        expect(api.post).toHaveBeenCalledWith('/orgs/org-1/contacts', { name: 'M', role: 'R', description: 'D', email: 'm@example.org', location: 'L', phone: null, image_url: null });
    });

    it('Mitglieder: nur erlaubte Felder, leere optionale Felder als null; eigenes Profil ohne Rollen und Rechte', async () => {
        const members = TestBed.inject(MembersService);

        await members.addMember({ name: 'N', email: 'n@example.org', role: 'Mitglied', department: '', status: 'Active', join_date: '01.01.2026', user_id: 'u1', organization_id: 'x', street: '', role_id: '' } as never);
        await members.updateOwnProfile({ phone: '0221', street: '', app_role: 'admin', permissions: ['feed:approve'], name: 'Hack' } as never);

        expect(api.post).toHaveBeenCalledWith('/orgs/org-1/members', { name: 'N', email: 'n@example.org', role: 'Mitglied', department: '', status: 'Active', join_date: '01.01.2026', street: null, role_id: null });
        expect(api.patch).toHaveBeenCalledWith('/orgs/org-1/members/me', { phone: '0221', street: '' });
    });

    it('Wiki: leere Kategorie wird null, Autor und Änderungsdatum werden nicht gesendet', async () => {
        await TestBed.inject(WikiService).addDoc({ organization_id: 'org-1', title: 'T', description: 'D', content: 'C', category: '', status: 'Draft', author: 'Ich', last_updated: '2026-01-01' } as never);

        expect(api.post).toHaveBeenCalledWith('/orgs/org-1/wiki/docs', { title: 'T', description: 'D', content: 'C', category: null, status: 'Draft' });
    });

    it('Arbeitsgruppen: leeres nächstes Treffen bleibt leer (der Server erlaubt es), leere Kontakt-URL wird null, Mitgliederzahl fällt weg', async () => {
        await TestBed.inject(WorkingGroupsService).addWorkingGroup({
            name: 'AG', description: 'D', lead: 'L', next_meeting: '', contact_type: 'Discord', contact_value: '#k', contact_link: '', contact_icon: 'pi-discord', tags: [], category: '', members_count: 7,
        } as never);

        expect(api.post).toHaveBeenCalledWith('/orgs/org-1/working-groups', {
            name: 'AG', description: 'D', lead: 'L', next_meeting: '', contact_type: 'Discord', contact_value: '#k', contact_link: null, contact_icon: 'pi-discord', tags: [], category: null,
        });
    });
});
