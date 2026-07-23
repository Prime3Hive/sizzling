-- ─────────────────────────────────────────────────────────────────────────────
-- Normalize public.payments.status vocabulary.
--
-- The Payments page wrote 'pending' / 'settled' / 'failed', but every reader —
-- Finance Overview's "Cash Collected" KPI, the Dashboard's monthly cash figure,
-- and the auto-posting journal trigger (fn_post_payment) — filters on
-- status = 'completed'. Since nothing ever wrote 'completed', a payment marked
-- "Settled" on the Payments page was invisible everywhere else, and its cash
-- receipt was never posted to the general ledger (Accounts Receivable for that
-- sale never cleared). The application code now writes 'completed'; this
-- backfills existing rows and locks the vocabulary in with a check constraint
-- so the two sides of the app cannot drift apart again.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.payments
SET status = 'completed'
WHERE status = 'settled';

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'completed', 'failed'));

-- Re-run the auto-posting backfill so payments that just became 'completed'
-- get their cash-receipt journal entry posted immediately, instead of waiting
-- for the next update to that row.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.payments WHERE status = 'completed' LOOP
    PERFORM public.fn_post_payment(r.id);
  END LOOP;
END $$;
