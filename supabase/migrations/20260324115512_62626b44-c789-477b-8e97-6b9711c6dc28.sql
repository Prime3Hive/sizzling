
-- Payroll records table
CREATE TABLE public.payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  staff_name character varying NOT NULL,
  staff_id_number character varying,
  department character varying,
  position character varying,
  salary_period character varying NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  basic_salary numeric NOT NULL DEFAULT 0,
  allowances numeric NOT NULL DEFAULT 0,
  deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  payment_method character varying,
  bank_name character varying,
  account_number character varying,
  account_name character varying,
  status character varying NOT NULL DEFAULT 'pending',
  notes text,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admins can manage payroll" ON public.payroll_records
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Admins can view payroll" ON public.payroll_records
  FOR SELECT TO authenticated USING (is_admin(auth.uid()));
