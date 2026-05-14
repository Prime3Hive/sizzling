-- ─────────────────────────────────────────────────────────────────────────────
-- KPI Period Summary Function
-- Returns rank position + band distribution for a given staff member / period.
-- SECURITY DEFINER so it bypasses RLS — only aggregated counts are exposed,
-- never individual scores or names.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_kpi_period_summary(
  p_period_id        uuid,
  p_staff_profile_id uuid
)
RETURNS TABLE (
  my_rank               bigint,
  total_staff           bigint,
  cnt_excellent         bigint,
  cnt_good              bigint,
  cnt_satisfactory      bigint,
  cnt_needs_improvement bigint,
  cnt_poor              bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH period_scores AS (
    SELECT staff_profile_id, percentage
    FROM   kpi_staff_scores
    WHERE  period_id = p_period_id
  ),
  my_pct AS (
    SELECT percentage
    FROM   period_scores
    WHERE  staff_profile_id = p_staff_profile_id
  )
  SELECT
    -- rank = number of staff with a strictly higher score + 1
    COALESCE(
      (SELECT COUNT(*) + 1 FROM period_scores ps, my_pct m WHERE ps.percentage > m.percentage),
      1
    )::bigint                                                          AS my_rank,
    (SELECT COUNT(*) FROM period_scores)::bigint                      AS total_staff,
    (SELECT COUNT(*) FROM period_scores WHERE percentage >= 90)::bigint AS cnt_excellent,
    (SELECT COUNT(*) FROM period_scores WHERE percentage >= 75 AND percentage < 90)::bigint AS cnt_good,
    (SELECT COUNT(*) FROM period_scores WHERE percentage >= 60 AND percentage < 75)::bigint AS cnt_satisfactory,
    (SELECT COUNT(*) FROM period_scores WHERE percentage >= 40 AND percentage < 60)::bigint AS cnt_needs_improvement,
    (SELECT COUNT(*) FROM period_scores WHERE percentage  < 40)::bigint AS cnt_poor;
$$;

-- Allow every authenticated user to call it
GRANT EXECUTE ON FUNCTION public.get_kpi_period_summary(uuid, uuid) TO authenticated;
