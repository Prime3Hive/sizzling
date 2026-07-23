-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION (1/3): Payroll — statutory deductions & correct GL posting
--
-- Fixes from the 2026-07 financial audit:
--   A1  Salaries double-counted: marking payroll paid also inserted a net-pay
--       expense row, so staff cost hit the books twice (5100 payroll journal
--       + 5400 expense journal, and payroll + expenses in every report).
--       → the app no longer writes that expense; this migration deletes the
--       historical auto-created "Salary payment — …" rows (their journals
--       unpost via the existing expense trigger).
--   A3  Payroll journal posted net pay only, so PAYE / pension / NHF withheld
--       from staff existed nowhere in the ledger.
--       → payroll_records now carries a statutory breakdown and fn_post_payroll
--       posts a gross-based compound entry with statutory liability accounts.
--   B9  Duplicate payroll guard was a client-side read (race-prone).
--       → real UNIQUE constraint per staff/period.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Statutory liability / expense accounts ────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('2300', 'PAYE Payable',                    'liability', 'credit', 62),
  ('2310', 'Pension Payable',                 'liability', 'credit', 64),
  ('2320', 'NHF Payable',                     'liability', 'credit', 66),
  ('2340', 'Other Payroll Deductions Payable','liability', 'credit', 68),
  ('5110', 'Employer Pension Contribution',   'expense',   'debit',  145)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Statutory breakdown on payroll records ────────────────────────────────
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS paye             numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_employee numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_employer numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhf              numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deductions numeric(14,2) NOT NULL DEFAULT 0;

-- One payroll row per staff member per period (B9). Unpaid duplicates from the
-- old race-prone client check are dropped (keeping the oldest row); if paid
-- duplicates exist they need human review, so the index is skipped with a
-- warning instead of failing the migration.
DELETE FROM public.payroll_records pr
USING public.payroll_records keep
WHERE pr.staff_profile_id = keep.staff_profile_id
  AND pr.period_start     = keep.period_start
  AND pr.period_end       = keep.period_end
  AND pr.id <> keep.id
  AND pr.status <> 'paid'
  AND keep.created_at < pr.created_at;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_staff_period
    ON public.payroll_records (staff_profile_id, period_start, period_end);
EXCEPTION WHEN unique_violation OR others THEN
  RAISE WARNING 'uq_payroll_staff_period not created — duplicate PAID payroll rows exist and need manual review: %', SQLERRM;
END $$;

-- ── 3. Gross-based payroll posting ───────────────────────────────────────────
-- Entry for a paid payroll record (all amounts per record):
--   Dr 5100 Salaries & Wages            gross (basic + allowances)
--   Dr 5110 Employer Pension            pension_employer
--   Cr 2300 PAYE Payable                paye
--   Cr 2310 Pension Payable             pension_employee + pension_employer
--   Cr 2320 NHF Payable                 nhf
--   Cr 2340 Other Deductions Payable    deductions − (paye + pension_employee + nhf)
--   Cr 1010 Bank                        net_pay
-- Legacy rows (statutory columns all 0) degrade to:
--   Dr 5100 gross / Cr 2340 deductions / Cr 1010 net — still balanced, and the
-- lump-sum deduction is at least visible as a liability instead of vanishing.
CREATE OR REPLACE FUNCTION public.fn_post_payroll(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  gross    numeric;
  v_paye   numeric;
  v_pen_e  numeric;
  v_pen_er numeric;
  v_nhf    numeric;
  v_other  numeric;
  lines    jsonb;
BEGIN
  SELECT * INTO p FROM public.payroll_records WHERE id = p_id;
  IF NOT FOUND OR p.status <> 'paid' OR COALESCE(p.net_pay, 0) <= 0 THEN
    PERFORM public.fn_unpost('payroll', p_id); RETURN;
  END IF;

  gross    := COALESCE(p.basic_salary, 0) + COALESCE(p.allowances, 0);
  v_paye   := COALESCE(p.paye, 0);
  v_pen_e  := COALESCE(p.pension_employee, 0);
  v_pen_er := COALESCE(p.pension_employer, 0);
  v_nhf    := COALESCE(p.nhf, 0);
  -- Whatever part of total deductions is not statutory. Derived (rather than
  -- read from other_deductions) so the entry always balances even if the
  -- columns drift; a negative residue means the record itself is inconsistent.
  v_other  := COALESCE(p.deductions, 0) - v_paye - v_pen_e - v_nhf;
  IF v_other < 0 THEN
    RAISE EXCEPTION 'Payroll record % is inconsistent: deductions (%) are less than statutory components (PAYE % + pension % + NHF %)',
      p_id, p.deductions, v_paye, v_pen_e, v_nhf;
  END IF;

  lines := jsonb_build_array(
    jsonb_build_object('code', '5100', 'debit', gross, 'credit', 0, 'desc', 'Gross salary')
  );
  IF v_pen_er > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '5110', 'debit', v_pen_er, 'credit', 0, 'desc', 'Employer pension (10%)'));
  END IF;
  IF v_paye > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2300', 'debit', 0, 'credit', v_paye, 'desc', 'PAYE withheld'));
  END IF;
  IF v_pen_e + v_pen_er > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2310', 'debit', 0, 'credit', v_pen_e + v_pen_er, 'desc', 'Pension (employee + employer)'));
  END IF;
  IF v_nhf > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2320', 'debit', 0, 'credit', v_nhf, 'desc', 'NHF withheld'));
  END IF;
  IF v_other > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2340', 'debit', 0, 'credit', v_other, 'desc', 'Other deductions'));
  END IF;
  lines := lines || jsonb_build_array(
    jsonb_build_object('code', '1010', 'debit', 0, 'credit', p.net_pay, 'desc', 'Net pay')
  );

  PERFORM public.fn_post_entry(
    COALESCE(p.paid_at::date, p.period_end, p.period_start, p.created_at::date),
    'Payroll — ' || COALESCE(p.staff_name, ''), 'payroll', p.id, lines
  );
