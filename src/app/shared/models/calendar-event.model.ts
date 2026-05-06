/**
 * Calendar event interface matching Supabase table structure
 * 
 * Event type is derived from working_group_id:
 * - AG event: working_group_id is set
 * - General event: working_group_id is null
 */
export type LocationType =
    | 'discord'
    | 'zoom'
    | 'onsite'
    | 'other';

export type RecurrenceInterval =
    | 'biweekly'
    | 'monthly'
    | 'quarterly';

export interface CalendarEvent {
    id?: string;
    organization_id?: string;
    title: string;
    date: string;
    start_time: string;
    end_time?: string | null;
    location: string;
    description?: string | null;
    ag_name?: string | null;
    working_group_id?: string | null;
    created_at?: string;
    updated_at?: string;
    allowed_roles?: string[];
    /** Reason / purpose of the meeting */
    meeting_reason?: string | null;
    /** Location type: discord, zoom, onsite, other */
    location_type?: LocationType | null;
    /** Whether this is a recurring event */
    is_recurring?: boolean;
    /** Recurrence interval */
    recurrence_interval?: RecurrenceInterval | null;
    /** Parent event ID for recurring series */
    recurrence_parent_id?: string | null;
}

/**
 * Helper to determine event type from event data
 */
export function getEventType(event: CalendarEvent): 'general' | 'ag' {
    return event.working_group_id ? 'ag' : 'general';
}
