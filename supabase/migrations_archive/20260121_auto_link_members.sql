-- Function to auto-link members to auth users based on email
CREATE OR REPLACE FUNCTION public.handle_new_user_linking()
RETURNS TRIGGER AS $$
BEGIN
  -- Link any unconnected members with the same email to this user
  -- We check for confirmed_at IS NOT NULL to ensure they have accepted invite/verified email
  -- We also run this on every update to catch cases where a member was added AFTER the user existed
  -- and the user logs in again (updating last_sign_in_at).
  
  IF NEW.email_confirmed_at IS NOT NULL THEN
     UPDATE public.members
     SET user_id = NEW.id
     WHERE email = NEW.email 
       AND user_id IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run on INSERT and UPDATE of auth.users
DROP TRIGGER IF EXISTS on_auth_user_link_members ON auth.users;

CREATE TRIGGER on_auth_user_link_members
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user_linking();