END;
$$;

-- ── 4. Remove the historical double-count (A1) ───────────────────────────────
-- Every "mark paid" since the feature shipped inserted a mirror expense row.
-- Deleting it fires trg_auto_post_expense → fn_unpost, removing its journal.
DELETE FROM public.expenses
WHERE category = 'Salaries & Wages'
  AND description LIKE 'Salary payment — %';

-- ── 5. Re-post all paid payroll under the corrected shape ────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.payroll_records WHERE status = 'paid' LOOP
    PERFORM public.fn_post_payroll(r.id);
  END LOOP;
END $$;
-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION (2/3): Revenue recognition & payment integrity
--
-- Fixes from the 2026-07 financial audit:
--   A2  finance_ledger "revenue" rows were posted VAT-inclusive → now net of
--       VAT (VAT is a liability owed to FIRS, never income).
--   A5  Weekly-Sales / sales-report rows posted Dr AR that nothing ever
--       settled → cash-takings sales now debit Cash directly; only sales with
--       real payment records (or still owing) sit in AR.
--   B1  An issued invoice could be silently demoted to quotation (erasing its
--       revenue while keeping its payments) → status transitions and
--       financial fields are now locked once issued.
--   B2  Cancelling a paid invoice orphaned its cash → blocked until payments
--       are removed/reversed.
--   B4  Overpayment / payments against non-issued documents were possible at
--       the API → enforced in a DB trigger.
--   B7  The Finance-Feed receipt row was inserted from the browser after the
--       payment insert (non-atomic, duplicable) → now auto-posted by trigger.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Sales post to Cash when they are cash takings (A5) ────────────────────
-- Debit side:
--   • sale has completed payment rows, or is still pending/partially_paid
--     → Dr 1100 Accounts Receivable (payments settle it)
--   • completed sale with no payment rows (Weekly Sales / approved sales
--     reports = takings already collected) → Dr 1000 Cash
CREATE OR REPLACE FUNCTION public.fn_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; lines jsonb; has_pay boolean; dr_code text;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('sale', p_id); RETURN;
  END IF;

  has_pay := EXISTS (
    SELECT 1 FROM public.payments
    WHERE sale_id = s.id AND status = 'completed' AND COALESCE(amount, 0) > 0
  );
  dr_code := CASE WHEN has_pay OR s.status <> 'completed' THEN '1100' ELSE '1000' END;

  lines := jsonb_build_array(
    jsonb_build_object('code', dr_code, 'debit', s.total_amount, 'credit', 0,
      'desc', CASE WHEN dr_code = '1000' THEN 'Cash takings ' ELSE 'Sale ' END || s.sale_number),
    jsonb_build_object('code', '4000', 'debit', 0, 'credit', s.total_amount, 'desc', 'Sales Revenue')
  );
  PERFORM public.fn_post_entry(s.sale_date, 'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    'sale', s.id, lines);
END;
$$;

-- When a payment appears/disappears the parent sale's debit side must flip
-- between Cash and AR, so re-post the sale alongside the payment.
CREATE OR REPLACE FUNCTION public.trg_post_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_unpost('payment', OLD.id);
    PERFORM public.fn_post_sale(OLD.sale_id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_post_payment(NEW.id);
  PERFORM public.fn_post_sale(NEW.sale_id);
  RETURN NEW;
END; $$;

-- ── 2. Finance-Feed revenue net of VAT (A2) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ledger_post_invoice(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; ref text; net_amt numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_id;
  IF NOT FOUND OR inv.status <> 'invoice' OR COALESCE(inv.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('invoice', p_id);
    RETURN;
  END IF;

  ref     := COALESCE(inv.invoice_number, inv.quotation_number);
  net_amt := inv.total_amount - COALESCE(inv.tax_amount, 0);
  IF net_amt <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('invoice', p_id);
    RETURN;
  END IF;

  DELETE FROM public.finance_ledger
   WHERE source_type = 'invoice' AND source_id = inv.id AND entry_type = 'revenue';

  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    inv.user_id,
    COALESCE(inv.converted_at::date, inv.issue_date),
    'revenue', 'invoice', inv.id,
    'Invoice ' || ref || COALESCE(' — ' || inv.customer_name, '') || ' (net of VAT)',
    net_amt,
    CASE WHEN inv.invoice_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    inv.invoice_type,
    ref,
    COALESCE(inv.updated_by, inv.created_by)
  );
END;
$$;

-- Regenerate existing invoice revenue rows at net amounts.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'invoice' LOOP
    PERFORM public.fn_ledger_post_invoice(r.id);
  END LOOP;
END $$;

-- ── 3. Auto-post invoice receipts to the Finance Feed (B7) ───────────────────
-- Replaces the browser-side finance_ledger insert in InvoiceViewDialog.
-- Keyed by source_type='invoice_payment', source_id=payment id, so each
-- payment posts exactly once and edits/deletes stay in sync.
ALTER TABLE public.finance_ledger DROP CONSTRAINT IF EXISTS finance_ledger_source_type_check;
ALTER TABLE public.finance_ledger
  ADD CONSTRAINT finance_ledger_source_type_check
  CHECK (source_type IN ('sale', 'invoice', 'payment', 'invoice_payment'));

CREATE OR REPLACE FUNCTION public.fn_ledger_post_invoice_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ref text;
BEGIN
  DELETE FROM public.finance_ledger
   WHERE source_type = 'invoice_payment' AND source_id = p_id;

  SELECT ip.*, i.invoice_number, i.quotation_number, i.customer_name,
         i.invoice_type, i.user_id AS invoice_user_id
  INTO r
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.id = p_id;
  IF NOT FOUND OR COALESCE(r.amount, 0) <= 0 THEN RETURN; END IF;

  ref := COALESCE(r.invoice_number, r.quotation_number);
  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    COALESCE(r.recorded_by, r.invoice_user_id),
    r.payment_date,
    'payment_received', 'invoice_payment', r.id,
    'Payment received — ' || ref || COALESCE(' (' || r.customer_name || ')', ''),
    r.amount,
    CASE WHEN r.invoice_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    r.invoice_type,
    ref,
    r.recorded_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_ledger_invoice_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.finance_ledger
     WHERE source_type = 'invoice_payment' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.fn_ledger_post_invoice_payment(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_ledger_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_auto_ledger_invoice_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_invoice_payment();

-- Backfill: replace the browser-written receipt rows (keyed source_type =
-- 'invoice', duplicable) with deterministic per-payment rows.
DELETE FROM public.finance_ledger
 WHERE entry_type = 'payment_received' AND source_type = 'invoice';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoice_payments LOOP
    PERFORM public.fn_ledger_post_invoice_payment(r.id);
  END LOOP;
END $$;

-- ── 4. Invoice lifecycle guards (B1, B2) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- An issued invoice can never go back to being a quotation.
  IF OLD.status = 'invoice' AND NEW.status = 'quotation' THEN
    RAISE EXCEPTION 'Invoice % has been issued and cannot revert to a quotation. Cancel it and raise a new document instead.',
      COALESCE(OLD.invoice_number, OLD.quotation_number);
  END IF;

  -- Financial substance of an issued invoice is immutable (corrections go
  -- through cancellation / a new document, preserving the audit trail).
  IF OLD.status = 'invoice' AND NEW.status = 'invoice' THEN
    IF NEW.total_amount           IS DISTINCT FROM OLD.total_amount
    OR NEW.subtotal               IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_amount             IS DISTINCT FROM OLD.tax_amount
    OR NEW.tax_percent            IS DISTINCT FROM OLD.tax_percent
    OR NEW.discount_amount        IS DISTINCT FROM OLD.discount_amount
    OR NEW.discount_percent       IS DISTINCT FROM OLD.discount_percent
    OR NEW.service_charge_amount  IS DISTINCT FROM OLD.service_charge_amount
    OR NEW.service_charge_percent IS DISTINCT FROM OLD.service_charge_percent
    OR NEW.waiter_total           IS DISTINCT FROM OLD.waiter_total
    OR NEW.issue_date             IS DISTINCT FROM OLD.issue_date
    OR NEW.invoice_type           IS DISTINCT FROM OLD.invoice_type THEN
      RAISE EXCEPTION 'Invoice % is issued — its amounts, dates and type are locked. Cancel and re-issue to correct it.',
        COALESCE(OLD.invoice_number, OLD.quotation_number);
    END IF;
  END IF;

  -- No cancelling away an invoice that has collected money (B2).
  IF NEW.status = 'cancelled' AND OLD.status = 'invoice'
     AND COALESCE(OLD.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'Invoice % has % recorded in payments. Remove or reverse its payments before cancelling.',
      COALESCE(OLD.invoice_number, OLD.quotation_number), OLD.amount_paid;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_update ON public.invoices;
CREATE TRIGGER trg_guard_invoice_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_invoice_update();

-- ── 5. Payment guards (B4) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; paid_others numeric;
BEGIN
  -- FOR UPDATE serialises concurrent payments against the same invoice so two
  -- simultaneous inserts cannot both slip under the balance check.
  SELECT status, total_amount, invoice_number, quotation_number
  INTO inv FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment references a non-existent invoice';
  END IF;
  IF inv.status <> 'invoice' THEN
    RAISE EXCEPTION 'Payments can only be recorded against an issued invoice (% is %)',
      COALESCE(inv.invoice_number, inv.quotation_number), inv.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO paid_others
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;

  IF paid_others + NEW.amount > COALESCE(inv.total_amount, 0) + 0.01 THEN
    RAISE EXCEPTION 'Payment of % would exceed the balance due on % (total %, already paid %)',
      NEW.amount, COALESCE(inv.invoice_number, inv.quotation_number), inv.total_amount, paid_others;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_guard_invoice_payment
  BEFORE INSERT OR UPDATE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_invoice_payment();

-- ── 6. Re-post sales so the debit side reflects the new rule ─────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sales WHERE status <> 'cancelled' LOOP
    PERFORM public.fn_post_sale(r.id);
  END LOOP;
END $$;
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
-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 2: WHT tracking, VAT on sales, expense approval
--
--   C4  Withholding tax: corporate/government customers remit net of WHT
--       (5%/10% deduction at source). Without tracking, their invoices never
--       reconcile. invoice_payments now carries wht_amount; the withheld
--       portion settles the receivable and sits in 1150 WHT Receivable until
--       the credit note is claimed against income tax.
--   A6  (sales leg) Weekly-Sales / takings never carried VAT. sales.vat_amount
--       lets VAT-inclusive takings be split: revenue credited net, VAT to 2100.
--   B5  Maker-checker: expenses now have pending/approved/rejected status.
--       Only APPROVED expenses post to the ledger; approval is admin-only,
--       enforced in a DB trigger (not just the UI).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. WHT Receivable account ────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('1150', 'WHT Receivable', 'asset', 'debit', 35)
ON CONFLICT (code) DO NOTHING;

-- ── 2. WHT on invoice payments ───────────────────────────────────────────────
ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (wht_amount >= 0);

-- A payment settles the receivable by cash received PLUS tax withheld at source.
CREATE OR REPLACE FUNCTION public.sync_invoice_amount_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
  inv_total numeric;
  paid_sum  numeric;
BEGIN
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(amount + COALESCE(wht_amount, 0)), 0) INTO paid_sum
  FROM public.invoice_payments WHERE invoice_id = inv_id;

  SELECT total_amount INTO inv_total
  FROM public.invoices WHERE id = inv_id;

  UPDATE public.invoices
  SET amount_paid    = paid_sum,
      payment_status = CASE
        WHEN paid_sum <= 0            THEN 'unpaid'
        WHEN paid_sum >= inv_total    THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = now()
  WHERE id = inv_id;

  RETURN NULL;
END;
$$;

-- Journal: Dr Cash|Bank (cash received) + Dr WHT Receivable (withheld)
--          / Cr Accounts Receivable (total settled)
CREATE OR REPLACE FUNCTION public.fn_post_invoice_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; lines jsonb; ref text; cash_code text; wht numeric; settled numeric;
BEGIN
  SELECT ip.*, i.invoice_number, i.quotation_number, i.customer_name
  INTO r
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.id = p_id;
  IF NOT FOUND OR COALESCE(r.amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('invoice_payment', p_id); RETURN;
  END IF;

  ref     := COALESCE(r.invoice_number, r.quotation_number);
  wht     := COALESCE(r.wht_amount, 0);
  settled := r.amount + wht;
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(r.payment_method));

  lines := jsonb_build_array(
    jsonb_build_object('code', cash_code, 'debit', r.amount, 'credit', 0, 'desc', 'Receipt ' || ref)
  );
  IF wht > 0 THEN
    lines := lines || jsonb_build_array(
      jsonb_build_object('code', '1150', 'debit', wht, 'credit', 0, 'desc', 'WHT withheld at source')
    );
  END IF;
  lines := lines || jsonb_build_array(
    jsonb_build_object('code', '1100', 'debit', 0, 'credit', settled, 'desc', 'AR settled')
  );

  PERFORM public.fn_post_entry(r.payment_date, 'Payment — ' || ref || COALESCE(' (' || r.customer_name || ')', ''),
    'invoice_payment', p_id, lines);
END;
$$;

-- Balance guard now counts cash + WHT toward the invoice total.
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; paid_others numeric;
BEGIN
  SELECT status, total_amount, invoice_number, quotation_number
  INTO inv FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment references a non-existent invoice';
  END IF;
  IF inv.status <> 'invoice' THEN
    RAISE EXCEPTION 'Payments can only be recorded against an issued invoice (% is %)',
      COALESCE(inv.invoice_number, inv.quotation_number), inv.status;
  END IF;

  SELECT COALESCE(SUM(amount + COALESCE(wht_amount, 0)), 0) INTO paid_others
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;

  IF paid_others + NEW.amount + COALESCE(NEW.wht_amount, 0) > COALESCE(inv.total_amount, 0) + 0.01 THEN
    RAISE EXCEPTION 'Payment of % (+% WHT) would exceed the balance due on % (total %, already settled %)',
      NEW.amount, COALESCE(NEW.wht_amount, 0), COALESCE(inv.invoice_number, inv.quotation_number),
      inv.total_amount, paid_others;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-sync stored amount_paid (definition of "paid" unchanged for legacy rows —
-- wht_amount defaults to 0 — but run it so any drift is corrected).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.invoice_payments LOOP
    UPDATE public.invoices i
    SET amount_paid = (SELECT COALESCE(SUM(amount + COALESCE(wht_amount,0)),0) FROM public.invoice_payments WHERE invoice_id = r.invoice_id)
    WHERE i.id = r.invoice_id;
  END LOOP;
END $$;

-- ── 3. VAT on the sales / takings path ───────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0);

-- Revenue credited NET of VAT; the VAT portion goes to 2100 VAT Payable.
CREATE OR REPLACE FUNCTION public.fn_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; lines jsonb; has_pay boolean; dr_code text; vat numeric; net numeric;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('sale', p_id); RETURN;
  END IF;

  has_pay := EXISTS (
    SELECT 1 FROM public.payments
    WHERE sale_id = s.id AND status = 'completed' AND COALESCE(amount, 0) > 0
  );
  dr_code := CASE WHEN has_pay OR s.status <> 'completed' THEN '1100' ELSE '1000' END;

  vat := LEAST(COALESCE(s.vat_amount, 0), s.total_amount);
  net := s.total_amount - vat;

  lines := jsonb_build_array(
    jsonb_build_object('code', dr_code, 'debit', s.total_amount, 'credit', 0,
      'desc', CASE WHEN dr_code = '1000' THEN 'Cash takings ' ELSE 'Sale ' END || s.sale_number)
  );
  IF net > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '4000', 'debit', 0, 'credit', net, 'desc', 'Sales Revenue'));
  END IF;
  IF vat > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2100', 'debit', 0, 'credit', vat, 'desc', 'Output VAT'));
  END IF;

  PERFORM public.fn_post_entry(s.sale_date, 'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    'sale', s.id, lines);
END;
$$;

-- Finance-Feed revenue for sales: net of VAT, mirroring invoices.
CREATE OR REPLACE FUNCTION public.fn_ledger_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; net numeric;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('sale', p_id);
    RETURN;
  END IF;

  net := s.total_amount - LEAST(COALESCE(s.vat_amount, 0), s.total_amount);
  IF net <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('sale', p_id);
    RETURN;
  END IF;

  DELETE FROM public.finance_ledger
   WHERE source_type = 'sale' AND source_id = s.id AND entry_type = 'revenue';

  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    s.user_id,
    s.sale_date,
    'revenue', 'sale', s.id,
    'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    net,
    CASE WHEN s.sale_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    NULL,
    s.sale_number,
    COALESCE(s.created_by, s.user_id)
  );
END;
$$;

-- ── 4. Maker-checker for expenses ────────────────────────────────────────────
-- Existing rows (and system-generated inserts from admin-gated flows) default
-- to 'approved' so history and automation are unaffected; the UI submits
-- non-admin manual entries as 'pending'.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Only admins may move an expense into/out of 'approved'.
CREATE OR REPLACE FUNCTION public.fn_guard_expense_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.uid() IS NULL means a service-role/SQL-console operation (RLS already
  -- blocks anonymous API writes), so only authenticated non-admins are stopped.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can change the approval status of an expense';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_approval ON public.expenses;
CREATE TRIGGER trg_guard_expense_approval
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_approval();

-- Only APPROVED expenses reach the general ledger.
CREATE OR REPLACE FUNCTION public.fn_post_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record; exp_code text; cash_code text; lines jsonb;
BEGIN
  SELECT * INTO e FROM public.expenses WHERE id = p_id;
  IF NOT FOUND OR COALESCE(e.amount, 0) <= 0 OR COALESCE(e.status, 'approved') <> 'approved' THEN
    PERFORM public.fn_unpost('expense', p_id); RETURN;
  END IF;

  exp_code := CASE
    WHEN COALESCE(e.account_type, 'COGS') = 'COGS' THEN '5000'
    WHEN e.category ILIKE '%rent%'                 THEN '5200'
    WHEN e.category ILIKE '%util%'                 THEN '5300'
    WHEN e.account_type = 'OpEX'                    THEN '5400'
    ELSE '5900'
  END;
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(e.payment_method));

  lines := jsonb_build_array(
    jsonb_build_object('code', exp_code,  'debit', e.amount, 'credit', 0, 'desc', e.category),
    jsonb_build_object('code', cash_code, 'debit', 0, 'credit', e.amount, 'desc', 'Paid')
  );
  PERFORM public.fn_post_entry(e.date, 'Expense — ' || e.description, 'expense', e.id, lines);
