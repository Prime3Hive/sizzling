-- Fix inventory_requests RLS to align with frontend role-based access control.
--
-- Option A design:
--   - Any authenticated user can CREATE and manage their OWN requests.
--   - Admin, manager, and HR roles can VIEW all requests (regardless of owner).
--   - Only admin can UPDATE or DELETE requests they do not own.
--
-- The previous SELECT policy used departments.name = 'Management' which is
-- fragile (department rename breaks access) and inconsistent with the
-- role-based isAdmin/isManager/isHR checks used in the frontend.

-- ── SELECT ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view their own inventory requests" ON public.inventory_requests;
DROP POLICY IF EXISTS "Users can view their own inventory requests or if admin/management" ON public.inventory_requests;

CREATE POLICY "inventory_requests_select"
ON public.inventory_requests
FOR SELECT
USING (
  -- Own requests (all staff)
  auth.uid() = user_id
  OR
  -- Admin, manager, or HR role (approved)
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager', 'hr')
      AND role_status = 'approved'
  )
);

-- ── INSERT ────────────────────────────────────────────────────────────────────
-- Keep existing policy: any authenticated user can submit their own request.
-- (No change needed — "Users can create their own inventory requests" is correct.)

-- ── UPDATE ────────────────────────────────────────────────────────────────────
-- Staff can update their own PENDING requests; admins can update any request.
DROP POLICY IF EXISTS "Users can update their own inventory requests" ON public.inventory_requests;

CREATE POLICY "inventory_requests_update"
ON public.inventory_requests
FOR UPDATE
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'manager'
      AND role_status = 'approved'
  )
);

-- ── DELETE ────────────────────────────────────────────────────────────────────
-- Staff can delete their own requests; admins can delete any request.
DROP POLICY IF EXISTS "Users can delete their own inventory requests" ON public.inventory_requests;

CREATE POLICY "inventory_requests_delete"
ON public.inventory_requests
FOR DELETE
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
);
