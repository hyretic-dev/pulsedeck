-- Table for storing Web Push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster lookups by member
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member_id ON public.push_subscriptions(member_id);

-- Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Members can manage their own subscriptions" 
ON public.push_subscriptions
FOR ALL
USING (auth.uid() = member_id);

-- Function to handle updated_at
CREATE OR REPLACE FUNCTION public.handle_push_subscription_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER tr_push_subscriptions_updated_at
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.handle_push_subscription_updated_at();

-- Grant access
GRANT ALL ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
