CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."create_default_skills"("org_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO skills (organization_id, name, category, icon, sort_order) VALUES
    -- Fähigkeiten (Abilities)
    (org_uuid, 'Führerschein Klasse B', 'ability', 'pi-car', 1),
    (org_uuid, 'Führerschein mit Anhänger', 'ability', 'pi-car', 2),
    (org_uuid, 'Texte schreiben', 'ability', 'pi-pencil', 3),
    (org_uuid, 'Social Media', 'ability', 'pi-share-alt', 4),
    (org_uuid, 'Grafik/Design', 'ability', 'pi-palette', 5),
    (org_uuid, 'Fotografie', 'ability', 'pi-camera', 6),
    (org_uuid, 'Erste Hilfe', 'ability', 'pi-heart', 7),
    (org_uuid, 'Moderation', 'ability', 'pi-microphone', 8),
    (org_uuid, 'Kochen/Catering', 'ability', 'pi-utensils', 9),
    (org_uuid, 'Handwerklich geschickt', 'ability', 'pi-wrench', 10),
    
    -- Interessen (Interests)
    (org_uuid, 'Sozialpolitik', 'interest', 'pi-users', 20),
    (org_uuid, 'Umwelt & Klima', 'interest', 'pi-globe', 21),
    (org_uuid, 'Wirtschaftspolitik', 'interest', 'pi-chart-line', 22),
    (org_uuid, 'Bildungspolitik', 'interest', 'pi-book', 23),
    (org_uuid, 'Kommunalpolitik', 'interest', 'pi-building', 24),
    (org_uuid, 'Öffentlichkeitsarbeit', 'interest', 'pi-megaphone', 25),
    (org_uuid, 'Veranstaltungen', 'interest', 'pi-calendar', 26),
    
    -- Verfügbarkeit (Availability)
    (org_uuid, 'Wochenende verfügbar', 'availability', 'pi-clock', 40),
    (org_uuid, 'Abends verfügbar', 'availability', 'pi-moon', 41),
    (org_uuid, 'Spontan einsetzbar', 'availability', 'pi-bolt', 42),
    (org_uuid, 'Mit PKW mobil', 'availability', 'pi-car', 43)
    
    ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."create_default_skills"("org_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_event_guest_count"("p_event_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN (
        SELECT COUNT(*) 
        FROM event_guest_organizations 
        WHERE event_id = p_event_id 
        AND status = 'accepted'
    );
END;
$$;


ALTER FUNCTION "public"."get_event_guest_count"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_skills"("member_uuid" "uuid") RETURNS TABLE("skill_id" "uuid", "skill_name" "text", "skill_category" "text", "skill_icon" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT s.id, s.name, s.category, s.icon
    FROM member_skills ms
    JOIN skills s ON s.id = ms.skill_id
    WHERE ms.member_id = member_uuid
    ORDER BY s.category, s.sort_order, s.name;
$$;


ALTER FUNCTION "public"."get_member_skills"("member_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_members_by_skills"("org_uuid" "uuid", "skill_ids" "uuid"[]) RETURNS TABLE("member_id" "uuid", "member_name" "text", "member_email" "text", "matching_skills" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT 
        m.id,
        m.name,
        m.email,
        COUNT(ms.skill_id)::INTEGER as matching_skills
    FROM members m
    JOIN member_skills ms ON ms.member_id = m.id
    WHERE m.organization_id = org_uuid
    AND ms.skill_id = ANY(skill_ids)
    GROUP BY m.id, m.name, m.email
    ORDER BY matching_skills DESC, m.name;
$$;


ALTER FUNCTION "public"."get_members_by_skills"("org_uuid" "uuid", "skill_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_member_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1);
END;
$$;


ALTER FUNCTION "public"."get_my_member_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'public';
  END IF;
  SELECT app_role INTO v_user_role FROM public.members WHERE user_id = auth.uid();
  RETURN COALESCE(v_user_role, 'public');
END;
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") RETURNS TABLE("member_id" "uuid", "member_name" "text", "organization_id" "uuid", "organization_name" "text", "organization_slug" "text", "app_role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id as member_id,
        m.name as member_name,
        o.id as organization_id,
        o.name as organization_name,
        o.slug as organization_slug,
        m.app_role
    FROM members m
    INNER JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = user_uuid;
END;
$$;


ALTER FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") IS 'Returns all organization memberships for a given auth user UUID';



CREATE OR REPLACE FUNCTION "public"."handle_new_user_linking"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_new_user_linking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("permission_key" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    member_record RECORD;
BEGIN
    SELECT * INTO member_record FROM members WHERE user_id = auth.uid();
    
    IF member_record IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admins and committee have all permissions
    IF member_record.app_role IN ('admin', 'committee') THEN
        RETURN TRUE;
    END IF;
    
    -- Check specific permission
    RETURN permission_key = ANY(member_record.permissions);
END;
$$;


ALTER FUNCTION "public"."has_permission"("permission_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("permission_key" "text", "org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    role_record RECORD;
BEGIN
    SELECT r.* INTO role_record 
    FROM members m
    INNER JOIN organization_roles r ON m.role_id = r.id
    WHERE m.user_id = auth.uid() AND m.organization_id = org_id;
    
    IF role_record IS NULL THEN
        RETURN FALSE;
    END IF;
    
    IF role_record.is_system_admin THEN
        RETURN TRUE;
    END IF;
    
    RETURN permission_key = ANY(COALESCE(role_record.permissions, '{}'));
END;
$$;


ALTER FUNCTION "public"."has_permission"("permission_key" "text", "org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_of_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM members
        WHERE user_id = auth.uid()
        AND organization_id = org_id
        AND app_role = 'admin'
    );
END;
$$;


ALTER FUNCTION "public"."is_admin_of_org"("org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin_of_org"("org_id" "uuid") IS 'Checks if authenticated user is an admin in the given organization';



CREATE OR REPLACE FUNCTION "public"."is_ag_admin"("ag_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM ag_memberships am
        INNER JOIN members m ON am.member_id = m.id
        WHERE m.user_id = auth.uid()
        AND am.working_group_id = ag_id
        AND am.role IN ('admin', 'lead')
    );
END;
$$;


ALTER FUNCTION "public"."is_ag_admin"("ag_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_ag"("ag_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM working_group_members wgm
    WHERE wgm.working_group_id = ag_id
    AND wgm.member_id = get_my_member_id()
  );
END;
$$;


ALTER FUNCTION "public"."is_member_of_ag"("ag_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM members
        WHERE user_id = auth.uid()
        AND organization_id = org_id
    );
END;
$$;


ALTER FUNCTION "public"."is_member_of_org"("org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_member_of_org"("org_id" "uuid") IS 'Checks if authenticated user is a member of the given organization';



CREATE OR REPLACE FUNCTION "public"."is_owner_of_org"("org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM organizations
        WHERE id = org_id
        AND owner_id = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."is_owner_of_org"("org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_owner_of_org"("org_id" "uuid") IS 'Checks if authenticated user is the owner of the given organization';



CREATE OR REPLACE FUNCTION "public"."log_audit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    rec_id UUID;
    old_json JSONB;
    new_json JSONB;
    op TEXT;
    org_id UUID;
    usr_id UUID;
BEGIN
    op := TG_OP;
    usr_id := auth.uid();
    
    -- Extract ID and Organization Info
    IF op = 'DELETE' THEN
        rec_id := OLD.id;
        old_json := to_jsonb(OLD);
        IF (old_json ? 'organization_id') THEN
            org_id := (old_json->>'organization_id')::uuid;
        END IF;
    ELSIF op = 'UPDATE' THEN
        rec_id := NEW.id;
        old_json := to_jsonb(OLD);
        new_json := to_jsonb(NEW);
        IF (new_json ? 'organization_id') THEN
            org_id := (new_json->>'organization_id')::uuid;
        END IF;
    ELSIF op = 'INSERT' THEN
        rec_id := NEW.id;
        new_json := to_jsonb(NEW);
        IF (new_json ? 'organization_id') THEN
            org_id := (new_json->>'organization_id')::uuid;
        END IF;
    END IF;

    -- Insert Log
    INSERT INTO audit_logs (
        table_name, 
        operation, 
        record_id, 
        old_data, 
        new_data, 
        performed_by, 
        organization_id
    )
    VALUES (
        TG_TABLE_NAME, 
        op, 
        rec_id, 
        old_json, 
        new_json, 
        usr_id, 
        org_id
    );
    
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_audit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_knowledge"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "org_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    kb.id,
    kb.title,
    kb.content,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_base kb
  WHERE 
    1 - (kb.embedding <=> query_embedding) > match_threshold
    AND (
      kb.organization_id IS NULL 
      OR kb.organization_id = org_id
    )
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;


ALTER FUNCTION "public"."match_knowledge"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_organization_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    PERFORM create_default_skills(NEW.id);
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_organization_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_get_role"("uid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  current_role TEXT;
BEGIN
  SELECT app_role INTO current_role FROM public.members WHERE user_id = uid;
  RETURN COALESCE(current_role, 'public');
END;
$$;


ALTER FUNCTION "public"."test_get_role"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_get_role_v2"("uid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT app_role INTO v_role FROM public.members WHERE user_id = uid;
  RETURN COALESCE(v_role, 'public');
END;
$$;


ALTER FUNCTION "public"."test_get_role_v2"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_create_default_org_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
    VALUES (NEW.id, 'Admin', 'Systemadministrator', true, false, ARRAY['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker']);
    
    INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
    VALUES (NEW.id, 'Mitglied', 'Standardmitglied', false, true, ARRAY['feed:create']);
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_create_default_org_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_protect_org_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    is_owner BOOLEAN;
    is_admin_role BOOLEAN;
BEGIN
    SELECT (owner_id = OLD.user_id) INTO is_owner FROM organizations WHERE id = OLD.organization_id;
    
    IF is_owner THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Der Besitzer kann die Organisation nicht verlassen. Bitte übertrage zuerst den Besitz.';
        END IF;
        
        IF TG_OP = 'UPDATE' THEN
            IF NEW.role_id != OLD.role_id THEN
                SELECT is_system_admin INTO is_admin_role FROM organization_roles WHERE id = NEW.role_id;
                IF NOT is_admin_role THEN
                    RAISE EXCEPTION 'Dem Besitzer kann die Admin-Rolle nicht entzogen werden.';
                END IF;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_protect_org_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ag_members_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE working_groups SET members_count = (
      SELECT COUNT(*) FROM working_group_members WHERE working_group_id = NEW.working_group_id
    ) WHERE id = NEW.working_group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE working_groups SET members_count = (
      SELECT COUNT(*) FROM working_group_members WHERE working_group_id = OLD.working_group_id
    ) WHERE id = OLD.working_group_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_ag_members_count"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."active_sessions" (
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "org_roles" "jsonb" DEFAULT '{}'::"jsonb",
    "current_path" "text",
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."active_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ag_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "working_group_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ag_memberships_role_check" CHECK (("role" = ANY (ARRAY['member'::"text", 'admin'::"text", 'lead'::"text"])))
);


ALTER TABLE "public"."ag_memberships" OWNER TO "postgres";


COMMENT ON TABLE "public"."ag_memberships" IS 'Tracks which members belong to which working groups, with roles (member, admin, lead)';



CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_name" "text" NOT NULL,
    "organization_id" "uuid",
    "page_path" "text",
    "meta_data" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "table_name" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "record_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "performed_by" "uuid" DEFAULT "auth"."uid"(),
    "organization_id" "uuid"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text", 'tool'::"text"])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "description" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "location" "text" NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid"
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_guest_organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "host_organization_id" "uuid" NOT NULL,
    "guest_organization_id" "uuid",
    "guest_org_name" "text",
    "guest_org_email" "text",
    "guest_org_contact_name" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "invited_by" "uuid",
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    CONSTRAINT "event_guest_organizations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."event_guest_organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text",
    "registered_at" timestamp with time zone DEFAULT "now"(),
    "note" "text",
    CONSTRAINT "event_registrations_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'maybe'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_registrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_registrations" IS 'Tracks member registrations for events';



CREATE TABLE IF NOT EXISTS "public"."event_slot_signups" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "slot_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "note" "text",
    "signed_up_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "event_slot_signups_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_slot_signups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_slots" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "max_helpers" integer DEFAULT 1 NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "required_skills" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."event_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "date" "text" NOT NULL,
    "start_time" "text" NOT NULL,
    "end_time" "text",
    "location" "text" NOT NULL,
    "description" "text",
    "ag_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "allowed_roles" "text"[] DEFAULT '{public,member,committee,admin}'::"text"[],
    "working_group_id" "uuid",
    "max_participants" integer,
    "registration_required" boolean DEFAULT false,
    "organization_id" "uuid",
    "meeting_reason" "text",
    "location_type" "text",
    "is_recurring" boolean DEFAULT false,
    "recurrence_interval" "text",
    "recurrence_parent_id" "uuid",
    CONSTRAINT "events_location_type_check" CHECK (("location_type" = ANY (ARRAY['discord'::"text", 'zoom'::"text", 'onsite'::"text", 'other'::"text"]))),
    CONSTRAINT "events_recurrence_interval_check" CHECK (("recurrence_interval" = ANY (ARRAY['biweekly'::"text", 'monthly'::"text", 'quarterly'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."max_participants" IS 'Maximum number of participants (NULL = unlimited)';



COMMENT ON COLUMN "public"."events"."registration_required" IS 'Whether registration is required for this event';



COMMENT ON COLUMN "public"."events"."meeting_reason" IS 'Reason/purpose for the meeting';



COMMENT ON COLUMN "public"."events"."location_type" IS 'Type of meeting location: discord, zoom, onsite, other';



COMMENT ON COLUMN "public"."events"."is_recurring" IS 'Whether this event is part of a recurring series';



COMMENT ON COLUMN "public"."events"."recurrence_interval" IS 'Interval: biweekly, monthly, quarterly';



COMMENT ON COLUMN "public"."events"."recurrence_parent_id" IS 'Reference to the first event in a recurring series';



CREATE TABLE IF NOT EXISTS "public"."feed_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "title" "text" NOT NULL,
    "content" "text",
    "url" "text",
    "type" "text" DEFAULT 'article'::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "author_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone,
    "organization_id" "uuid",
    "poll_config" "jsonb",
    "is_public" boolean DEFAULT true,
    "working_group_id" "uuid",
    CONSTRAINT "feed_items_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'review'::"text", 'approved'::"text", 'sent'::"text"]))),
    CONSTRAINT "feed_items_type_check" CHECK (("type" = ANY (ARRAY['article'::"text", 'link'::"text", 'poll'::"text"])))
);


ALTER TABLE "public"."feed_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" NOT NULL,
    "description" "text" NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'new'::"text"
);


ALTER TABLE "public"."feedback_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "original_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "folder" "text" DEFAULT '/'::"text",
    "description" "text",
    "uploaded_by" "uuid",
    "working_group_id" "uuid",
    "visibility" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid",
    "is_pinned" boolean DEFAULT false NOT NULL,
    "folder_id" "uuid",
    "is_indexed" boolean DEFAULT false NOT NULL,
    CONSTRAINT "files_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'member'::"text", 'committee'::"text", 'admin'::"text", 'ag-only'::"text"])))
);


ALTER TABLE "public"."files" OWNER TO "postgres";


COMMENT ON TABLE "public"."files" IS 'Metadata for uploaded files stored in Supabase Storage';



CREATE TABLE IF NOT EXISTS "public"."folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid",
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "public"."vector"(1024),
    "organization_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "file_id" "uuid"
);


ALTER TABLE "public"."knowledge_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_skills" (
    "member_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."member_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role" "text",
    "department" "text",
    "status" "text" NOT NULL,
    "email" "text" NOT NULL,
    "join_date" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "app_role" "text" DEFAULT 'member'::"text",
    "street" "text",
    "zip_code" "text",
    "city" "text",
    "phone" "text",
    "birthday" "text",
    "permissions" "text"[] DEFAULT '{}'::"text"[],
    "organization_id" "uuid",
    "connection_token" "text",
    "calendar_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text"),
    "custom_info" "text",
    "contact_channels" "jsonb" DEFAULT '{}'::"jsonb",
    "role_id" "uuid" NOT NULL,
    CONSTRAINT "members_app_role_check" CHECK (("app_role" = ANY (ARRAY['public'::"text", 'member'::"text", 'committee'::"text", 'admin'::"text"]))),
    CONSTRAINT "members_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Inactive'::"text", 'Pending'::"text"])))
);


ALTER TABLE "public"."members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."members"."permissions" IS 'Array of permission keys: feed:create, feed:approve, wiki:edit, events:create, contacts:edit, view_issue_tracker';



COMMENT ON COLUMN "public"."members"."connection_token" IS 'One-time token for linking auth user to member profile';



COMMENT ON COLUMN "public"."members"."contact_channels" IS 'JSONB with contact info, e.g. {"Discord":"user#123","WhatsApp":"+49..."}';



CREATE TABLE IF NOT EXISTS "public"."newsletter_config" (
    "id" integer DEFAULT 1 NOT NULL,
    "frequency" "text" DEFAULT 'weekly'::"text",
    "day_of_week" integer DEFAULT 5,
    "time_of_day" time without time zone DEFAULT '12:00:00'::time without time zone,
    "last_sent_at" timestamp with time zone,
    "active" boolean DEFAULT false,
    "logo_url" "text" DEFAULT ''::"text",
    "footer_text" "text" DEFAULT 'Lexion - Vereinsverwaltung'::"text",
    "primary_color" "text" DEFAULT '#DE0000'::"text",
    "smtp_host" "text",
    "smtp_port" integer,
    "smtp_user" "text",
    "smtp_pass" "text",
    "smtp_from" "text",
    "smtp_secure" boolean DEFAULT true,
    CONSTRAINT "newsletter_config_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'manual'::"text"]))),
    CONSTRAINT "single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."newsletter_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."newsletter_config"."logo_url" IS 'URL to logo image (optional, text fallback if empty)';



COMMENT ON COLUMN "public"."newsletter_config"."footer_text" IS 'Footer text for all emails';



COMMENT ON COLUMN "public"."newsletter_config"."primary_color" IS 'Primary brand color (hex)';



CREATE TABLE IF NOT EXISTS "public"."onboarding_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "step_key" "text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."onboarding_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "permissions" "text"[] DEFAULT '{}'::"text"[],
    "is_system_admin" boolean DEFAULT false,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organization_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "logo_url" "text",
    "primary_color" "text" DEFAULT '#e3000f'::"text",
    "subscription_tier" "text" DEFAULT 'free'::"text",
    "max_members" integer DEFAULT 10,
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branding_enabled" boolean DEFAULT true,
    CONSTRAINT "organizations_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['free'::"text", 'pro'::"text", 'pro_bono'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON TABLE "public"."organizations" IS 'Multi-tenant organizations (clubs/associations)';



COMMENT ON COLUMN "public"."organizations"."slug" IS 'URL-friendly identifier for the organization';



COMMENT ON COLUMN "public"."organizations"."subscription_tier" IS 'Subscription level: free (10 members), pro (paid), pro_bono (free unlimited)';



COMMENT ON COLUMN "public"."organizations"."branding_enabled" IS 'If true, show "Powered by PulseDeck" on public pages. Free tier always shows it.';



CREATE TABLE IF NOT EXISTS "public"."poll_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feed_item_id" "uuid" NOT NULL,
    "text" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."poll_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."poll_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "option_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."poll_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'ability'::"text" NOT NULL,
    "icon" "text",
    "description" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "done" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wiki_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "working_group_id" "uuid",
    "name" "text" NOT NULL,
    "icon" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wiki_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wiki_docs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "content" "text",
    "last_updated" "text" NOT NULL,
    "author" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "allowed_roles" "text"[] DEFAULT '{public,member,committee,admin}'::"text"[],
    "organization_id" "uuid" NOT NULL,
    "working_group_id" "uuid",
    "category" "uuid",
    CONSTRAINT "wiki_docs_status_check" CHECK (("status" = ANY (ARRAY['Published'::"text", 'Draft'::"text", 'Review'::"text"])))
);


ALTER TABLE "public"."wiki_docs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."working_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "working_group_id" "uuid",
    "member_id" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."working_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."working_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "lead" "text" NOT NULL,
    "members_count" integer DEFAULT 0,
    "next_meeting" "text" NOT NULL,
    "contact_type" "text" NOT NULL,
    "contact_value" "text",
    "contact_link" "text",
    "contact_icon" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid",
    "category" "text",
    CONSTRAINT "working_groups_contact_type_check" CHECK (("contact_type" = ANY (ARRAY['Signal'::"text", 'Discord'::"text", 'WhatsApp'::"text", 'Email'::"text"])))
);


ALTER TABLE "public"."working_groups" OWNER TO "postgres";


COMMENT ON COLUMN "public"."working_groups"."category" IS 'Optional free-text category for grouping (e.g. AGs, Mandatsträger). NULL means no category assigned.';



ALTER TABLE ONLY "public"."active_sessions"
    ADD CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."ag_memberships"
    ADD CONSTRAINT "ag_memberships_member_id_working_group_id_key" UNIQUE ("member_id", "working_group_id");



ALTER TABLE ONLY "public"."ag_memberships"
    ADD CONSTRAINT "ag_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_event_id_guest_org_email_key" UNIQUE ("event_id", "guest_org_email");



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_event_id_guest_organization_id_key" UNIQUE ("event_id", "guest_organization_id");



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_event_id_member_id_key" UNIQUE ("event_id", "member_id");



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_slot_signups"
    ADD CONSTRAINT "event_slot_signups_event_slot_id_member_id_key" UNIQUE ("slot_id", "member_id");



ALTER TABLE ONLY "public"."event_slot_signups"
    ADD CONSTRAINT "event_slot_signups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_slots"
    ADD CONSTRAINT "event_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_submissions"
    ADD CONSTRAINT "feedback_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_skills"
    ADD CONSTRAINT "member_skills_pkey" PRIMARY KEY ("member_id", "skill_id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_email_org_unique" UNIQUE ("email", "organization_id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_config"
    ADD CONSTRAINT "newsletter_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_member_id_step_key_key" UNIQUE ("member_id", "step_key");



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."poll_options"
    ADD CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."poll_votes"
    ADD CONSTRAINT "poll_votes_option_id_member_id_key" UNIQUE ("option_id", "member_id");



ALTER TABLE ONLY "public"."poll_votes"
    ADD CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wiki_categories"
    ADD CONSTRAINT "wiki_categories_organization_id_working_group_id_name_key" UNIQUE ("organization_id", "working_group_id", "name");



ALTER TABLE ONLY "public"."wiki_categories"
    ADD CONSTRAINT "wiki_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wiki_docs"
    ADD CONSTRAINT "wiki_docs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_group_members"
    ADD CONSTRAINT "working_group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_group_members"
    ADD CONSTRAINT "working_group_members_working_group_id_member_id_key" UNIQUE ("working_group_id", "member_id");



ALTER TABLE ONLY "public"."working_groups"
    ADD CONSTRAINT "working_groups_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_active_sessions_last_seen" ON "public"."active_sessions" USING "btree" ("last_seen_at");



CREATE INDEX "idx_active_sessions_org_roles" ON "public"."active_sessions" USING "gin" ("org_roles");



CREATE INDEX "idx_ag_memberships_group" ON "public"."ag_memberships" USING "btree" ("working_group_id");



CREATE INDEX "idx_ag_memberships_member" ON "public"."ag_memberships" USING "btree" ("member_id");



CREATE INDEX "idx_analytics_event_name" ON "public"."analytics_events" USING "btree" ("event_name");



CREATE INDEX "idx_analytics_org_created" ON "public"."analytics_events" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_org" ON "public"."audit_logs" USING "btree" ("organization_id");



CREATE INDEX "idx_audit_logs_table" ON "public"."audit_logs" USING "btree" ("table_name");



CREATE INDEX "idx_chat_messages_session" ON "public"."chat_messages" USING "btree" ("session_id");



CREATE INDEX "idx_chat_sessions_org" ON "public"."chat_sessions" USING "btree" ("organization_id");



CREATE INDEX "idx_chat_sessions_user" ON "public"."chat_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_contacts_organization" ON "public"."contacts" USING "btree" ("organization_id");



CREATE INDEX "idx_event_guest_orgs_event" ON "public"."event_guest_organizations" USING "btree" ("event_id");



CREATE INDEX "idx_event_guest_orgs_guest" ON "public"."event_guest_organizations" USING "btree" ("guest_organization_id");



CREATE INDEX "idx_event_guest_orgs_host" ON "public"."event_guest_organizations" USING "btree" ("host_organization_id");



CREATE INDEX "idx_event_registrations_event" ON "public"."event_registrations" USING "btree" ("event_id");



CREATE INDEX "idx_event_registrations_member" ON "public"."event_registrations" USING "btree" ("member_id");



CREATE INDEX "idx_events_organization" ON "public"."events" USING "btree" ("organization_id");



CREATE INDEX "idx_events_recurrence_parent" ON "public"."events" USING "btree" ("recurrence_parent_id") WHERE ("recurrence_parent_id" IS NOT NULL);



CREATE INDEX "idx_feed_items_organization" ON "public"."feed_items" USING "btree" ("organization_id");



CREATE INDEX "idx_feed_items_working_group_id" ON "public"."feed_items" USING "btree" ("working_group_id");



CREATE INDEX "idx_files_created_at" ON "public"."files" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_files_folder" ON "public"."files" USING "btree" ("folder");



CREATE INDEX "idx_files_folder_id" ON "public"."files" USING "btree" ("folder_id");



CREATE INDEX "idx_files_is_indexed" ON "public"."files" USING "btree" ("is_indexed");



CREATE INDEX "idx_files_is_pinned" ON "public"."files" USING "btree" ("is_pinned") WHERE ("is_pinned" = true);



CREATE INDEX "idx_files_organization" ON "public"."files" USING "btree" ("organization_id");



CREATE INDEX "idx_files_organization_id" ON "public"."files" USING "btree" ("organization_id");



CREATE INDEX "idx_files_uploaded_by" ON "public"."files" USING "btree" ("uploaded_by");



CREATE INDEX "idx_files_working_group" ON "public"."files" USING "btree" ("working_group_id");



CREATE INDEX "idx_files_working_group_id" ON "public"."files" USING "btree" ("working_group_id");



CREATE INDEX "idx_folders_organization_id" ON "public"."folders" USING "btree" ("organization_id");



CREATE INDEX "idx_folders_parent_id" ON "public"."folders" USING "btree" ("parent_id");



CREATE INDEX "idx_kb_file_id" ON "public"."knowledge_base" USING "btree" ("file_id");



CREATE INDEX "idx_member_skills_member" ON "public"."member_skills" USING "btree" ("member_id");



CREATE INDEX "idx_member_skills_skill" ON "public"."member_skills" USING "btree" ("skill_id");



CREATE UNIQUE INDEX "idx_members_calendar_token" ON "public"."members" USING "btree" ("calendar_token");



CREATE INDEX "idx_members_connection_token" ON "public"."members" USING "btree" ("connection_token");



CREATE INDEX "idx_members_email" ON "public"."members" USING "btree" ("email");



CREATE INDEX "idx_members_organization" ON "public"."members" USING "btree" ("organization_id");



CREATE INDEX "idx_members_user_id" ON "public"."members" USING "btree" ("user_id");



CREATE INDEX "idx_onboarding_progress_member_id" ON "public"."onboarding_progress" USING "btree" ("member_id");



CREATE INDEX "idx_organizations_owner" ON "public"."organizations" USING "btree" ("owner_id");



CREATE INDEX "idx_organizations_slug" ON "public"."organizations" USING "btree" ("slug");



CREATE INDEX "idx_skills_category" ON "public"."skills" USING "btree" ("organization_id", "category");



CREATE INDEX "idx_skills_org" ON "public"."skills" USING "btree" ("organization_id");



CREATE INDEX "idx_user_tasks_member_id" ON "public"."user_tasks" USING "btree" ("member_id");



CREATE INDEX "idx_wiki_categories_org" ON "public"."wiki_categories" USING "btree" ("organization_id");



CREATE INDEX "idx_wiki_categories_wg" ON "public"."wiki_categories" USING "btree" ("working_group_id");



CREATE INDEX "idx_wiki_docs_category" ON "public"."wiki_docs" USING "btree" ("category");



CREATE INDEX "idx_working_groups_organization" ON "public"."working_groups" USING "btree" ("organization_id");



CREATE INDEX "knowledge_base_embedding_idx" ON "public"."knowledge_base" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "msg_user_id_idx" ON "public"."members" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "audit_ag_memberships" AFTER INSERT OR DELETE OR UPDATE ON "public"."ag_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_events" AFTER INSERT OR DELETE OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_feed_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."feed_items" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_files" AFTER INSERT OR DELETE OR UPDATE ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_members" AFTER INSERT OR DELETE OR UPDATE ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_organizations" AFTER INSERT OR DELETE OR UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_skills" AFTER INSERT OR DELETE OR UPDATE ON "public"."skills" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_wiki_docs" AFTER INSERT OR DELETE OR UPDATE ON "public"."wiki_docs" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "audit_working_groups" AFTER INSERT OR DELETE OR UPDATE ON "public"."working_groups" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "files_updated_at" BEFORE UPDATE ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_organization_created" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."trg_create_default_org_roles"();



CREATE OR REPLACE TRIGGER "protect_org_owner_member" BEFORE DELETE OR UPDATE ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."trg_protect_org_owner"();



CREATE OR REPLACE TRIGGER "trg_ag_members_count" AFTER INSERT OR DELETE ON "public"."working_group_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_ag_members_count"();



CREATE OR REPLACE TRIGGER "trigger_create_default_skills" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."on_organization_created"();



ALTER TABLE ONLY "public"."active_sessions"
    ADD CONSTRAINT "active_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ag_memberships"
    ADD CONSTRAINT "ag_memberships_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ag_memberships"
    ADD CONSTRAINT "ag_memberships_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_guest_organization_id_fkey" FOREIGN KEY ("guest_organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_host_organization_id_fkey" FOREIGN KEY ("host_organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_guest_organizations"
    ADD CONSTRAINT "event_guest_organizations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_slot_signups"
    ADD CONSTRAINT "event_slot_signups_event_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."event_slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_slot_signups"
    ADD CONSTRAINT "event_slot_signups_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_slot_signups"
    ADD CONSTRAINT "event_slot_signups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_slots"
    ADD CONSTRAINT "event_slots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_slots"
    ADD CONSTRAINT "event_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_recurrence_parent_id_fkey" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feed_items"
    ADD CONSTRAINT "feed_items_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_submissions"
    ADD CONSTRAINT "feedback_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "fk_events_working_group" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE CASCADE;



COMMENT ON CONSTRAINT "fk_events_working_group" ON "public"."events" IS 'Cascade delete: removing a working group deletes all linked events';



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."knowledge_base"
    ADD CONSTRAINT "knowledge_base_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_skills"
    ADD CONSTRAINT "member_skills_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_skills"
    ADD CONSTRAINT "member_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."onboarding_progress"
    ADD CONSTRAINT "onboarding_progress_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."poll_options"
    ADD CONSTRAINT "poll_options_feed_item_id_fkey" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."poll_votes"
    ADD CONSTRAINT "poll_votes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."poll_votes"
    ADD CONSTRAINT "poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_categories"
    ADD CONSTRAINT "wiki_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_categories"
    ADD CONSTRAINT "wiki_categories_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_docs"
    ADD CONSTRAINT "wiki_docs_category_fkey" FOREIGN KEY ("category") REFERENCES "public"."wiki_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wiki_docs"
    ADD CONSTRAINT "wiki_docs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wiki_docs"
    ADD CONSTRAINT "wiki_docs_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."working_group_members"
    ADD CONSTRAINT "working_group_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_group_members"
    ADD CONSTRAINT "working_group_members_working_group_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "public"."working_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_groups"
    ADD CONSTRAINT "working_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



CREATE POLICY "AG Manage" ON "public"."working_groups" USING (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "AG Mem Add Self" ON "public"."working_group_members" FOR INSERT WITH CHECK ((("public"."get_my_role"() = 'admin'::"text") OR (("public"."get_my_role"() = ANY (ARRAY['member'::"text", 'committee'::"text"])) AND ("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "AG Mem Remove Self" ON "public"."working_group_members" FOR DELETE USING ((("public"."get_my_role"() = 'admin'::"text") OR (("public"."get_my_role"() = ANY (ARRAY['member'::"text", 'committee'::"text"])) AND ("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "AG Mem Visibility" ON "public"."working_group_members" FOR SELECT USING (("public"."get_my_role"() = ANY (ARRAY['member'::"text", 'committee'::"text", 'admin'::"text"])));



CREATE POLICY "AG Visibility" ON "public"."working_groups" FOR SELECT USING (true);



CREATE POLICY "AG admins can update memberships" ON "public"."ag_memberships" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM ("public"."ag_memberships" "am"
     JOIN "public"."members" "m" ON (("am"."member_id" = "m"."id")))
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("am"."working_group_id" = "ag_memberships"."working_group_id") AND ("am"."role" = ANY (ARRAY['admin'::"text", 'lead'::"text"])))))));



CREATE POLICY "AG members can see their AG files" ON "public"."files" FOR SELECT TO "authenticated" USING ((("visibility" = 'ag-only'::"text") AND ("working_group_id" IN ( SELECT "ag_memberships"."working_group_id"
   FROM "public"."ag_memberships"
  WHERE ("ag_memberships"."member_id" IN ( SELECT "members"."id"
           FROM "public"."members"
          WHERE ("members"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Admin and committee can create folders" ON "public"."folders" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Admin and committee can update folders" ON "public"."folders" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Admin can delete any org file" ON "public"."files" FOR DELETE TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text")))));



CREATE POLICY "Admin can delete folders" ON "public"."folders" FOR DELETE TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text")))));



CREATE POLICY "Admin can update any org file" ON "public"."files" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text")))));



CREATE POLICY "Admin manage signups" ON "public"."event_slot_signups" USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_slot_signups"."organization_id") AND ("m"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Admins and committee can see all org files" ON "public"."files" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Admins can delete members in their organization" ON "public"."members" FOR DELETE USING (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Admins can insert members in their organization" ON "public"."members" FOR INSERT WITH CHECK (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Admins can manage all member skills" ON "public"."member_skills" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."members" "m"
     JOIN "public"."skills" "s" ON (("s"."id" = "member_skills"."skill_id")))
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "s"."organization_id") AND ("m"."app_role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."members" "m"
     JOIN "public"."skills" "s" ON (("s"."id" = "member_skills"."skill_id")))
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "s"."organization_id") AND ("m"."app_role" = 'admin'::"text")))));



CREATE POLICY "Admins can manage contacts" ON "public"."contacts" USING (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Admins can manage events" ON "public"."events" USING (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Admins can manage skills" ON "public"."skills" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "skills"."organization_id") AND ("members"."app_role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "skills"."organization_id") AND ("members"."app_role" = 'admin'::"text")))));



CREATE POLICY "Admins can manage working_groups" ON "public"."working_groups" USING (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Admins can update members in their organization" ON "public"."members" FOR UPDATE USING (("public"."is_admin_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Admins manage config" ON "public"."newsletter_config" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text")))));



CREATE POLICY "Allow members to view their org events" ON "public"."analytics_events" FOR SELECT USING (("auth"."uid"() IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."organization_id" = "analytics_events"."organization_id"))));



CREATE POLICY "Allow public delete on contacts" ON "public"."contacts" FOR DELETE USING (true);



CREATE POLICY "Allow public delete on events" ON "public"."events" FOR DELETE USING (true);



CREATE POLICY "Allow public delete on working_groups" ON "public"."working_groups" FOR DELETE USING (true);



CREATE POLICY "Allow public insert" ON "public"."analytics_events" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on contacts" ON "public"."contacts" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on events" ON "public"."events" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on working_groups" ON "public"."working_groups" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read access" ON "public"."contacts" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on contacts" ON "public"."contacts" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on working_groups" ON "public"."working_groups" FOR SELECT USING (true);



CREATE POLICY "Allow public update on contacts" ON "public"."contacts" FOR UPDATE USING (true);



CREATE POLICY "Allow public update on events" ON "public"."events" FOR UPDATE USING (true);



CREATE POLICY "Allow public update on working_groups" ON "public"."working_groups" FOR UPDATE USING (true);



CREATE POLICY "Allow super admin to view all events" ON "public"."analytics_events" FOR SELECT USING (("auth"."uid"() = '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c'::"uuid"));



CREATE POLICY "Anyone can view AG memberships" ON "public"."ag_memberships" FOR SELECT USING (true);



CREATE POLICY "Anyone can view active sessions" ON "public"."active_sessions" FOR SELECT USING (true);



CREATE POLICY "Anyone can view organizations" ON "public"."organizations" FOR SELECT USING (true);



CREATE POLICY "Anyone can view registrations" ON "public"."event_registrations" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can create organizations" ON "public"."organizations" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Contacts Manage" ON "public"."contacts" USING (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "Contacts Visibility" ON "public"."contacts" FOR SELECT USING (("public"."get_my_role"() = ANY (ARRAY['member'::"text", 'committee'::"text", 'admin'::"text"])));



CREATE POLICY "Delete vote" ON "public"."poll_votes" FOR DELETE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Enable insert for anon users" ON "public"."feedback_submissions" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."feedback_submissions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable select for admin only" ON "public"."feedback_submissions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c'::"uuid"));



CREATE POLICY "Events Manage" ON "public"."events" USING (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "Events are viewable by members or if public" ON "public"."events" FOR SELECT USING ((("organization_id" IN ( SELECT "get_user_memberships"."organization_id"
   FROM "public"."get_user_memberships"("auth"."uid"()) "get_user_memberships"("member_id", "member_name", "organization_id", "organization_name", "organization_slug", "app_role"))) OR ('public'::"text" = ANY ("allowed_roles"))));



CREATE POLICY "Feed: Delete" ON "public"."feed_items" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))) OR ("author_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id"))
 LIMIT 1))));



