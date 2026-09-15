-- Table fourre-tout pour les erreurs runtime qu'on ne peut pas lire dans
-- les logs Vercel (rétention courte). Les Server Actions y insèrent un
-- enregistrement avant de re-throw, et le CEO peut consulter via SQL.

CREATE TABLE IF NOT EXISTS public.app_error_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,            -- ex: 'createInterventionAction'
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  message     text,
  details     jsonb,
  payload     jsonb
);

CREATE INDEX IF NOT EXISTS idx_app_error_logs_occurred_at
  ON public.app_error_logs(occurred_at DESC);

-- Pas de RLS : seul le service_role (Server Actions) écrit ici. La lecture
-- se fait via SQL direct (Supabase Studio / MCP), pas via l'app.
ALTER TABLE public.app_error_logs DISABLE ROW LEVEL SECURITY;
