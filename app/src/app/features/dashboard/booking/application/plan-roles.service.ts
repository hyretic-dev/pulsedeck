import { Injectable, inject, signal } from '@angular/core';

import type { PlanRolle } from '../../../../shared/booking/booking.models';
import { BOOKING_REPOSITORY, MEMBER_DIRECTORY, PersonAuswahl, PlanRolleZeile } from '../domain/booking.repository';

/** Rollen im Belegungsplan (Leitung, Verwaltung, Buchende) für den Einstellungsdialog der Leitung. */
@Injectable()
export class PlanRolesService {
    private readonly repo = inject(BOOKING_REPOSITORY);
    private readonly verzeichnis = inject(MEMBER_DIRECTORY);

    readonly rollen = signal<PlanRolleZeile[]>([]);
    readonly personen = signal<PersonAuswahl[]>([]);
    readonly laedt = signal(false);

    async laden(planId: string): Promise<void> {
        this.laedt.set(true);
        try {
            const [rollen, personen] = await Promise.all([this.repo.rollen(planId), this.verzeichnis.mitglieder()]);
            this.rollen.set(rollen);
            this.personen.set(personen);
        } finally {
            this.laedt.set(false);
        }
    }

    async setzen(planId: string, memberId: string, rolle: PlanRolle): Promise<void> {
        await this.repo.rolleSetzen(planId, memberId, rolle);
        this.rollen.set(await this.repo.rollen(planId));
    }

    async entfernen(planId: string, memberId: string): Promise<void> {
        await this.repo.rolleEntfernen(planId, memberId);
        this.rollen.set(await this.repo.rollen(planId));
    }
}
