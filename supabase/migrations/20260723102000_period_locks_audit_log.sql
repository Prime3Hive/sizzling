-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION (3/3): Period locking & audit trail
--
-- Fixes from the 2026-07 financial audit:
--   B6  Nothing stopped retroactive edits — March could be rewritten in July,
--       and no record existed of who changed what.
--       → period_locks: admin closes the books through a date; any journal
--         posting/unposting dated inside a locked period is rejected. Because
--         every financial edit re-posts its journal (delete + recreate), this
--         transitively freezes source documents in closed periods too.
--       → audit_log: immutable who/what/when + old/new snapshots for every
--         write to the financial tables (FIRS 6-year record-keeping, ISA 230).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Period locks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.period_locks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  locked_through date        NOT NULL,
  note           text,
  locked_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "period_locks_admin_all" ON public.period_locks;
CREATE POLICY "period_locks_admin_all" ON public.period_locks
  FOR ALL TO authenticated
  USING     (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "period_locks_read" ON public.period_locks;
CREATE POLICY "period_locks_read" ON public.period_locks
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.period_locks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.period_locks TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_books_locked(p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p_date <= (SELECT max(locked_through) FROM public.period_locks), false);
$$;

-- Journals are the enforcement point: block INSERT into, UPDATE across, and
-- DELETE from locked periods. Auto-posting runs as SECURITY DEFINER but
-- triggers still fire, so locked-period source edits fail atomically.
CREATE OR REPLACE FUNCTION public.fn_guard_journal_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND public.fn_books_locked(NEW.entry_date) THEN
    RAISE EXCEPTION 'Books are closed through %: cannot post journal dated % (%). Reopen the period or use a current-dated correcting entry.',
      (SELECT max(locked_through) FROM public.period_locks), NEW.entry_date, COALESCE(NEW.memo, '');
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND public.fn_books_locked(OLD.entry_date) THEN
    RAISE EXCEPTION 'Books are closed through %: journal dated % (%) is locked and cannot be modified or removed.',
      (SELECT max(locked_through) FROM public.period_locks), OLD.entry_date, COALESCE(OLD.memo, '');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_journal_period ON public.journal_entries;
CREATE TRIGGER trg_guard_journal_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_journal_period();

-- Lines of a locked entry are equally immutable.
CREATE OR REPLACE FUNCTION public.fn_guard_journal_line_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date;
BEGIN
  SELECT entry_date INTO d FROM public.journal_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  -- If the entry row is already gone (cascade from a permitted entry delete),
  -- there is nothing further to guard.
  IF d IS NOT NULL AND public.fn_books_locked(d) THEN
    RAISE EXCEPTION 'Books are closed through %: journal lines dated % are locked.',
      (SELECT max(locked_through) FROM public.period_locks), d;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_journal_line_period ON public.journal_lines;
CREATE TRIGGER trg_guard_journal_line_period
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_journal_line_period();

-- ── 2. Audit log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         bigserial    PRIMARY KEY,
  table_name text         NOT NULL,
  record_id  uuid,
  action     text         NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor      uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  old_data   jsonb,
  new_data   jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_time   ON public.audit_log(occurred_at);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Read: admins only. No INSERT/UPDATE/DELETE policies — rows are written
-- exclusively by the SECURITY DEFINER trigger below and are immutable via API.
DROP POLICY IF EXISTS "audit_log_admin_read" ON public.audit_log;
CREATE POLICY "audit_log_admin_read" ON public.audit_log
  FOR SELECT TO authenticated USING (is_admin(auth.uid()));

GRANT SELECT ON public.audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log (table_name, record_id, action, actor, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE((to_jsonb(NEW) ->> 'id')::uuid, (to_jsonb(OLD) ->> 'id')::uuid),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices', 'invoice_payments', 'expenses', 'payroll_records',
    'sales', 'payments', 'payables'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row()', t, t);
  END LOOP;
END $$;
