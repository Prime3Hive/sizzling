-- Down for 20261124200000_stock_receipts.sql
--
-- Only the two functions are removed, so nothing new can be received or
-- reversed this way. The receipts, their lines and the expenses they created
-- are financial records and are kept, as is the 'receipt' expense source:
-- removing either would orphan or invalidate expenses already in the books.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_receive_stock(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.fn_reverse_stock_receipt(uuid, text);

COMMIT;
