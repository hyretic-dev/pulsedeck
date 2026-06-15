-- Fix the on_organization_created trigger function to run with SECURITY DEFINER
-- This ensures it can create default skills even when called from user context

CREATE OR REPLACE FUNCTION public.on_organization_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM create_default_skills(NEW.id);
    RETURN NEW;
END;
$$;
