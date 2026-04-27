-- ================================================================
-- GRANT HR ACCESS TO STAFF DOCUMENTS
-- Problem: staff_documents table and storage bucket "staff-documents"
-- policies are admin-only. HR needs full access (upload, view, delete)
-- as part of their core HR function.
--
-- Also allow staff to view their own documents via linked_user_id.
-- ================================================================

-- ── TABLE: staff_documents ────────────────────────────────────────

-- SELECT: admin, HR, or staff viewing their own documents
DROP POLICY IF EXISTS "Admins can view staff documents" ON public.staff_documents;
CREATE POLICY "Admin or HR can view staff documents"
  ON public.staff_documents FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = staff_documents.staff_profile_id
        AND sp.linked_user_id = auth.uid()
    )
  );

-- INSERT: admin or HR
DROP POLICY IF EXISTS "Admins can insert staff documents" ON public.staff_documents;
CREATE POLICY "Admin or HR can insert staff documents"
  ON public.staff_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
  );

-- UPDATE: admin or HR
DROP POLICY IF EXISTS "Admins can update staff documents" ON public.staff_documents;
CREATE POLICY "Admin or HR can update staff documents"
  ON public.staff_documents FOR UPDATE
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
  );

-- DELETE: admin or HR
DROP POLICY IF EXISTS "Admins can delete staff documents" ON public.staff_documents;
CREATE POLICY "Admin or HR can delete staff documents"
  ON public.staff_documents FOR DELETE
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
  );

-- ── STORAGE BUCKET: staff-documents ──────────────────────────────

-- Upload (INSERT): admin or HR
DROP POLICY IF EXISTS "Admins can upload staff documents" ON storage.objects;
CREATE POLICY "Admin or HR can upload staff documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'staff-documents'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  );

-- View (SELECT): admin, HR, or staff viewing their own folder
DROP POLICY IF EXISTS "Admins can view staff documents" ON storage.objects;
CREATE POLICY "Admin or HR can view staff documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'hr'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.linked_user_id = auth.uid()
          -- object name starts with staff_profile_id/
          AND storage.objects.name LIKE (sp.id::text || '/%')
      )
    )
  );

-- Delete: admin or HR
DROP POLICY IF EXISTS "Admins can delete staff documents" ON storage.objects;
CREATE POLICY "Admin or HR can delete staff documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'staff-documents'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  );
