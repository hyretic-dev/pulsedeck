/**
 * Working Group (API-Antwort `GET /orgs/:orgId/working-groups`)
 */
export interface WorkingGroup {
    id?: string;
    name: string;
    description: string;
    lead: string;
    members_count: number;
    next_meeting: string;
    contact_type: 'Signal' | 'Discord' | 'WhatsApp' | 'Email';
    contact_value: string;
    contact_link?: string | null;
    contact_icon: string;
    tags: string[];
    /** Optional free-text category for grouping/filtering (e.g. 'AGs', 'Mandatsträger'). */
    category?: string | null;
    created_at?: string;
    updated_at?: string;
    /** Anzahl Mitglieder ohne den benötigten Kontaktkanal (nur für Admin, Vorstand und AG-Leitung). */
    missing_contact_count?: number;
}
