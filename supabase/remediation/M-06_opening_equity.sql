-- ─────────────────────────────────────────────────────────────────────────────
-- M-06 — Post opening equity so the trial balance closes
--
-- ⚠ THIS SCRIPT REQUIRES A FIGURE THAT ONLY THE FINANCE LEAD CAN GIVE YOU.
--   It is deliberately left as a parameter. Do not compute it, do not infer it
--   from the difference, and do not let this script derive it for you.
--
--   The temptation is obvious: the trial balance is out by some amount, so post
--   that amount to equity and it balances. That is plugging, and it converts a
--   known error into a permanent, invisible one. The difference is only equity
--   if someone can say what the opening capital of this business actually was.
--
-- Run LAST, after M-02 to M-05 have been run and agreed.
--
-- PRECONDITIONS:
--   1. Full database backup taken and restore tested.
--   2. M-03 complete: duplicate postings reversed.
--   3. M-04 complete: Accounts Payable agreed to supplier statements.
--   4. M-05 complete: the Bank position understood.
--   5. The finance lead has provided, in writing, the opening capital figure
--      and the date it applies from.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: run this first, and read it ──────────────────────────────────────
-- What is the trial balance difference, and what is already sitting in equity?
SELECT
  SUM(jl.debit)                  AS total_debits,
  SUM(jl.credit)                 AS total_credits,
  SUM(jl.debit) - SUM(jl.credit) AS difference
FROM public.journal_lines jl;

SELECT
  a.code, a.name, a.type,
  SUM(jl.credit - jl.debit) AS balance
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
WHERE a.type = 'equity'
GROUP BY a.code, a.name, a.type
ORDER BY a.code;

-- Note: the chart already carries 3000 Owner's Equity and 3100 Retained
-- Earnings. It does NOT need new equity accounts created — an earlier draft of
-- the remediation plan assumed otherwise and proposed 3000/3100/3200 with
-- different meanings, which would have collided with these. Use what is here.

-- ── Step 2: post the figure the finance lead gave you ────────────────────────
-- Replace :opening_capital and :effective_date below. Both are deliberately
-- unbound so that running this file unedited fails rather than posts something
-- invented.
--
-- Uncomment the block, substitute the values, and run it on its own.

/*
BEGIN;

DO $$
DECLARE
  v_opening_capital numeric := NULL;   -- ←← from the finance lead, in naira
  v_effective_date  date    := NULL;   -- ←← the date opening capital applies from
  v_eid             uuid;
BEGIN
  IF v_opening_capital IS NULL OR v_effective_date IS NULL THEN
    RAISE EXCEPTION
      'M-06 has not been filled in. Opening capital and its effective date must come from the finance lead in writing; this script will not guess them.';
  END IF;

  IF public.fn_books_locked(v_effective_date) THEN
    RAISE EXCEPTION
      'Books are locked through the effective date %. Reopen the period deliberately, or agree a different date.', v_effective_date;
  END IF;

  -- Posted as a manual entry so it carries a memo explaining itself, and so it
  -- is not mistaken for something the system generated.
  INSERT INTO public.journal_entries (entry_date, memo, source_type, posted_by, created_by)
  VALUES (
    v_effective_date,
    'M-06 opening equity — per finance lead, agreed in writing. Establishes opening capital so the trial balance closes.',
    'manual', auth.uid(), auth.uid()
  )
  RETURNING id INTO v_eid;

  -- Opening capital is a credit to equity. The debit side is whatever the
  -- capital was introduced AS. If it was cash into the bank, 1010 is right.
  -- If it represents net assets already on the books at the opening date, the
  -- debit belongs against those. CONFIRM THIS WITH THE FINANCE LEAD — the two
  -- are not interchangeable and only one of them is true.
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  VALUES
    (v_eid, public.fn_acct('1010'), v_opening_capital, 0, 'Opening capital introduced'),
    (v_eid, public.fn_acct('3000'), 0, v_opening_capital, 'Owner''s Equity — opening');

  RAISE NOTICE 'Posted opening equity of % effective %', v_opening_capital, v_effective_date;
END $$;

COMMIT;
*/

-- ── Step 3: confirm ──────────────────────────────────────────────────────────
-- Re-run step 1. debits must equal credits.
--
-- If they do not, the difference was never opening equity and posting more of
-- it will not help. Go back to M-02 through M-05 and find the entry that caused
-- it — which is Rule 6, and it is the rule most often abandoned at exactly this
-- point.
