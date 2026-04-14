-- Add new columns to staff_profiles table for enhanced staff information

-- Personal Information
ALTER TABLE public.staff_profiles 
ADD COLUMN IF NOT EXISTS gender varchar(20),
ADD COLUMN IF NOT EXISTS marital_status varchar(30),
ADD COLUMN IF NOT EXISTS state_of_origin varchar(100),
ADD COLUMN IF NOT EXISTS lga varchar(100),
ADD COLUMN IF NOT EXISTS residential_address text,
ADD COLUMN IF NOT EXISTS email_address varchar(255),
ADD COLUMN IF NOT EXISTS nin varchar(20);

-- Employment Details (year_of_joining already exists)
ALTER TABLE public.staff_profiles 
ADD COLUMN IF NOT EXISTS employment_type varchar(50),
ADD COLUMN IF NOT EXISTS employment_date date;

-- Education
ALTER TABLE public.staff_profiles 
ADD COLUMN IF NOT EXISTS level_of_education varchar(100);

-- Bank Details
ALTER TABLE public.staff_profiles 
ADD COLUMN IF NOT EXISTS bank_name varchar(100),
ADD COLUMN IF NOT EXISTS account_number varchar(20),
ADD COLUMN IF NOT EXISTS account_name varchar(200);

-- Emergency Contact
ALTER TABLE public.staff_profiles 
ADD COLUMN IF NOT EXISTS emergency_contact_name varchar(200),
ADD COLUMN IF NOT EXISTS emergency_contact_phone varchar(20),
ADD COLUMN IF NOT EXISTS emergency_contact_relationship varchar(50);