-- ═══════════════════════════════════════════════════════════════════
-- JudoVACapp — Storage buckets + présence utilisateurs
-- Exécuter dans Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- Buckets Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('photos', 'photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']),
  ('badge-assets', 'badge-assets', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies Storage (lecture publique, écriture utilisateurs actifs)
DROP POLICY IF EXISTS photos_public_read ON storage.objects;
DROP POLICY IF EXISTS photos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS photos_auth_update ON storage.objects;
DROP POLICY IF EXISTS photos_auth_delete ON storage.objects;
DROP POLICY IF EXISTS badge_assets_public_read ON storage.objects;
DROP POLICY IF EXISTS badge_assets_auth_write ON storage.objects;

CREATE POLICY photos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'photos');

CREATE POLICY photos_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos');

CREATE POLICY photos_auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'photos')
  WITH CHECK (bucket_id = 'photos');

CREATE POLICY photos_auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos');

CREATE POLICY badge_assets_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'badge-assets');

CREATE POLICY badge_assets_auth_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'badge-assets')
  WITH CHECK (bucket_id = 'badge-assets');

-- Présence (clients connectés)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

NOTIFY pgrst, 'reload schema';