END;
$$;

-- The expense trigger must also fire on status changes so approval posts the
-- journal and rejection unposts it.
DROP TRIGGER IF EXISTS trg_auto_post_expense ON public.expenses;
CREATE TRIGGER trg_auto_post_expense
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_expense();
-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 3: Inventory costing (IAS 2), bank rec, FIRS TIN
--
--   A8  Inventory had quantities but no value: goods received via procurement
--       never reached the books at all, invoicing depleted stock with no COGS,
--       negative stock was allowed, and the 1200/5000 accounts only moved via
--       hand-typed expenses.
--       → products carry a true cost_price (the sku mirror previously
--         overwrote cost with the SELLING price — fixed);
--       → every inventory movement is stamped with unit_cost at the time it
--         happens;
--       → goods receipt posts   Dr 1200 Inventory / Cr 2000 Accounts Payable;
--       → invoice issue posts   Dr 5000 COGS      / Cr 1200 Inventory;
--       → issuing an invoice for more than the tracked stock on hand is
--         rejected (adjust stock first).
--       Applied PROSPECTIVELY (IAS 8): history gets costs stamped for
--       reference but no retro journals — post opening inventory value as a
--       manual journal (Dr 1200 / Cr 3000) when adopting.
--   C5  Bank reconciliation: journal lines can now be ticked off against the
--       bank statement (reconciled_at / reconciled_by; admin UI in Accounting).
--   FIRS e-invoicing readiness: invoices capture the customer's TIN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. True product cost ─────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) CHECK (cost_price IS NULL OR cost_price >= 0);

