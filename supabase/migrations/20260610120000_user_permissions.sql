-- ─────────────────────────────────────────────────────────────────────────────
-- user_permissions — per-user module access overrides
--
-- Layered on top of department_permissions. Resolution precedence:
--   admin            → full access
--   user override    → if a row exists for (user, module), it wins
--   department perms  → otherwise fall back to the department's permission
--   else             → deny
--
-- Lets an admin grant a specific staff member access to a module their
-- department lacks, or restrict a module for one person — without changing
-- the whole department.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_name text        NOT NULL,
  can_view    boolean     NOT NULL DEFAULT false,
  can_create  boolean     NOT NULL DEFAULT false,
  can_update  boolean     NOT NULL DEFAULT false,
  can_delete  boolean     NOT NULL DEFAULT false,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_name)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON public.user_permissions(user_id);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- A user may read their own overrides (needed to resolve permissions);
-- admins may read everyone's.
DROP POLICY IF EXISTS "user_permissions_read" ON public.user_permissions;
CREATE POLICY "user_permissions_read" ON public.user_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

-- Only admins can create / update / delete overrides.
DROP POLICY IF EXISTS "user_permissions_admin_write" ON public.user_permissions;
CREATE POLICY "user_permissions_admin_write" ON public.user_permissions
  FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
