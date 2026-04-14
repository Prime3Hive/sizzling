-- Fix persistent staff profile creation errors:
-- 1) "duplicate key value violates unique constraint staff_profiles_user_id_key" happens because user_id is (incorrectly) UNIQUE.
-- 2) user_id is meant to represent the owning account/tenant (auth user), so multiple staff rows must be allowed per user.

ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_user_id_key;

-- In some setups the unique constraint may have been created as a unique index instead.
DROP INDEX IF EXISTS public.staff_profiles_user_id_key;

-- Re-add a non-unique index for performance (common filter for RLS/queries)
CREATE INDEX IF NOT EXISTS idx_staff_profiles_user_id
  ON public.staff_profiles (user_id);