-- Best-available backfill from the sku mirror. Caveat: the old mirror bug set
-- cost_per_unit = selling price for products edited since harmonization, so
-- these values need review where cost equals price.
UPDATE public.products p
SET cost_price = s.cost_per_unit
FROM public.skus s
WHERE p.sku_id = s.id
  AND p.cost_price IS NULL
  AND COALESCE(s.cost_per_unit, 0) > 0;

-- Fix the mirror: sku cost tracks the product's COST, never its selling price.
CREATE OR REPLACE FUNCTION public.fn_sync_product_to_sku()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE sid uuid;
BEGIN
  sid := NEW.sku_id;
  IF sid IS NULL AND NEW.sku IS NOT NULL THEN
    SELECT id INTO sid FROM public.skus WHERE lower(sku_code) = lower(NEW.sku) LIMIT 1;
  END IF;

  IF sid IS NULL THEN
    INSERT INTO public.skus (name, sku_code, unit_of_measure, cost_per_unit, category, stock_quantity, reorder_level, user_id, created_by)
    VALUES (NEW.name, COALESCE(NEW.sku, NEW.id::text), COALESCE(NEW.uom, 'unit'), COALESCE(NEW.cost_price, 0),
            COALESCE(NEW.category, 'general'), 0, 0, NEW.user_id, NEW.created_by)
    RETURNING id INTO sid;
  ELSE
    UPDATE public.skus SET
      name            = NEW.name,
      sku_code        = COALESCE(NEW.sku, sku_code),
      unit_of_measure = COALESCE(NEW.uom, unit_of_measure),
      cost_per_unit   = COALESCE(NEW.cost_price, cost_per_unit),
      category        = COALESCE(NEW.category, category),
      updated_at      = now()
    WHERE id = sid;
  END IF;

  NEW.sku_id := sid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zsync_product_to_sku ON public.products;
