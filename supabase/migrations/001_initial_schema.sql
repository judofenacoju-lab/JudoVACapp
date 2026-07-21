-- JudoVACapp Web — schéma Supabase initial
-- Exécuter via Supabase CLI ou SQL Editor du dashboard

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profils utilisateurs (liés à auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Séquence pour display_id (JV-2026-00042)
CREATE TABLE public.judoka_seq (
  year INT PRIMARY KEY,
  seq INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_display_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  y INT := EXTRACT(YEAR FROM NOW())::INT;
  s INT;
BEGIN
  INSERT INTO public.judoka_seq (year, seq) VALUES (y, 1)
  ON CONFLICT (year) DO UPDATE SET seq = public.judoka_seq.seq + 1
  RETURNING seq INTO s;
  RETURN 'JV-' || y || '-' || LPAD(s::TEXT, 5, '0');
END;
$$;

-- Judokas
CREATE TABLE public.judokas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_id TEXT UNIQUE NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
  birth_date DATE NOT NULL,
  age INT NOT NULL DEFAULT 0,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  commune TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  club TEXT NOT NULL DEFAULT '',
  league TEXT NOT NULL DEFAULT '',
  sport_province TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  belt TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  weight_kg NUMERIC(5,1),
  height_cm NUMERIC(5,1),
  license_number TEXT NOT NULL DEFAULT '',
  affiliation_year INT,
  photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  created_workstation TEXT NOT NULL DEFAULT 'web',
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'conflict', 'local')),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_judokas_created_by ON public.judokas(created_by);
CREATE INDEX idx_judokas_search ON public.judokas USING gin (
  to_tsvector('simple', coalesce(last_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(display_id, '') || ' ' || coalesce(club, ''))
);

-- Paramètres applicatifs (singleton)
CREATE TABLE public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (id, settings) VALUES ('default', '{}'::JSONB)
ON CONFLICT (id) DO NOTHING;

-- Modèles de badges
CREATE TABLE public.badge_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  template JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.badge_template_meta (
  id TEXT PRIMARY KEY DEFAULT 'default',
  active_template_id TEXT NOT NULL DEFAULT 'default',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.badge_template_meta (id, active_template_id) VALUES ('default', 'default')
ON CONFLICT (id) DO NOTHING;

-- Journal système
CREATE TABLE public.system_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT,
  workstation TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_logs_created_at ON public.system_logs(created_at DESC);

-- Trigger profil à l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'operator')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger updated_at judokas
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER judokas_updated_at
  BEFORE UPDATE ON public.judokas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helpers RLS
CREATE OR REPLACE FUNCTION public.current_username()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT username FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = TRUE
  );
$$;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judokas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_template_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judoka_seq ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY profiles_admin_all ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Judokas
CREATE POLICY judokas_select ON public.judokas FOR SELECT TO authenticated
  USING (
    public.is_active_user() AND (
      public.is_admin() OR created_by = public.current_username()
    )
  );
CREATE POLICY judokas_insert ON public.judokas FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user() AND (
      public.is_admin() OR created_by = public.current_username()
    )
  );
CREATE POLICY judokas_update ON public.judokas FOR UPDATE TO authenticated
  USING (
    public.is_active_user() AND (
      public.is_admin() OR created_by = public.current_username()
    )
  );
CREATE POLICY judokas_delete ON public.judokas FOR DELETE TO authenticated
  USING (
    public.is_active_user() AND (
      public.is_admin() OR created_by = public.current_username()
    )
  );

-- Settings (lecture tous, écriture admin)
CREATE POLICY settings_select ON public.app_settings FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY settings_write ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Badge templates
CREATE POLICY badge_templates_select ON public.badge_templates FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY badge_templates_write ON public.badge_templates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY badge_meta_select ON public.badge_template_meta FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY badge_meta_write ON public.badge_template_meta FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Logs
CREATE POLICY logs_select ON public.system_logs FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY logs_insert ON public.system_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());

-- Séquence display_id (insert via fonction)
CREATE POLICY judoka_seq_admin ON public.judoka_seq FOR ALL TO authenticated
  USING (public.is_active_user()) WITH CHECK (public.is_active_user());

-- Storage : buckets photos et badge-assets (créer d'abord les buckets dans le dashboard)
-- Politiques recommandées (Storage → Policies) :
-- photos : SELECT public, INSERT/UPDATE authenticated
-- badge-assets : SELECT public, INSERT/UPDATE admin only
