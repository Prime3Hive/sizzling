-- Create staff_documents table
CREATE TABLE public.staff_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  file_size bigint,
  description text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies (admin only, matching staff_profiles)
CREATE POLICY "Admins can view staff documents"
  ON public.staff_documents FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert staff documents"
  ON public.staff_documents FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update staff documents"
  ON public.staff_documents FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete staff documents"
  ON public.staff_documents FOR DELETE
  TO authenticated
  USING (is_admin(auth.uid()));

-- Create storage bucket for staff documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-documents', 'staff-documents', false);

-- Storage RLS: admin can upload
CREATE POLICY "Admins can upload staff documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'staff-documents' AND is_admin(auth.uid()));

-- Storage RLS: admin can view
CREATE POLICY "Admins can view staff documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'staff-documents' AND is_admin(auth.uid()));

-- Storage RLS: admin can delete
CREATE POLICY "Admins can delete staff documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'staff-documents' AND is_admin(auth.uid()));