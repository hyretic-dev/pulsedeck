import { Injectable, inject } from '@angular/core';

import { ApiService } from '../../../../core/api.service';
import { OrganizationService } from '../../../../shared/services/organization.service';
import type { MemberDirectory, PersonAuswahl } from '../domain/booking.repository';

/** Mitgliederliste der Organisation (für alle Mitglieder lesbar) als Auswahl für die Rollenvergabe im Plan. */
@Injectable()
export class ApiMemberDirectory implements MemberDirectory {
    private readonly api = inject(ApiService);
    private readonly org = inject(OrganizationService);

    async mitglieder(): Promise<PersonAuswahl[]> {
        const orgId = this.org.currentOrgId();
        if (!orgId) throw new Error('Keine Organisation ausgewählt');
        const zeilen = await this.api.get<Array<{ id: string; name: string; status?: string }>>(`/orgs/${orgId}/members`);
        return zeilen
            .filter((z) => z.status !== 'Inactive')
            .map((z) => ({ id: z.id, name: z.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
}
