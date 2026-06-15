-- Fix create_default_skills to run as SECURITY DEFINER to bypass RLS during org creation
CREATE OR REPLACE FUNCTION public.create_default_skills(org_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

-- Fix is_admin_of_org to use valid app_role column
CREATE OR REPLACE FUNCTION public.is_admin_of_org(org_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM members
        WHERE user_id = auth.uid()
        AND organization_id = org_id
        AND app_role = 'admin'
    );
END;
$function$;
