-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY AUDIT (2/2): rate limit and validate the two anonymous endpoints
--
-- /contact writes to contact_messages and subscribers as `anon`. Both were
-- unbounded: no rate limit, no length caps, no format check. A script could
-- fill the admin inbox, or push a multi-megabyte message body, at whatever rate
-- the network allowed. Every other write in the app is behind a login and
-- Supabase's own auth rate limits, so these two are the whole exposed surface.
--
-- The limit lives in the database rather than the client because the client is
-- the attacker here — anything enforced in Contact.tsx is skipped by talking to
-- PostgREST directly with the publishable key. A BEFORE INSERT trigger is the
-- last point both paths share.
--
--   contact_messages   3 per IP / 10 min,   60 overall / 10 min
--   subscribers        3 per IP / 60 min,  100 overall / 60 min
--
-- The overall cap is the backstop for a flood spread across many IPs. It is set
-- far above real traffic for a single-restaurant contact page; if it ever fires
-- for legitimate visitors, raise it in `fn_rate_limit_public_form`.
-- ═════════════════════════════════════════════════════════════════════════════

-- Note on SECURITY DEFINER: the trigger functions below run as the migration
-- owner, not as `anon`. The limiter needs it to reach public_form_hits, which
-- anon has no privilege on; the two cleaning functions need it because they
-- call fn_clean_text, whose EXECUTE is revoked at the bottom of this file.
-- None of them read anything the caller supplied beyond NEW, and each pins
-- search_path, so there is no path from a visitor's payload into their body.

BEGIN;

-- ── 1. Where the counters live ───────────────────────────────────────────────
-- Written only by the SECURITY DEFINER trigger below. RLS on with no policies
-- at all, so the table is invisible through the API to anon and authenticated
-- alike — the IP addresses in it are not staff-readable.

