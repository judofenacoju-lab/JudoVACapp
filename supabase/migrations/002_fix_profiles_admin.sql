-- Réparation : table profiles + compte admin
-- À exécuter dans Supabase → SQL Editor si la connexion échoue silencieusement

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Fonctions RLS (si absentes)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active = TRUE); $$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = TRUE); $$;

CREATE OR REPLACE FUNCTION public.current_username()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT username FROM public.profiles WHERE id = auth.uid(); $$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY profiles_admin_all ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Profil admin pour judovac@mail.com
INSERT INTO public.profiles (id, username, display_name, role, active)
SELECT id, 'admin', 'Administrateur', 'admin', TRUE
FROM auth.users
WHERE email = 'judovac@mail.com'
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  username = 'admin',
  display_name = 'Administrateur',
  active = TRUE;

-- Recharger le cache API Supabase
NOTIFY pgrst, 'reload schema';
