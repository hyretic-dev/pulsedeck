-- Migration: Push Notification Triggers
-- This migration adds triggers to feed_items and events to automatically call the send-push edge function.

-- Function to notify the send-push edge function
CREATE OR REPLACE FUNCTION public.notify_push_on_new_record()
RETURNS TRIGGER AS $$
DECLARE
    payload JSONB;
    edge_url TEXT;
    service_role_key TEXT;
BEGIN
    -- Only proceed for certain feed item types if it's a feed item
    IF TG_TABLE_NAME = 'feed_items' THEN
        -- Only notify for 'poll', 'news', or 'event' items that are 'approved' or 'sent'
        IF NEW.type NOT IN ('poll', 'news', 'event') OR NEW.status NOT IN ('approved', 'sent') THEN
            RETURN NEW;
        END IF;
        
        payload = jsonb_build_object(
            'table', TG_TABLE_NAME,
            'type', NEW.type,
            'id', NEW.id,
            'organization_id', NEW.organization_id,
            'title', NEW.title,
            'message', LEFT(NEW.content, 100)
        );
    ELSIF TG_TABLE_NAME = 'events' THEN
        payload = jsonb_build_object(
            'table', TG_TABLE_NAME,
            'id', NEW.id,
            'organization_id', NEW.organization_id,
            'title', NEW.title,
            'message', 'Neuer Termin: ' || NEW.title
        );
    END IF;

    -- Invoke the edge function asynchronously
    -- Note: This requires net.http_post from pg_net extension if available, 
    -- or we use the supabase internal trigger mechanism.
    -- For now, we use the standard Supabase Edge Function call pattern via pg_net if installed.
    -- Otherwise, we might want to just let the app handle it, but the request was "automatic".
    
    -- If pg_net is not preferred, we can use a simpler approach of a dedicated 'notification_queue' table.
    
    INSERT INTO public.push_notification_queue (payload, organization_id)
    VALUES (payload, NEW.organization_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a queue table for notifications to be processed by a Cron or Edge Function
CREATE TABLE IF NOT EXISTS public.push_notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB NOT NULL,
    organization_id UUID NOT NULL,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for processing
CREATE INDEX IF NOT EXISTS idx_push_notification_queue_unprocessed ON public.push_notification_queue(processed) WHERE processed = false;

-- Add triggers
DROP TRIGGER IF EXISTS tr_feed_items_push_notify ON public.feed_items;
CREATE TRIGGER tr_feed_items_push_notify
AFTER INSERT OR UPDATE OF status ON public.feed_items
FOR EACH ROW
EXECUTE FUNCTION public.notify_push_on_new_record();

DROP TRIGGER IF EXISTS tr_events_push_notify ON public.events;
CREATE TRIGGER tr_events_push_notify
AFTER INSERT ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.notify_push_on_new_record();

-- Grant permissions
GRANT INSERT ON public.push_notification_queue TO authenticated;
GRANT ALL ON public.push_notification_queue TO service_role;
