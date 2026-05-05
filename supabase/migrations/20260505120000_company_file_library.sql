-- Company file library: folders + files + storage bucket

-- Folders table
CREATE TABLE IF NOT EXISTS public.company_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage company folders"
  ON public.company_folders
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER update_company_folders_updated_at
  BEFORE UPDATE ON public.company_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Files metadata table
CREATE TABLE IF NOT EXISTS public.company_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id UUID NOT NULL REFERENCES public.company_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_type TEXT,
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage company files"
  ON public.company_files
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Storage bucket (50 MB per file limit, private)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('company-files', 'company-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "Admins can upload to company-files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-files' AND is_admin(auth.uid()));

CREATE POLICY "Admins can read company-files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-files' AND is_admin(auth.uid()));

CREATE POLICY "Admins can delete from company-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-files' AND is_admin(auth.uid()));

CREATE POLICY "Admins can update company-files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-files' AND is_admin(auth.uid()));