CREATE TRIGGER trg_zsync_product_to_sku
  BEFORE INSERT OR UPDATE OF name, sku, uom, price, cost_price, category, sku_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_sku();

-- Product cost with sku fallback (weighted-average bookkeeping can refine this
-- later; a single current cost per product is the SME-appropriate baseline).
CREATE OR REPLACE FUNCTION public.fn_product_cost(p_product_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.cost_price, s.cost_per_unit, 0)
  FROM public.products p
  LEFT JOIN public.skus s ON s.id = p.sku_id
  WHERE p.id = p_product_id;
$$;

-- ── 2. Costed inventory movements ────────────────────────────────────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);

-- Reference-only stamp for history (no retro journals — prospective adoption).
UPDATE public.inventory_movements m
SET unit_cost = ri.unit_price
FROM public.lpo_receipt_items ri
WHERE m.unit_cost IS NULL AND m.reference_type = 'lpo_receipt' AND m.reference_id = ri.id;

UPDATE public.inventory_movements m
SET unit_cost = public.fn_product_cost(m.product_id)
WHERE m.unit_cost IS NULL;

-- ── 3. Goods receipt: capitalize to Inventory (Dr 1200 / Cr 2000) ────────────
CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ri record; pid uuid; wh uuid; qty numeric; cost numeric; val numeric;
BEGIN
  SELECT * INTO ri FROM public.lpo_receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  qty := ri.quantity_received;
  IF qty IS NULL OR qty <= 0 THEN RETURN; END IF;

  SELECT product_id INTO pid FROM public.lpo_items WHERE id = ri.lpo_item_id;
  IF pid IS NULL THEN RETURN; END IF;  -- not a stocked product; skip

  -- idempotency: don't double-post for the same receipt line
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type = 'lpo_receipt' AND reference_id = ri.id
  ) THEN
    RETURN;
  END IF;

  cost := COALESCE(NULLIF(ri.unit_price, 0), public.fn_product_cost(pid), 0);

  -- restock the warehouse already holding the most stock; otherwise the first one
  SELECT warehouse_id INTO wh FROM public.inventory WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;
  IF wh IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + qty, last_updated = now(), updated_at = now()
    WHERE product_id = pid AND warehouse_id = wh;
  ELSE
    SELECT id INTO wh FROM public.warehouses LIMIT 1;
    IF wh IS NOT NULL THEN
      INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
      VALUES (pid, wh, qty, 10);
    END IF;
  END IF;

  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
  VALUES
    (pid, wh, 'purchase', qty, 'lpo_receipt', ri.id, current_date, 'Goods received: ' || COALESCE(ri.item_name, ''), cost);

  -- Capitalize the goods (IAS 2): the liability sits in AP until the supplier
  -- is paid (settle via remittance/manual journal: Dr 2000 / Cr Bank).
  val := round(qty * cost, 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Goods received — ' || COALESCE(ri.item_name, ''),
      'inventory_purchase', ri.id,
      jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Inventory received'),
        jsonb_build_object('code', '2000', 'debit', 0, 'credit', val, 'desc', 'Supplier payable')
      )
    );
  END IF;
