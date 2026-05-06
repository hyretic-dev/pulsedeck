/**
 * Permission keys that can be assigned to members
 */
export type Permission =
    | 'feed:create'    // Create feed posts
    | 'feed:approve'   // Approve/publish feed posts
    | 'wiki:edit'      // Edit wiki articles
    | 'events:create'  // Create general events
    | 'contacts:edit'; // Edit contact persons

/**
 * App-wide roles (hierarchy: public < member < committee < admin)
 */
export type AppRole = 'public' | 'member' | 'committee' | 'admin';

/**
 * Member status
 */
export type MemberStatus = 'Active' | 'Inactive' | 'Pending';

/**
 * Member interface matching Supabase table structure
 */
export interface Member {
    id?: string;
    name: string;
    role: string; // Club role (e.g., "Vorstand", "Schatzmeister")
    department: string;
    status: MemberStatus;
    email: string;
    join_date: string;
    avatar_url?: string;
    user_id?: string;
    app_role?: AppRole;
    permissions?: Permission[];
    street?: string;
    zip_code?: string;
    city?: string;
    phone?: string;
    birthday?: string;
    calendar_token?: string;
    custom_info?: string;
    /** Contact channels, e.g. { Discord: "user#123" } */
    contact_channels?: Record<string, string>;
    created_at?: string;
    updated_at?: string;
}

/**
 * Role within a working group
 */
export type AgRole = 'member' | 'admin' | 'lead';

/**
 * AG Membership with role
 */
export interface AgMembership {
    id?: string;
    member_id: string;
    working_group_id: string;
    role: AgRole;
    joined_at?: string;
    // Joined data
    member_name?: string;
    working_group_name?: string;
}
