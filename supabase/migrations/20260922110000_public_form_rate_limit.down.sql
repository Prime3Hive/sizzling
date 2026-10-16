-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20260922110000_public_form_rate_limit.sql
--
-- Removes the limiter, the cleaning triggers and the CHECK constraints, leaving
-- the two public forms unbounded again. The counter table goes with it — it
-- holds nothing but timestamps and visitor IPs.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TRIGGER IF EXISTS trg_20_rate_limit_subscriber      ON public.subscribers;
DROP TRIGGER IF EXISTS trg_10_clean_subscriber           ON public.subscribers;
DROP TRIGGER IF EXISTS trg_20_rate_limit_contact_message ON public.contact_messages;
DROP TRIGGER IF EXISTS trg_10_clean_contact_message      ON public.contact_messages;

DROP FUNCTION IF EXISTS public.fn_rate_limit_public_form();
DROP FUNCTION IF EXISTS public.fn_clean_contact_message();
DROP FUNCTION IF EXISTS public.fn_clean_subscriber();
DROP FUNCTION IF EXISTS public.fn_clean_text(text, integer);
DROP FUNCTION IF EXISTS public.fn_clean_body(text, integer);
DROP FUNCTION IF EXISTS public.fn_control_chars(boolean);
DROP FUNCTION IF EXISTS public.fn_request_ip();

ALTER TABLE public.contact_messages
  DROP CONSTRAINT IF EXISTS contact_messages_name_len,
  DROP CONSTRAINT IF EXISTS contact_messages_email_shape,
  DROP CONSTRAINT IF EXISTS contact_messages_phone_shape,
  DROP CONSTRAINT IF EXISTS contact_messages_subject_len,
  DROP CONSTRAINT IF EXISTS contact_messages_message_len;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_email_shape,
  DROP CONSTRAINT IF EXISTS subscribers_name_len;

DROP TABLE IF EXISTS public.public_form_hits;

COMMIT;

NOTIFY pgrst, 'reload schema';
