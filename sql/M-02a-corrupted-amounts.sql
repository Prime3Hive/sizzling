-- ═════════════════════════════════════════════════════════════════════════════
-- M-02a — the corruption list, as ONE statement.
--
-- Run this file whole. It is a single SELECT, so the Supabase SQL editor will
-- show its result. (The multi-query files M-00 and M-02 only ever display their
-- LAST statement — to see the others there, select one query's text with the
-- mouse and run just the selection.)
--
-- READ-ONLY. Covers expenses and payables together.
--
-- Every returned row carries `suspect_rows_total`, the count the section 0.2
-- gate asks for. AN EMPTY RESULT MEANS ZERO CORRUPTED ROWS — that is the good
-- outcome, not a failed query.
--
-- The test: the largest figure written in the text is at least 100x the amount
-- actually stored. `factor` shows by how much. Expect roughly 1,000 for an
-- amount typed with one thousands comma ("922,340" -> 922.34) and 1,000,000 for
-- one typed with two ("1,481,150" -> 1.48), because the browser consumed each
-- comma as a decimal point and the input's step rounded what was left.
--
-- DO NOT auto-correct from `factor`. It is a diagnosis, not a repair
-- instruction — the receipts settle the true figure.
-- ═════════════════════════════════════════════════════════════════════════════

WITH exp_tok AS (
  SELECT
    e.id,
    e.date        AS doc_date,
    e.amount,
    e.description,
    e.category,
    MAX(replace(m[1], ',', '')::numeric) AS largest
  FROM public.expenses e
  LEFT JOIN LATERAL regexp_matches(
    COALESCE(e.description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  WHERE e.cancelled_at IS NULL
  GROUP BY e.id, e.date, e.amount, e.description, e.category
),
pay_tok AS (
  SELECT
    p.id,
    p.incurred_date AS doc_date,
    p.amount,
    COALESCE(p.supplier, '') || ' — ' || COALESCE(p.description, '') AS description,
    p.category,
    MAX(replace(m[1], ',', '')::numeric) AS largest
  FROM public.payables p
  LEFT JOIN LATERAL regexp_matches(
    COALESCE(p.description, '') || ' ' || COALESCE(p.supplier, ''),
    '\d[\d,]*(?:\.\d+)?', 'g') AS m ON true
  GROUP BY p.id, p.incurred_date, p.amount, p.description, p.supplier, p.category
),
all_rows AS (
  SELECT 'expenses'::text AS source, * FROM exp_tok
  UNION ALL
  SELECT 'payables'::text,           * FROM pay_tok
),
suspect AS (
  SELECT * FROM all_rows
  WHERE largest >= amount * 100
)
SELECT
  COUNT(*) OVER ()                        AS suspect_rows_total,
  SUM(largest) OVER ()                    AS true_value_if_text_is_right,
  SUM(amount)  OVER ()                    AS currently_recorded,
  source,
  id,
  doc_date,
  amount                                  AS stored_amount,
  largest                                 AS text_says,
  ROUND(largest / NULLIF(amount, 0))      AS factor,
  category,
  left(description, 150)                  AS description_start
FROM suspect
ORDER BY factor DESC NULLS LAST, doc_date DESC;
