-- Fix: grant EXECUTE on generate_invoice_number to the authenticated role.
-- PostgREST only exposes functions that the requesting role can execute.
-- Without this grant, the function exists in the DB but PostgREST's schema
-- cache never includes it for authenticated API calls, producing the
-- "could not find the function in the schema cache" error.

GRANT EXECUTE ON FUNCTION public.generate_invoice_number(TEXT) TO authenticated;

-- Reload PostgREST schema cache so the function becomes visible immediately.
NOTIFY pgrst, 'reload schema';
