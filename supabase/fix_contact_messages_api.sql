-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: contact_messages / subscribers return 404 (PGRST205) from the REST API
--
-- Run this in the Supabase dashboard → SQL Editor. It is idempotent.
--
-- Diagnosis (verified against the live database on 2026-08-30):
--   • Both tables EXIST in public.
--   • RLS is enabled on both, with 2 policies each.
--   • anon / authenticated hold the same grants as public.expenses, which the
--     app queries successfully.
--
-- With the table present, RLS on, and grants matching a working table, a 404
-- from PostgREST means its cached view of the schema predates the table. The
-- NOTIFY at the bottom is the fix.
--
-- The policy rewrite above it is a separate correction and is the reason this
-- file re-declares them rather than only sending the NOTIFY: the policies
-- currently in the database were created from the original migration, which
-- tested membership with an inline
--
--     EXISTS (SELECT 1 FROM user_roles ur
--             WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
--
-- That has two problems. It does not check role_status, so a revoked or
-- not-yet-approved admin row still opens the whole inbox and the full mailing
-- list; and it reads user_roles from inside a policy, subject to that table's
-- own RLS. public.is_admin() is SECURITY DEFINER and checks
-- role_status = 'approved'.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── contact_messages ─────────────────────────────────────────────────────────

-- Anyone (incl. anonymous visitors) may submit a message.
DROP POLICY IF EXISTS "anyone can submit contact message" ON public.contact_messages;
CREATE POLICY "anyone can submit contact message"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Approved admins may read / update / delete.
DROP POLICY IF EXISTS "admins manage contact messages" ON public.contact_messages;
CREATE POLICY "admins manage contact messages"
  ON public.contact_messages FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ── subscribers ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anyone can subscribe" ON public.subscribers;
CREATE POLICY "anyone can subscribe"
  ON public.subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "admins manage subscribers" ON public.subscribers;
CREATE POLICY "admins manage subscribers"
  ON public.subscribers FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMIT;

-- ── The actual 404 fix ───────────────────────────────────────────────────────
-- Outside the transaction: PostgREST listens for this and rebuilds its schema
-- cache. Until it fires, every request to a table it has not seen returns
-- 404 PGRST205 no matter how correct the table is.
NOTIFY pgrst, 'reload schema';
