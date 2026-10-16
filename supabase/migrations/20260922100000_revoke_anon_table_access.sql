-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY AUDIT (1/2): no table is readable without logging in
--
-- Eight tables were world-readable. A policy written as
--
--     CREATE POLICY "All users can view products" ON public.products
--       FOR SELECT USING (true);          -- no TO clause
--
-- applies TO PUBLIC, and PUBLIC includes `anon` — the role the publishable key
-- in the browser bundle authenticates as. "All users" meant all users of the
-- internet, not all staff. Verified against production on 2026-09-22: an
-- unauthenticated GET on each of these returned rows, including purchase and
-- sale prices from `transactions` and cost_per_unit from `skus`.
--
--   inventory  products  skus  warehouses  transactions  unit_conversions
--   stock_takes  stock_take_items
--
-- Two fixes, because either alone can be undone by a careless later migration:
--
--   1. Rewrite those eight policies with TO authenticated.
--   2. Revoke anon's table privileges across the whole schema and change the
--      default privileges so tables created from here on are not granted to
--      anon either. RLS and the GRANT are independent gates; PostgREST needs
--      both, so the revoke holds even if someone re-adds a USING (true).
--
-- anon keeps exactly one thing: INSERT on the two public website forms.
-- Nothing else in the app talks to the database before login.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The eight world-readable SELECT policies ──────────────────────────────

DROP POLICY IF EXISTS "All users can view inventory"         ON public.inventory;
CREATE POLICY "All users can view inventory" ON public.inventory
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view products"          ON public.products;
CREATE POLICY "All users can view products" ON public.products
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view skus"              ON public.skus;
CREATE POLICY "All users can view skus" ON public.skus
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view warehouses"        ON public.warehouses;
CREATE POLICY "All users can view warehouses" ON public.warehouses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view transactions"      ON public.transactions;
CREATE POLICY "All users can view transactions" ON public.transactions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view unit conversions"  ON public.unit_conversions;
CREATE POLICY "All users can view unit conversions" ON public.unit_conversions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view stock takes"       ON public.stock_takes;
CREATE POLICY "All users can view stock takes" ON public.stock_takes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "All users can view stock take items"  ON public.stock_take_items;
CREATE POLICY "All users can view stock take items" ON public.stock_take_items
  FOR SELECT TO authenticated USING (true);

-- The matching "Admins can manage X" policies from the same 2025-09-24
-- migration are also TO PUBLIC, but they read is_admin(auth.uid()), which is
-- false for an anonymous request, so they grant anon nothing. Pinned to
-- authenticated anyway so the whole table reads as deliberate, and given an
-- explicit WITH CHECK rather than relying on USING standing in for it.
DROP POLICY IF EXISTS "Admins can manage inventory"        ON public.inventory;
CREATE POLICY "Admins can manage inventory" ON public.inventory
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage products"         ON public.products;
CREATE POLICY "Admins can manage products" ON public.products
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage skus"             ON public.skus;
CREATE POLICY "Admins can manage skus" ON public.skus
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage warehouses"       ON public.warehouses;
CREATE POLICY "Admins can manage warehouses" ON public.warehouses
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage transactions"     ON public.transactions;
CREATE POLICY "Admins can manage transactions" ON public.transactions
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage unit conversions" ON public.unit_conversions;
CREATE POLICY "Admins can manage unit conversions" ON public.unit_conversions
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage stock takes"      ON public.stock_takes;
CREATE POLICY "Admins can manage stock takes" ON public.stock_takes
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage stock take items" ON public.stock_take_items;
CREATE POLICY "Admins can manage stock take items" ON public.stock_take_items
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- ── 2. Take anon's privileges away schema-wide ───────────────────────────────
-- Supabase's stock grants hand anon SELECT/INSERT/UPDATE/DELETE on everything
-- in public and rely on RLS alone to hold the line. One policy without a TO
-- clause is then enough to publish a table. Revoke the grant so RLS becomes the
-- second lock rather than the only one.

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Functions need the two-step. Postgres grants EXECUTE on every new function to
-- PUBLIC, and PUBLIC is not a role you can revoke from by naming anon — so
-- `REVOKE ... FROM anon` alone leaves every function in the schema callable as
-- an RPC by an anonymous caller, including generate_invoice_number(), which
-- burns a number off the sequence each time it runs. Revoke from PUBLIC, then
-- grant back to the two roles that had it in practice. authenticated ends up
-- with exactly what it already had through PUBLIC; anon ends up with nothing.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Signup fires public.handle_new_user() / handle_new_user_role() from a trigger
-- on auth.users, as supabase_auth_admin. Postgres checks EXECUTE when a trigger
-- is created, not when it fires, so this is belt-and-braces — but a broken
-- signup is an expensive way to find out that reading of the manual was wrong.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin';
  END IF;
END $$;

-- Tables created from here on are not granted to anon either. Default
-- privileges are recorded per granting role, so set it for both roles that
-- own migrations on Supabase.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Only when this session may act for supabase_admin. The dashboard SQL editor
-- runs as `postgres`, which on current Supabase projects is NOT a member of
-- supabase_admin, and the statement fails with "permission denied to change
-- default privileges". Skipping is safe: migrations here are created by
-- postgres, whose defaults were changed just above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role';
  ELSE
    RAISE NOTICE 'Skipped supabase_admin default privileges: % is not a member of supabase_admin.', current_user;
  END IF;
END $$;

-- ── 3. Hand back the only two things the public website needs ────────────────
-- /contact submits a message and subscribes to the mailing list, both as anon.
-- INSERT only: neither form reads anything back (no .select() on the insert),
-- so anon cannot enumerate the inbox or the subscriber list.

GRANT USAGE  ON SCHEMA public           TO anon;
GRANT INSERT ON public.contact_messages TO anon;
GRANT INSERT ON public.subscribers      TO anon;

COMMIT;

-- PostgREST caches privileges with the schema. Without this the old grants stay
-- live until the API happens to restart.
NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Everything anon can still touch. Expect exactly two INSERT rows.
--
--   SELECT table_name, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public'
--    ORDER BY table_name, privilege_type;
--
-- Any read policy still open to the internet. Expect zero rows.
--
--   SELECT tablename, policyname, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
--      AND cmd IN ('SELECT', 'ALL');
--
-- Any function an anonymous caller can still invoke as an RPC. Expect zero.
--
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND (has_function_privilege('anon', p.oid, 'EXECUTE'));
--
-- Any table with RLS off. Expect zero rows.
--
--   SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
