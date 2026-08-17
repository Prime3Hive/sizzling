-- Reverse of 20260817130000_expense_server_validation.sql.

BEGIN;

DROP TRIGGER IF EXISTS trg_guard_expense_insert ON public.expenses;
DROP TRIGGER IF EXISTS trg_guard_expense_amount_update ON public.expenses;
DROP TRIGGER IF EXISTS trg_guard_expense_line ON public.expense_line;
DROP TRIGGER IF EXISTS trg_guard_expense_claim_approval ON public.expense_claim;

DROP FUNCTION IF EXISTS public.fn_guard_expense_insert();
DROP FUNCTION IF EXISTS public.fn_guard_expense_amount_update();
DROP FUNCTION IF EXISTS public.fn_guard_expense_line();
DROP FUNCTION IF EXISTS public.fn_guard_expense_claim_approval();
DROP FUNCTION IF EXISTS public.fn_post_expense_claim(uuid);
DROP FUNCTION IF EXISTS public.fn_validate_expense_amounts(text, bigint, date, text, text);
DROP FUNCTION IF EXISTS public.fn_count_numbers_above(text, numeric);
DROP FUNCTION IF EXISTS public.fn_largest_number_in(text);
DROP FUNCTION IF EXISTS public.fn_clean_text(text);

DROP TABLE IF EXISTS public.expense_settings;

COMMIT;
