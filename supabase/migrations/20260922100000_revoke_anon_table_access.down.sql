-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20260922100000_revoke_anon_table_access.sql
--
-- This puts the eight tables back on the public internet. Only run it if the
-- revoke broke something you cannot otherwise explain, and put it back after.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP POLICY IF EXISTS "All users can view inventory"        ON public.inventory;
CREATE POLICY "All users can view inventory" ON public.inventory
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view products"         ON public.products;
CREATE POLICY "All users can view products" ON public.products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view skus"             ON public.skus;
CREATE POLICY "All users can view skus" ON public.skus
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view warehouses"       ON public.warehouses;
CREATE POLICY "All users can view warehouses" ON public.warehouses
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view transactions"     ON public.transactions;
CREATE POLICY "All users can view transactions" ON public.transactions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view unit conversions" ON public.unit_conversions;
CREATE POLICY "All users can view unit conversions" ON public.unit_conversions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view stock takes"      ON public.stock_takes;
CREATE POLICY "All users can view stock takes" ON public.stock_takes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "All users can view stock take items" ON public.stock_take_items;
CREATE POLICY "All users can view stock take items" ON public.stock_take_items
  FOR SELECT USING (true);

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon';
  END IF;
END $$;

GRANT ALL     ON ALL TABLES    IN SCHEMA public TO anon;
GRANT ALL     ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
