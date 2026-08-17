-- ═════════════════════════════════════════════════════════════════════════════
-- M-02 — identify the amounts corrupted by the parser defect (E-01).
--
-- READ-ONLY. Nothing here changes a single row. Run it in the Supabase SQL
-- editor and keep the output: it is the input to M-03, where a human re-enters
-- the true figures from the receipts.
--
-- DO NOT auto-correct from these results. The factor is not always 1000 — it
-- depends on how many digits followed the comma the browser mistook for a
-- decimal point ("922,340" -> 922.34 is 1000x; "12,50" -> 12.50 is 1x and is
-- invisible here). Only the receipts settle it.
--
-- Run this BEFORE migrating any data, per the gate in section 0.2.
--
-- ⚠ THE SUPABASE SQL EDITOR ONLY SHOWS THE LAST STATEMENT IN A SCRIPT.
-- This file holds seven queries, so running it whole displays Query 7 only.
-- To see any other one, select that query'''s text with the mouse and run just
-- the selection. For the headline corruption list in a single statement, use
-- sql/M-02a-corrupted-amounts.sql instead.
--
-- ── SCHEMA NOTE ─────────────────────────────────────────────────────────────
-- An earlier version of this file failed with
--   ERROR: column e.cancelled_at does not exist
-- because the live database was behind the migration folder.
--
-- sql/M-00-schema-probe.sql has since confirmed that `expenses` carries
-- status, approved_by, approved_at (20260723110000) and cancelled_at,
-- cancelled_by, cancellation_reason (20260816130000), so the cancelled-row
-- filters below are now active and the counts are exact.
--
-- Everything here still references only columns that predate this delivery, so
-- it can be run BEFORE the 20260817* migrations to capture the baseline — which
-- is what the gate in section 0.2 asks for.
--
-- NOT filtered on `status`: a rejected expense with a corrupted amount is still
-- a corrupted record worth seeing. Add `AND status = 'approved'` if you want the
-- narrower list.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── Query 1. Headline counts ────────────────────────────────────────────────
-- The single number the gate asks for.

WITH exp_tokens AS (
  SELECT
    e.id,
    e.amount,
    MAX(replace(m[1], ',', '')::numeric) AS largest_in_description
  FROM public.expenses e
  LEFT JOIN LATERAL regexp_matches(COALESCE(e.description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  WHERE e.cancelled_at IS NULL
  GROUP BY e.id, e.amount
),
pay_tokens AS (
  SELECT
    p.id,
    p.amount,
    MAX(replace(m[1], ',', '')::numeric) AS largest_in_text
  FROM public.payables p
  LEFT JOIN LATERAL regexp_matches(
    COALESCE(p.description, '') || ' ' || COALESCE(p.supplier, ''),
    '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  GROUP BY p.id, p.amount
)
SELECT
  'expenses' AS table_name,
  COUNT(*) FILTER (WHERE amount < 100 AND largest_in_description > 1000) AS matches_audit_rule,
  COUNT(*) FILTER (WHERE largest_in_description >= amount * 100)         AS implausible_100x,
  COUNT(*)                                                              AS rows_examined
FROM exp_tokens

UNION ALL

SELECT
  'payables',
  COUNT(*) FILTER (WHERE amount < 100 AND largest_in_text > 1000),
  COUNT(*) FILTER (WHERE largest_in_text >= amount * 100),
  COUNT(*)
FROM pay_tokens;


-- ── Query 2. The expense rows themselves, worst first ───────────────────────
-- This is the working list for M-03. Export it.

WITH tokens AS (
  SELECT
    e.id, e.date, e.amount, e.description, e.category,
    e.created_by, e.created_at,
    MAX(replace(m[1], ',', '')::numeric) AS largest_in_description
  FROM public.expenses e
  LEFT JOIN LATERAL regexp_matches(COALESCE(e.description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  WHERE e.cancelled_at IS NULL
  GROUP BY e.id, e.date, e.amount, e.description, e.category, e.created_by, e.created_at
)
SELECT
  id,
  date,
  amount                                            AS stored_amount,
  largest_in_description                            AS description_says,
  ROUND(largest_in_description / NULLIF(amount, 0)) AS factor,
  category,
  description
FROM tokens
WHERE largest_in_description >= amount * 100
ORDER BY factor DESC NULLS LAST, date DESC;


-- ── Query 3. The same for the payables (credit) register ────────────────────

WITH tokens AS (
  SELECT
    p.id, p.incurred_date, p.amount, p.supplier, p.description,
    MAX(replace(m[1], ',', '')::numeric) AS largest_in_text
  FROM public.payables p
  LEFT JOIN LATERAL regexp_matches(
    COALESCE(p.description, '') || ' ' || COALESCE(p.supplier, ''),
    '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  GROUP BY p.id, p.incurred_date, p.amount, p.supplier, p.description
)
SELECT
  id, incurred_date,
  amount                                     AS stored_amount,
  largest_in_text                            AS text_says,
  ROUND(largest_in_text / NULLIF(amount, 0)) AS factor,
  supplier, description
FROM tokens
WHERE largest_in_text >= amount * 100
ORDER BY factor DESC NULLS LAST, incurred_date DESC;


-- ── Query 4. Staff report JSON lines ────────────────────────────────────────
-- The staff expense report stores its lines in details->'lines'. This is the
-- route that produced the ₦922.34 record, so check it directly.
--
-- The amount is cast only when it actually looks like a number: a legacy line
-- carrying '' or a stray string would abort the whole query on a hard cast.
-- New lines carry amount_minor (kobo) and are preferred where present.

WITH lines AS (
  SELECT
    r.id                     AS report_id,
    r.report_date,
    r.user_id                AS submitted_by,
    r.amount                 AS report_total,
    l.ord                    AS line_no,
    l.line ->> 'category'    AS category,
    l.line ->> 'description' AS line_description,
    CASE
      WHEN (l.line ->> 'amount_minor') ~ '^[0-9]+$'
        THEN (l.line ->> 'amount_minor')::numeric / 100
      WHEN (l.line ->> 'amount') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (l.line ->> 'amount')::numeric
      ELSE NULL
    END AS line_amount
  FROM public.staff_reports r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.details -> 'lines', '[]'::jsonb))
       WITH ORDINALITY AS l(line, ord)
  WHERE r.report_type = 'expense'
)
SELECT
  report_id, report_date, submitted_by, report_total,
  line_no, category, line_amount, line_description
FROM lines
WHERE line_amount IS NULL          -- a line with no readable amount at all
   OR EXISTS (
     SELECT 1
     FROM regexp_matches(COALESCE(line_description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m(tok)
     WHERE replace(tok[1], ',', '')::numeric >= line_amount * 100
   )
ORDER BY report_date DESC, line_no;


-- ── Query 5. Free-text categories needing a mapping (migration M-05) ────────
-- `row_count`, not `rows` — ROWS is a keyword in Postgres window frames.

SELECT
  category,
  COUNT(*)    AS row_count,
  SUM(amount) AS total,
  MIN(date)   AS first_seen,
  MAX(date)   AS last_seen
FROM public.expenses
WHERE cancelled_at IS NULL
GROUP BY category
ORDER BY row_count DESC;


-- ── Query 6. Fields that are empty once control characters are stripped ─────
-- Migration M-06. One payables row is reported as nothing but control
-- characters against ₦562,850.
--
-- The character class is written with E'' \uXXXX escapes rather than pasted
-- invisible literals, so it is readable and cannot be mangled by an editor:
--   U+200E/200F directional marks   U+FEFF byte-order mark
--   U+00A0      non-breaking space  U+200B-200D zero-width
--   U+2066-2069 directional isolates
-- These are the marks that show a value was pasted from a phone chat app.

WITH marks AS (
  SELECT E'[\u200E\u200F\uFEFF\u00A0\u200B-\u200D\u2066-\u2069]' AS re
)
SELECT 'payables.supplier' AS field, p.id, p.amount, p.supplier AS raw_value
FROM public.payables p, marks
WHERE btrim(regexp_replace(COALESCE(p.supplier, ''), marks.re, '', 'g')) = ''

UNION ALL

SELECT 'expenses.description', e.id, e.amount, e.description
FROM public.expenses e, marks
WHERE btrim(regexp_replace(COALESCE(e.description, ''), marks.re, '', 'g')) = ''

UNION ALL

SELECT 'expenses.contains_control_marks', e.id, e.amount, e.description
FROM public.expenses e, marks
WHERE COALESCE(e.description, '') ~ marks.re

UNION ALL

SELECT 'payables.contains_control_marks', p.id, p.amount, p.supplier
FROM public.payables p, marks
WHERE COALESCE(p.supplier, '') ~ marks.re
   OR COALESCE(p.description, '') ~ marks.re;


-- ── Query 7. Narratives that should have been several lines (M-04) ──────────
-- Three or more figures above 1,000 in one description is a pasted list.

WITH counted AS (
  SELECT e.id, e.date, e.amount, e.description,
         COUNT(*) FILTER (WHERE replace(m[1], ',', '')::numeric > 1000) AS big_numbers
  FROM public.expenses e
  LEFT JOIN LATERAL regexp_matches(COALESCE(e.description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  WHERE e.cancelled_at IS NULL
  GROUP BY e.id, e.date, e.amount, e.description
)
SELECT id, date, amount, big_numbers, description
FROM counted
WHERE big_numbers >= 3
ORDER BY big_numbers DESC, date DESC;