END;
$$;

-- ── 4. Invoice consumption: stock guard + COGS (Dr 5000 / Cr 1200) ───────────
CREATE OR REPLACE FUNCTION public.fn_consume_invoice_stock(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv        record;
  it         record;
  mv         record;
  wh_id      uuid;
  has_moves  boolean;
  available  numeric;
  cost       numeric;
  cogs_total numeric := 0;
  pname      text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  has_moves := EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
  );

  -- Consume on issue (once)
  IF inv.status = 'invoice' AND NOT has_moves THEN
    FOR it IN
      SELECT product_id, quantity
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL AND quantity > 0
    LOOP
      -- Untracked products (no inventory rows) are skipped entirely — no
      -- phantom movements, no cost.
      SELECT COALESCE(SUM(quantity), NULL) INTO available
      FROM public.inventory WHERE product_id = it.product_id;
      IF available IS NULL THEN CONTINUE; END IF;

      IF available < it.quantity THEN
        SELECT name INTO pname FROM public.products WHERE id = it.product_id;
        RAISE EXCEPTION 'Insufficient stock to issue this invoice: % has % on hand but % is being invoiced. Adjust stock or the line quantity first.',
          COALESCE(pname, it.product_id::text), available, it.quantity;
      END IF;

      -- deplete the warehouse holding the most stock for this product
      SELECT warehouse_id INTO wh_id
      FROM public.inventory WHERE product_id = it.product_id
      ORDER BY quantity DESC LIMIT 1;

      cost := public.fn_product_cost(it.product_id);

      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
      VALUES
        (it.product_id, wh_id, 'sale', -it.quantity, 'invoice', p_invoice_id,
         COALESCE(inv.converted_at::date, inv.issue_date),
         'Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number), cost);

      UPDATE public.inventory
      SET quantity = quantity - it.quantity, last_updated = now(), updated_at = now()
      WHERE product_id = it.product_id AND warehouse_id = wh_id;

      cogs_total := cogs_total + round(it.quantity * COALESCE(cost, 0), 2);
    END LOOP;

    -- Cost of goods sold for the tracked lines (IAS 2 matching)
    IF cogs_total > 0 THEN
      PERFORM public.fn_post_entry(
        COALESCE(inv.converted_at::date, inv.issue_date),
        'COGS — Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number),
        'invoice_cogs', p_invoice_id,
        jsonb_build_array(
          jsonb_build_object('code', '5000', 'debit', cogs_total, 'credit', 0, 'desc', 'Cost of goods sold'),
          jsonb_build_object('code', '1200', 'debit', 0, 'credit', cogs_total, 'desc', 'Inventory consumed')
        )
      );
    END IF;

  -- Reverse if it left 'invoice' status (e.g. cancelled) after having consumed
  ELSIF inv.status <> 'invoice' AND has_moves THEN
    FOR mv IN
      SELECT * FROM public.inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
    LOOP
      IF mv.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
        WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
      END IF;
    END LOOP;
    DELETE FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id;
    PERFORM public.fn_unpost('invoice_cogs', p_invoice_id);
  END IF;
END;
$$;

-- Delete path must also reverse the COGS entry.
CREATE OR REPLACE FUNCTION public.trg_consume_invoice_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE mv record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR mv IN
      SELECT * FROM public.inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = OLD.id
    LOOP
      IF mv.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
        WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
      END IF;
    END LOOP;
    DELETE FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = OLD.id;
    PERFORM public.fn_unpost('invoice_cogs', OLD.id);
    RETURN OLD;
  END IF;

  PERFORM public.fn_consume_invoice_stock(NEW.id);
  RETURN NEW;
END;
$$;

-- ── 5. Bank reconciliation columns ───────────────────────────────────────────
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_reconciled ON public.journal_lines(account_id, reconciled_at);

-- Reconciling a line does not change its financial substance, so ticking off
-- statement lines must remain possible even after the period is closed. The
-- period guard now permits updates that ONLY touch the reconciliation columns.
CREATE OR REPLACE FUNCTION public.fn_guard_journal_line_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.entry_id    IS NOT DISTINCT FROM OLD.entry_id
     AND NEW.account_id  IS NOT DISTINCT FROM OLD.account_id
     AND NEW.debit       IS NOT DISTINCT FROM OLD.debit
     AND NEW.credit      IS NOT DISTINCT FROM OLD.credit
     AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;  -- reconciliation-only change
  END IF;

  SELECT entry_date INTO d FROM public.journal_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF d IS NOT NULL AND public.fn_books_locked(d) THEN
    RAISE EXCEPTION 'Books are closed through %: journal lines dated % are locked.',
      (SELECT max(locked_through) FROM public.period_locks), d;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 6. FIRS e-invoicing readiness: customer TIN ──────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_tin text;
-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 4: Segregation of duties — HR loses financial WRITE
--
--   B5 (residual): the HR role had blanket create/update rights over sales,
--   payments, expenses, invoices and the finance feed — the same person who
--   administers staff could also book and alter revenue and spending. Standard
--   segregation of duties (COSO / ISA 315) separates custody, recording and
--   authorization.
--
--   This migration removes ONLY the write clauses: HR keeps every SELECT it
--   had (payroll administration still needs visibility of finances). Any HR
--   user who genuinely must record finance can be granted the 'finance' /
--   'sales' / 'invoices' department permission explicitly through User
--   Management — deliberate, per-person, auditable — instead of implicitly by
--   role. Rollback = re-run 20260422200000 §4–6 and 20260629150000.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── finance_ledger: INSERT ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "finance_ledger_insert" ON public.finance_ledger;
CREATE POLICY "finance_ledger_insert" ON public.finance_ledger
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_department_permission(auth.uid(), 'sales',   'create')
      OR has_department_permission(auth.uid(), 'finance', 'create')
    )
  );