CREATE POLICY "Feed: Insert" ON "public"."feed_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id") AND (("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"])) OR ('feed:create'::"text" = ANY ("members"."permissions")))))));



CREATE POLICY "Feed: Update" ON "public"."feed_items" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))) OR ("author_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id"))
 LIMIT 1))));



CREATE POLICY "Feed: View" ON "public"."feed_items" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))) OR ("author_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id"))
 LIMIT 1)) OR (("status" = ANY (ARRAY['approved'::"text", 'sent'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "feed_items"."organization_id")))))));



CREATE POLICY "File owners and admins can delete files" ON "public"."files" FOR DELETE USING ((("uploaded_by" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"())
 LIMIT 1)) OR "public"."is_admin_of_org"("organization_id")));



CREATE POLICY "File owners and admins can update files" ON "public"."files" FOR UPDATE USING ((("uploaded_by" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"())
 LIMIT 1)) OR "public"."is_admin_of_org"("organization_id")));



CREATE POLICY "Guest org invitations manage" ON "public"."event_guest_organizations" USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_guest_organizations"."host_organization_id") AND ("m"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Guest org invitations public read" ON "public"."event_guest_organizations" FOR SELECT USING ((("status" = 'accepted'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."events" "e"
  WHERE (("e"."id" = "event_guest_organizations"."event_id") AND ('public'::"text" = ANY ("e"."allowed_roles")))))));



CREATE POLICY "Guest org invitations read" ON "public"."event_guest_organizations" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_guest_organizations"."host_organization_id")))) OR (("guest_organization_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_guest_organizations"."guest_organization_id")))))));



CREATE POLICY "Insert vote" ON "public"."poll_votes" FOR INSERT WITH CHECK ((("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))) AND (EXISTS ( SELECT 1
   FROM (("public"."poll_options"
     JOIN "public"."feed_items" ON (("feed_items"."id" = "poll_options"."feed_item_id")))
     JOIN "public"."members" "m" ON (("m"."id" = "poll_votes"."member_id")))
  WHERE (("poll_options"."id" = "poll_votes"."option_id") AND ("m"."organization_id" = "feed_items"."organization_id"))))));



CREATE POLICY "Manage own signups" ON "public"."event_slot_signups" USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."id" = "event_slot_signups"."member_id")))));



CREATE POLICY "Manage poll options" ON "public"."poll_options" USING ((EXISTS ( SELECT 1
   FROM "public"."feed_items"
  WHERE (("feed_items"."id" = "poll_options"."feed_item_id") AND ("feed_items"."author_id" IN ( SELECT "members"."id"
           FROM "public"."members"
          WHERE ("members"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Manage slots" ON "public"."event_slots" USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_slots"."organization_id") AND ("m"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Members can cancel own registration" ON "public"."event_registrations" FOR DELETE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can delete own onboarding progress" ON "public"."onboarding_progress" FOR DELETE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can insert files to their org" ON "public"."files" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))) AND ("uploaded_by" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Members can insert own onboarding progress" ON "public"."onboarding_progress" FOR INSERT WITH CHECK (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can join AGs" ON "public"."ag_memberships" FOR INSERT WITH CHECK (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can leave AGs" ON "public"."ag_memberships" FOR DELETE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can register for events" ON "public"."event_registrations" FOR INSERT WITH CHECK (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can see public and member visibility files" ON "public"."files" FOR SELECT TO "authenticated" USING ((("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))) AND ("visibility" = ANY (ARRAY['public'::"text", 'member'::"text"]))));



CREATE POLICY "Members can update own registration" ON "public"."event_registrations" FOR UPDATE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can upload files" ON "public"."files" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Members can upload files to their org" ON "public"."files" FOR INSERT WITH CHECK ("public"."is_member_of_org"("organization_id"));



CREATE POLICY "Members can view contacts in their org" ON "public"."contacts" FOR SELECT USING ((("organization_id" IS NULL) OR "public"."is_member_of_org"("organization_id")));



CREATE POLICY "Members can view other members in their orgs" ON "public"."members" FOR SELECT USING (("organization_id" IN ( SELECT "get_user_memberships"."organization_id"
   FROM "public"."get_user_memberships"("auth"."uid"()) "get_user_memberships"("member_id", "member_name", "organization_id", "organization_name", "organization_slug", "app_role"))));



CREATE POLICY "Members can view own onboarding progress" ON "public"."onboarding_progress" FOR SELECT USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can view their organization's members" ON "public"."members" FOR SELECT USING ((("organization_id" IS NULL) OR "public"."is_member_of_org"("organization_id") OR "public"."is_owner_of_org"("organization_id")));



CREATE POLICY "Members can view working groups in their orgs" ON "public"."working_groups" FOR SELECT USING (("organization_id" IN ( SELECT "get_user_memberships"."organization_id"
   FROM "public"."get_user_memberships"("auth"."uid"()) "get_user_memberships"("member_id", "member_name", "organization_id", "organization_name", "organization_slug", "app_role"))));



CREATE POLICY "Members can view working_groups in their org" ON "public"."working_groups" FOR SELECT USING ((("organization_id" IS NULL) OR "public"."is_member_of_org"("organization_id")));



CREATE POLICY "Org members can see folders" ON "public"."folders" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Owner can update organization" ON "public"."organizations" FOR UPDATE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Owners can update organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."organization_id" = "organizations"."id") AND ("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text"))))));



CREATE POLICY "Public can read organizations" ON "public"."organizations" FOR SELECT USING (true);



CREATE POLICY "Public can view public feed items" ON "public"."feed_items" FOR SELECT USING ((("is_public" = true) AND ("status" = ANY (ARRAY['approved'::"text", 'sent'::"text"]))));



CREATE POLICY "Public can view public wiki docs" ON "public"."wiki_docs" FOR SELECT USING ((("status" = 'Published'::"text") AND ('public'::"text" = ANY ("allowed_roles"))));



CREATE POLICY "Roles manageable by org admins" ON "public"."organization_roles" USING ((("organization_id" IN ( SELECT "organizations"."id"
   FROM "public"."organizations"
  WHERE ("organizations"."owner_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."get_user_memberships"("auth"."uid"()) "m"("member_id", "member_name", "organization_id", "organization_name", "organization_slug", "app_role")
  WHERE (("m"."organization_id" = "organization_roles"."organization_id") AND ("m"."app_role" = 'admin'::"text"))))));



CREATE POLICY "Roles viewable by org members" ON "public"."organization_roles" FOR SELECT USING (("organization_id" IN ( SELECT "get_user_memberships"."organization_id"
   FROM "public"."get_user_memberships"("auth"."uid"()) "get_user_memberships"("member_id", "member_name", "organization_id", "organization_name", "organization_slug", "app_role"))));



CREATE POLICY "Super Admin View" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() = '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c'::"uuid"));



CREATE POLICY "Uploader can delete their own files" ON "public"."files" FOR DELETE TO "authenticated" USING (("uploaded_by" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Uploader can update their own files" ON "public"."files" FOR UPDATE TO "authenticated" USING (("uploaded_by" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Uploader or admin can delete" ON "public"."files" FOR DELETE USING ((("uploaded_by" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text"))))));



CREATE POLICY "Uploader or admin can update" ON "public"."files" FOR UPDATE USING ((("uploaded_by" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text"))))));



CREATE POLICY "Users can create organizations" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own tasks" ON "public"."user_tasks" FOR DELETE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own tasks" ON "public"."user_tasks" FOR INSERT WITH CHECK (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can manage messages in their sessions" ON "public"."chat_messages" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chat_sessions"
  WHERE (("chat_sessions"."id" = "chat_messages"."session_id") AND ("chat_sessions"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chat_sessions"
  WHERE (("chat_sessions"."id" = "chat_messages"."session_id") AND ("chat_sessions"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can manage their own active session" ON "public"."active_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own chat sessions" ON "public"."chat_sessions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own skills" ON "public"."member_skills" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."id" = "member_skills"."member_id") AND ("members"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."id" = "member_skills"."member_id") AND ("members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can read global knowledge or their org knowledge" ON "public"."knowledge_base" FOR SELECT USING (((("organization_id" IS NULL) OR ("organization_id" IN ( SELECT "members"."organization_id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"())))) AND (("file_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."files"
  WHERE ("files"."id" = "knowledge_base"."file_id"))))));



CREATE POLICY "Users can see own membership" ON "public"."members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own tasks" ON "public"."user_tasks" FOR UPDATE USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view member skills in their organization" ON "public"."member_skills" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."members" "m"
     JOIN "public"."skills" "s" ON (("s"."id" = "member_skills"."skill_id")))
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "s"."organization_id")))));



CREATE POLICY "Users can view skills in their organization" ON "public"."skills" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "skills"."organization_id")))));



CREATE POLICY "Users can view their own tasks" ON "public"."user_tasks" FOR SELECT USING (("member_id" IN ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."user_id" = "auth"."uid"()))));



CREATE POLICY "View files based on org and visibility" ON "public"."files" FOR SELECT USING (((("organization_id" IS NULL) OR "public"."is_member_of_org"("organization_id")) AND (("visibility" = 'public'::"text") OR (("visibility" = 'member'::"text") AND ("auth"."uid"() IS NOT NULL)) OR (("visibility" = ANY (ARRAY['committee'::"text", 'admin'::"text"])) AND "public"."is_admin_of_org"("organization_id")) OR (("visibility" = 'ag-only'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."working_group_members" "wgm"
  WHERE (("wgm"."member_id" = ( SELECT "members"."id"
           FROM "public"."members"
          WHERE ("members"."user_id" = "auth"."uid"())
         LIMIT 1)) AND ("wgm"."working_group_id" = "files"."working_group_id"))))))));



CREATE POLICY "View files based on visibility" ON "public"."files" FOR SELECT USING ((("visibility" = 'public'::"text") OR (("visibility" = 'member'::"text") AND ("auth"."uid"() IS NOT NULL)) OR (("visibility" = 'committee'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"])))))) OR (("visibility" = 'admin'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."app_role" = 'admin'::"text"))))) OR (("visibility" = 'ag-only'::"text") AND ("working_group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM ("public"."ag_memberships" "am"
     JOIN "public"."members" "m" ON (("am"."member_id" = "m"."id")))
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("am"."working_group_id" = "files"."working_group_id")))))));



CREATE POLICY "View poll options" ON "public"."poll_options" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."feed_items"
     JOIN "public"."members" ON (("members"."organization_id" = "feed_items"."organization_id")))
  WHERE (("feed_items"."id" = "poll_options"."feed_item_id") AND ("members"."user_id" = "auth"."uid"())))));



CREATE POLICY "View signups" ON "public"."event_slot_signups" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_slot_signups"."organization_id")))));



CREATE POLICY "View slots" ON "public"."event_slots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."organization_id" = "event_slots"."organization_id")))));



CREATE POLICY "View votes" ON "public"."poll_votes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."poll_options"
     JOIN "public"."feed_items" ON (("feed_items"."id" = "poll_options"."feed_item_id")))
     JOIN "public"."members" ON (("members"."organization_id" = "feed_items"."organization_id")))
  WHERE (("poll_options"."id" = "poll_votes"."option_id") AND ("members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Wiki: Delete" ON "public"."wiki_docs" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_docs"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))));



CREATE POLICY "Wiki: Insert" ON "public"."wiki_docs" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("organization_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_docs"."organization_id"))))));



CREATE POLICY "Wiki: Public Read" ON "public"."wiki_docs" FOR SELECT USING ((("status" = 'Published'::"text") AND ("working_group_id" IS NULL) AND ('public'::"text" = ANY ("allowed_roles"))));



CREATE POLICY "Wiki: Update" ON "public"."wiki_docs" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_docs"."organization_id"))))));



CREATE POLICY "Wiki: View" ON "public"."wiki_docs" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_docs"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"]))))) OR (("status" = 'Published'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_docs"."organization_id") AND (('public'::"text" = ANY ("wiki_docs"."allowed_roles")) OR ("members"."app_role" = ANY ("wiki_docs"."allowed_roles")))))))));



CREATE POLICY "WikiCat: Delete" ON "public"."wiki_categories" FOR DELETE USING ((("auth"."role"() = 'authenticated'::"text") AND ((("working_group_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"])))))) OR (("working_group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ag_memberships"
  WHERE (("ag_memberships"."member_id" = ( SELECT "members"."id"
           FROM "public"."members"
          WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id")))) AND ("ag_memberships"."working_group_id" = "wiki_categories"."working_group_id") AND ("ag_memberships"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))))));



CREATE POLICY "WikiCat: Insert" ON "public"."wiki_categories" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("organization_id" IS NOT NULL) AND ((("working_group_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"])))))) OR (("working_group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ag_memberships"
  WHERE (("ag_memberships"."member_id" = ( SELECT "members"."id"
           FROM "public"."members"
          WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id")))) AND ("ag_memberships"."working_group_id" = "wiki_categories"."working_group_id") AND ("ag_memberships"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))))));



CREATE POLICY "WikiCat: Update" ON "public"."wiki_categories" FOR UPDATE USING ((("auth"."role"() = 'authenticated'::"text") AND ((("working_group_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id") AND ("members"."app_role" = ANY (ARRAY['admin'::"text", 'committee'::"text"])))))) OR (("working_group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ag_memberships"
  WHERE (("ag_memberships"."member_id" = ( SELECT "members"."id"
           FROM "public"."members"
          WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id")))) AND ("ag_memberships"."working_group_id" = "wiki_categories"."working_group_id") AND ("ag_memberships"."role" = ANY (ARRAY['lead'::"text", 'admin'::"text"])))))))));



CREATE POLICY "WikiCat: View" ON "public"."wiki_categories" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."members"
  WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id")))) AND (("working_group_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."ag_memberships"
  WHERE (("ag_memberships"."member_id" = ( SELECT "members"."id"
           FROM "public"."members"
          WHERE (("members"."user_id" = "auth"."uid"()) AND ("members"."organization_id" = "wiki_categories"."organization_id")))) AND ("ag_memberships"."working_group_id" = "wiki_categories"."working_group_id")))))));



ALTER TABLE "public"."active_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ag_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_guest_organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_slot_signups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_public_read" ON "public"."events" FOR SELECT USING (true);



ALTER TABLE "public"."feed_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."newsletter_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."poll_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."poll_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wiki_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wiki_docs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."working_group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."working_groups" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_skills"("org_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_skills"("org_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_skills"("org_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_event_guest_count"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_event_guest_count"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_event_guest_count"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_member_skills"("member_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_member_skills"("member_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_skills"("member_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_members_by_skills"("org_uuid" "uuid", "skill_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_members_by_skills"("org_uuid" "uuid", "skill_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_members_by_skills"("org_uuid" "uuid", "skill_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_member_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_member_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_member_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_memberships"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_linking"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_linking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_linking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text", "org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text", "org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("permission_key" "text", "org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_of_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_of_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_of_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ag_admin"("ag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ag_admin"("ag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ag_admin"("ag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_ag"("ag_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of_ag"("ag_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_ag"("ag_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_owner_of_org"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_owner_of_org"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_owner_of_org"("org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."match_knowledge"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."match_knowledge"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_knowledge"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."on_organization_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_organization_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_organization_created"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_get_role"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."test_get_role"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_get_role"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."test_get_role_v2"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."test_get_role_v2"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_get_role_v2"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_create_default_org_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_create_default_org_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_create_default_org_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_protect_org_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_protect_org_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_protect_org_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ag_members_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ag_members_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ag_members_count"() TO "service_role";



GRANT ALL ON TABLE "public"."active_sessions" TO "anon";
GRANT ALL ON TABLE "public"."active_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."active_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."ag_memberships" TO "anon";
GRANT ALL ON TABLE "public"."ag_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."ag_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."event_guest_organizations" TO "anon";
GRANT ALL ON TABLE "public"."event_guest_organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_guest_organizations" TO "service_role";



GRANT ALL ON TABLE "public"."event_registrations" TO "anon";
GRANT ALL ON TABLE "public"."event_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_registrations" TO "service_role";



GRANT ALL ON TABLE "public"."event_slot_signups" TO "anon";
GRANT ALL ON TABLE "public"."event_slot_signups" TO "authenticated";
GRANT ALL ON TABLE "public"."event_slot_signups" TO "service_role";



GRANT ALL ON TABLE "public"."event_slots" TO "anon";
GRANT ALL ON TABLE "public"."event_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."event_slots" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."feed_items" TO "anon";
GRANT ALL ON TABLE "public"."feed_items" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_items" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_submissions" TO "anon";
GRANT ALL ON TABLE "public"."feedback_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."folders" TO "anon";
GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_base" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_base" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_base" TO "service_role";



GRANT ALL ON TABLE "public"."member_skills" TO "anon";
GRANT ALL ON TABLE "public"."member_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."member_skills" TO "service_role";



GRANT ALL ON TABLE "public"."members" TO "anon";
GRANT ALL ON TABLE "public"."members" TO "authenticated";
GRANT ALL ON TABLE "public"."members" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter_config" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_config" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_config" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_progress" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_progress" TO "service_role";



GRANT ALL ON TABLE "public"."organization_roles" TO "anon";
GRANT ALL ON TABLE "public"."organization_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_roles" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."poll_options" TO "anon";
GRANT ALL ON TABLE "public"."poll_options" TO "authenticated";
GRANT ALL ON TABLE "public"."poll_options" TO "service_role";



GRANT ALL ON TABLE "public"."poll_votes" TO "anon";
GRANT ALL ON TABLE "public"."poll_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."poll_votes" TO "service_role";



GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";



GRANT ALL ON TABLE "public"."user_tasks" TO "anon";
GRANT ALL ON TABLE "public"."user_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."wiki_categories" TO "anon";
GRANT ALL ON TABLE "public"."wiki_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."wiki_categories" TO "service_role";



GRANT ALL ON TABLE "public"."wiki_docs" TO "anon";
GRANT ALL ON TABLE "public"."wiki_docs" TO "authenticated";
GRANT ALL ON TABLE "public"."wiki_docs" TO "service_role";



GRANT ALL ON TABLE "public"."working_group_members" TO "anon";
GRANT ALL ON TABLE "public"."working_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."working_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."working_groups" TO "anon";
GRANT ALL ON TABLE "public"."working_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."working_groups" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







