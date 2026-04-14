-- Fix remaining security issues

-- Update update_updated_at_column function to have proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Check if budget_summary view exists and recreate it without SECURITY DEFINER if needed
-- First drop the view if it exists
DROP VIEW IF EXISTS public.budget_summary;

-- Recreate the budget_summary view without SECURITY DEFINER
CREATE VIEW public.budget_summary AS
SELECT 
    b.id,
    b.user_id,
    b.title,
    b.type,
    b.total_budget,
    b.start_date,
    b.end_date,
    b.created_at,
    b.updated_at,
    COALESCE(SUM(e.amount), 0) as total_spent,
    COALESCE(COUNT(e.id), 0) as expense_count,
    (b.total_budget - COALESCE(SUM(e.amount), 0)) as remaining_budget,
    CASE 
        WHEN b.total_budget > 0 THEN 
            ROUND((COALESCE(SUM(e.amount), 0) / b.total_budget * 100)::numeric, 2)
        ELSE 0 
    END as percentage_used,
    (COALESCE(SUM(e.amount), 0) > b.total_budget) as is_overspent
FROM budgets b
LEFT JOIN expenses e ON b.id = e.budget_id
GROUP BY b.id, b.user_id, b.title, b.type, b.total_budget, b.start_date, b.end_date, b.created_at, b.updated_at;