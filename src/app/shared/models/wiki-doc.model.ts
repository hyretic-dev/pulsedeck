export interface WikiCategory {
    id: string;
    organization_id: string;
    working_group_id?: string | null;
    name: string;
    icon?: string;
    sort_order: number;
    created_at?: string;
    updated_at?: string;
}

/**
 * Wiki document interface matching Supabase table structure
 */
export interface WikiDoc {
    id?: string;
    organization_id: string;
    working_group_id?: string | null;
    title: string;
    description: string;
    content?: string | null;
    last_updated: string;
    author: string;
    category: string;
    status: 'Published' | 'Draft' | 'Review';
    created_at?: string;
    updated_at?: string;
    allowed_roles?: string[];
}