CREATE TABLE IF NOT EXISTS public.public_form_hits (
  id          bigserial   PRIMARY KEY,
  form        text        NOT NULL,
  client_ip   text        NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_form_hits_lookup
  ON public.public_form_hits (form, client_ip, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_form_hits_time
  ON public.public_form_hits (occurred_at);

ALTER TABLE public.public_form_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_form_hits          FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.public_form_hits_id_seq FROM anon, authenticated;

-- ── 2. Who is calling ────────────────────────────────────────────────────────
-- PostgREST exposes the request headers as a GUC. Behind Supabase's edge the
-- caller's address arrives as cf-connecting-ip, with x-forwarded-for (first
-- entry — the rest are proxies) and x-real-ip as fallbacks.

CREATE OR REPLACE FUNCTION public.fn_request_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  h jsonb;
  v text;
BEGIN
  BEGIN
    h := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF h IS NULL THEN
    RETURN NULL;
  END IF;

  v := COALESCE(
         h ->> 'cf-connecting-ip',
         split_part(COALESCE(h ->> 'x-forwarded-for', ''), ',', 1),
         h ->> 'x-real-ip'
       );

  v := NULLIF(btrim(COALESCE(v, '')), '');
  RETURN left(v, 64);
END;
$$;

-- ── 3. The limiter ───────────────────────────────────────────────────────────
-- Per-IP first, then the overall cap. When the address is unavailable the
-- per-IP check is skipped rather than bucketing every visitor together under
-- 'unknown' — that would let one script lock the form for everyone. The overall
-- cap still applies in that case.
--
-- Raised as PT429 so PostgREST answers 429 Too Many Requests instead of 500,
-- and the message is written for the visitor, not for a log.

CREATE OR REPLACE FUNCTION public.fn_rate_limit_public_form()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form        text := TG_TABLE_NAME;
  v_ip          text := public.fn_request_ip();
  v_window      interval;
  v_per_ip      integer;
  v_overall     integer;
  v_since       timestamptz;
  v_ip_count    integer;
  v_all_count   integer;
BEGIN
  -- An admin adding a subscriber by hand, or importing a list, is not the
  -- traffic this guards against.
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF v_form = 'contact_messages' THEN
    v_window := interval '10 minutes'; v_per_ip := 3; v_overall := 60;
  ELSE
    v_window := interval '60 minutes'; v_per_ip := 3; v_overall := 100;
  END IF;

  v_since := now() - v_window;

  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_count
      FROM public.public_form_hits
     WHERE form = v_form AND client_ip = v_ip AND occurred_at >= v_since;

    IF v_ip_count >= v_per_ip THEN
      RAISE EXCEPTION USING
        errcode = 'PT429',
        message = 'Too many submissions from this device. Please wait a few minutes and try again.';
    END IF;
  END IF;

  SELECT count(*) INTO v_all_count
    FROM public.public_form_hits
   WHERE form = v_form AND occurred_at >= v_since;

  IF v_all_count >= v_overall THEN
    RAISE EXCEPTION USING
      errcode = 'PT429',
      message = 'We are receiving an unusual number of submissions right now. Please try again shortly.';
  END IF;

  INSERT INTO public.public_form_hits (form, client_ip)
  VALUES (v_form, COALESCE(v_ip, 'unknown'));

  -- Housekeeping, roughly once every 200 inserts. Counters older than a day
  -- are past every window above.
  IF random() < 0.005 THEN
    DELETE FROM public.public_form_hits WHERE occurred_at < now() - interval '1 day';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Validate and sanitise the payload ─────────────────────────────────────
-- Trim, drop control characters (a stray ESC or backspace in a name reaches the
-- admin inbox, and any CSV export of it), collapse runs of whitespace, lowercase
-- the email, and truncate to the column's cap so an over-long field is stored
-- short rather than rejected. The CHECK constraints below are what actually
-- refuses a bad row; this is what stops a merely untidy one from becoming one.
--
-- Control characters are removed with translate() rather than a regex. A class
-- like '[\x00-\x1f]' relies on how the regex engine reads backslash escapes out
-- of a standard-conforming string literal, which is exactly the kind of detail
-- that silently strips nothing (or throws) on a different server. translate()
-- takes the characters themselves and deletes any without a counterpart in the
-- second argument, with no escaping in the picture at all.

-- Every C0 control plus DEL, optionally keeping tab / LF / CR.
CREATE OR REPLACE FUNCTION public.fn_control_chars(p_keep_breaks boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(string_agg(chr(i), ''), '') || chr(127)
    FROM generate_series(1, 31) AS g(i)
   WHERE NOT (p_keep_breaks AND i IN (9, 10, 13));
$$;

-- Single-line fields: line breaks and tabs become spaces, every other control
-- character is dropped, runs of whitespace collapse to one.
CREATE OR REPLACE FUNCTION public.fn_clean_text(p text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
           left(
             btrim(
               regexp_replace(
                 translate(
                   translate(p, chr(9) || chr(10) || chr(13), '   '),
                   public.fn_control_chars(false), ''),
                 '[[:space:]]+', ' ', 'g')),
             p_max),
           '');
$$;

-- Free text: keep the paragraph breaks the visitor typed, drop the rest.
CREATE OR REPLACE FUNCTION public.fn_clean_body(p text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
           left(btrim(translate(p, public.fn_control_chars(true), '')), p_max),
           '');
$$;

CREATE OR REPLACE FUNCTION public.fn_clean_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.name    := public.fn_clean_text(NEW.name, 120);
  NEW.email   := lower(public.fn_clean_text(NEW.email, 254));
  NEW.phone   := public.fn_clean_text(NEW.phone, 32);
  NEW.subject := public.fn_clean_text(NEW.subject, 200);
  NEW.message := public.fn_clean_body(NEW.message, 5000);
  -- `source` and `status` are set here, not taken from the visitor's payload:
  -- a submission that arrives claiming status 'archived' would otherwise land
  -- in the inbox already dismissed.
  NEW.source  := COALESCE(public.fn_clean_text(NEW.source, 40), 'website');
  NEW.status  := 'new';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_clean_subscriber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email  := lower(public.fn_clean_text(NEW.email, 254));
  NEW.name   := public.fn_clean_text(NEW.name, 120);
  NEW.source := COALESCE(public.fn_clean_text(NEW.source, 40), 'website');
  NEW.status := 'active';
  RETURN NEW;
END;
$$;

-- NOT VALID: new and updated rows are checked, rows already in the table are
-- left alone rather than failing the migration. Run the VALIDATE statements at
-- the bottom once you have looked at what is there.

ALTER TABLE public.contact_messages
  DROP CONSTRAINT IF EXISTS contact_messages_name_len,
  DROP CONSTRAINT IF EXISTS contact_messages_email_shape,
  DROP CONSTRAINT IF EXISTS contact_messages_phone_shape,
  DROP CONSTRAINT IF EXISTS contact_messages_subject_len,
  DROP CONSTRAINT IF EXISTS contact_messages_message_len;

ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_name_len
    CHECK (char_length(name) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT contact_messages_email_shape
    CHECK (char_length(email) <= 254
           AND email ~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$') NOT VALID,
  ADD CONSTRAINT contact_messages_phone_shape
    CHECK (phone IS NULL
           OR (char_length(phone) BETWEEN 5 AND 32 AND phone ~ '^[0-9+()./ -]+$')) NOT VALID,
  ADD CONSTRAINT contact_messages_subject_len
    CHECK (subject IS NULL OR char_length(subject) <= 200) NOT VALID,
  ADD CONSTRAINT contact_messages_message_len
    CHECK (char_length(message) BETWEEN 1 AND 5000) NOT VALID;

ALTER TABLE public.subscribers
  DROP CONSTRAINT IF EXISTS subscribers_email_shape,
  DROP CONSTRAINT IF EXISTS subscribers_name_len;

ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_email_shape
    CHECK (char_length(email) <= 254
           AND email ~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$') NOT VALID,
  ADD CONSTRAINT subscribers_name_len
    CHECK (name IS NULL OR char_length(name) <= 120) NOT VALID;

-- ── 5. Wire the triggers ─────────────────────────────────────────────────────
-- BEFORE triggers fire in name order, so 10_ (clean) runs before 20_ (limit)
-- and the limiter never sees a raw payload. The CHECK constraints above are
-- evaluated after both, which means a submission that fails validation has
-- still spent a slot in the window — deliberate, since a bot posting garbage
-- is exactly the traffic being counted.

DROP TRIGGER IF EXISTS trg_10_clean_contact_message ON public.contact_messages;
CREATE TRIGGER trg_10_clean_contact_message
  BEFORE INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_clean_contact_message();

DROP TRIGGER IF EXISTS trg_20_rate_limit_contact_message ON public.contact_messages;
CREATE TRIGGER trg_20_rate_limit_contact_message
  BEFORE INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_rate_limit_public_form();

DROP TRIGGER IF EXISTS trg_10_clean_subscriber ON public.subscribers;
CREATE TRIGGER trg_10_clean_subscriber
  BEFORE INSERT ON public.subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_clean_subscriber();

DROP TRIGGER IF EXISTS trg_20_rate_limit_subscriber ON public.subscribers;
CREATE TRIGGER trg_20_rate_limit_subscriber
  BEFORE INSERT ON public.subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_rate_limit_public_form();

-- ── 6. Keep the helpers off the public API ───────────────────────────────────
-- PostgREST publishes any argument-taking function in `public` that the caller
-- may EXECUTE, and Postgres grants EXECUTE to PUBLIC by default. These two are
-- internals, so take that back. The three trigger functions return `trigger`
-- and PostgREST never exposes those; their grants are left alone so the
-- triggers cannot be affected.

REVOKE ALL ON FUNCTION public.fn_request_ip()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_clean_text(text, integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_clean_body(text, integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_control_chars(boolean)      FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── After the fact ───────────────────────────────────────────────────────────
-- What is already in the two tables that the new rules would reject:
--
--   SELECT id, name, email FROM public.contact_messages
--    WHERE NOT (email ~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$')
--       OR char_length(message) > 5000;
--
-- Once that is empty or cleaned up, promote the constraints:
--
--   ALTER TABLE public.contact_messages VALIDATE CONSTRAINT contact_messages_name_len;
--   ALTER TABLE public.contact_messages VALIDATE CONSTRAINT contact_messages_email_shape;
--   ALTER TABLE public.contact_messages VALIDATE CONSTRAINT contact_messages_phone_shape;
--   ALTER TABLE public.contact_messages VALIDATE CONSTRAINT contact_messages_subject_len;
--   ALTER TABLE public.contact_messages VALIDATE CONSTRAINT contact_messages_message_len;
--   ALTER TABLE public.subscribers      VALIDATE CONSTRAINT subscribers_email_shape;
--   ALTER TABLE public.subscribers      VALIDATE CONSTRAINT subscribers_name_len;
