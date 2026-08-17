-- Reverse of 20260817110000_expense_claims_and_lines.sql.
-- Claims and lines are dropped; the `expenses` rows they produced are left in
-- place, because they are the posted financial record.

BEGIN;

DROP TRIGGER IF EXISTS trg_expense_line_retotal ON public.expense_line;
DROP TRIGGER IF EXISTS trg_expense_claim_guard_total ON public.expense_claim;
DROP FUNCTION IF EXISTS public.fn_expense_claim_retotal();
DROP FUNCTION IF EXISTS public.fn_expense_claim_guard_total();

ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS expense_line_id,
  DROP COLUMN IF EXISTS payee_id,
  DROP COLUMN IF EXISTS payee_name,
  DROP COLUMN IF EXISTS category_id,
  DROP COLUMN IF EXISTS expense_account_code,
  DROP COLUMN IF EXISTS vat_minor,
  DROP COLUMN IF EXISTS wht_minor,
  DROP COLUMN IF EXISTS reference,
  DROP COLUMN IF EXISTS bank_account_id,
  DROP COLUMN IF EXISTS submitted_by,
  DROP COLUMN IF EXISTS submitted_at;

DROP TABLE IF EXISTS public.expense_line;
DROP TABLE IF EXISTS public.expense_claim;
DROP TABLE IF EXISTS public.expense_receipts;
DROP TABLE IF EXISTS public.expense_category_migration;
DROP TABLE IF EXISTS public.payees;
DROP TABLE IF EXISTS public.cost_centres;
DROP TABLE IF EXISTS public.expense_categories;

COMMIT;