-- ── sales: INSERT / UPDATE ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create sales" ON public.sales;
CREATE POLICY "Users can create sales"
ON public.sales FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS "Users can update sales" ON public.sales;
CREATE POLICY "Users can update sales"
ON public.sales FOR UPDATE USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'sales', 'update')
);

-- ── sale_items: INSERT / UPDATE ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create sale items" ON public.sale_items;
CREATE POLICY "Users can create sale items"
ON public.sale_items FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'create')
      )
  )
);

DROP POLICY IF EXISTS "Users can update sale items" ON public.sale_items;
CREATE POLICY "Users can update sale items"
ON public.sale_items FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- ── payments: INSERT / UPDATE ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create payments" ON public.payments;
CREATE POLICY "Users can create payments"
ON public.payments FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'create')
      )
  )
);

DROP POLICY IF EXISTS "Users can update payments" ON public.payments;
CREATE POLICY "Users can update payments"
ON public.payments FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- ── expenses: INSERT / UPDATE ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create expenses" ON public.expenses;
CREATE POLICY "Users can create expenses"
ON public.expenses FOR INSERT WITH CHECK (
  is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'finance', 'create')
  OR has_department_permission(auth.uid(), 'budgets', 'create')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update expenses" ON public.expenses;
CREATE POLICY "Users can update expenses"
ON public.expenses FOR UPDATE USING (
  is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'finance', 'update')
  OR has_department_permission(auth.uid(), 'budgets', 'update')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

-- ── invoices: INSERT / UPDATE (SELECT keeps HR; DELETE never had HR) ─────────
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_department_permission(auth.uid(), 'invoices', 'create')
    )
  );

DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR is_admin(auth.uid())
    OR has_department_permission(auth.uid(), 'invoices', 'update')
  );

-- ── invoice_items: INSERT / UPDATE / DELETE ──────────────────────────────────
DROP POLICY IF EXISTS "invoice_items_insert" ON public.invoice_items;
CREATE POLICY "invoice_items_insert" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'create')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_items_update" ON public.invoice_items;
CREATE POLICY "invoice_items_update" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_items_delete" ON public.invoice_items;
CREATE POLICY "invoice_items_delete" ON public.invoice_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

-- ── invoice_payments: INSERT / UPDATE / DELETE ───────────────────────────────
DROP POLICY IF EXISTS "invoice_payments_insert" ON public.invoice_payments;
CREATE POLICY "invoice_payments_insert" ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_payments_update" ON public.invoice_payments;
CREATE POLICY "invoice_payments_update" ON public.invoice_payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_payments_delete" ON public.invoice_payments;
CREATE POLICY "invoice_payments_delete" ON public.invoice_payments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );
