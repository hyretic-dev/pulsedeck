/**
 * Contact person interface (API-Antwort des Backends)
 */
export interface ContactPerson {
    id?: string;
    name: string;
    role: string;
    description: string;
    email: string;
    phone?: string | null;
    location: string;
    image_url?: string | null;
    organization_id?: string;
    created_at?: string;
    updated_at?: string;
}
