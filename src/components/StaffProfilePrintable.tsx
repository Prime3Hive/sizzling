import { formatNairaCompact } from "@/lib/currency";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Department {
  id: string;
  name: string;
}

interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string | null;
  date_of_birth: string | null;
  year_of_joining: number | null;
  department_id: string | null;
  salary: number | null;
  passport_path: string | null;
  skills_experience: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  departments?: Department;
  gender: string | null;
  marital_status: string | null;
  state_of_origin: string | null;
  lga: string | null;
  residential_address: string | null;
  email_address: string | null;
  nin: string | null;
  employment_type: string | null;
  employment_date: string | null;
  level_of_education: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
}

interface StaffProfilePrintableProps {
  profile: StaffProfile;
  passportUrl: string | null;
}

const positionLabels: Record<string, string> = {
  managing_director: "Managing Director",
  general_manager: "General Manager",
  kitchen_manager: "Kitchen Manager",
  event_manager: "Event Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

const genderLabels: Record<string, string> = {
  male: "Male",
  female: "Female",
};

const maritalStatusLabels: Record<string, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
};

const employmentTypeLabels: Record<string, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contract: "Contract",
  internship: "Internship",
};

const educationLabels: Record<string, string> = {
  primary: "Primary School",
  secondary: "Secondary School",
  ond: "OND/NCE",
  hnd: "HND",
  bsc: "Bachelor's Degree",
  msc: "Master's Degree",
  phd: "Doctorate (PhD)",
  professional: "Professional Cert.",
};

const generateEmployeeId = (id: string) => {
  return `EMP-${id.slice(0, 5).toUpperCase()}`;
};

const calculateTenure = (employmentDate: string | null, yearOfJoining: number | null) => {
  const startYear = employmentDate 
    ? new Date(employmentDate).getFullYear() 
    : yearOfJoining;
  
  if (!startYear) return null;
  
  const currentDate = new Date();
  const years = currentDate.getFullYear() - startYear;
  const months = currentDate.getMonth();
  
  if (years === 0 && months === 0) return "Less than 1 month";
  if (years === 0) return `${months} Month${months > 1 ? 's' : ''}`;
  if (months === 0) return `${years} Year${years > 1 ? 's' : ''}`;
  return `${years} Year${years > 1 ? 's' : ''}, ${months} Month${months > 1 ? 's' : ''}`;
};

const StaffProfilePrintable = ({ profile, passportUrl }: StaffProfilePrintableProps) => {
  const tenure = calculateTenure(profile.employment_date, profile.year_of_joining);
  const documentNumber = `SS-${new Date().getFullYear()}-${profile.id.slice(0, 3).toUpperCase()}`;

  return (
    <div 
      className="bg-white relative overflow-hidden" 
      style={{ 
        width: "210mm", 
        minHeight: "297mm", 
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        padding: "48px"
      }}
    >
      {/* Confidential Watermark */}
      <div className="absolute top-10 right-10 pointer-events-none opacity-10 rotate-12">
        <p className="text-6xl font-black text-slate-900 tracking-widest uppercase">Confidential</p>
      </div>

      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-slate-100 pb-8 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded flex items-center justify-center">
            <img 
              src="/favicon.png" 
              alt="Logo" 
              className="w-7 h-7 object-contain"
            />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Sizzling Spices</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Human Resources Department</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-900">Document No: {documentNumber}</p>
          <p className="text-xs text-slate-500">
            Date Generated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          <span className="inline-block mt-2 px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded uppercase border border-red-100">
            Confidential
          </span>
        </div>
      </div>

      {/* Employee Identity Section */}
      <div className="flex gap-8 mb-10">
        <div 
          className="rounded-xl w-40 h-40 border-4 border-slate-50 shadow-sm overflow-hidden flex-shrink-0"
        >
          <Avatar className="w-full h-full rounded-none">
            <AvatarImage src={passportUrl || undefined} alt={profile.full_name} className="object-cover" />
            <AvatarFallback className="text-5xl bg-orange-100 text-orange-600 rounded-none w-full h-full">
              {profile.full_name.charAt(0)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex flex-col justify-center">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{profile.full_name}</h2>
          <p className="text-xl text-orange-500 font-semibold mb-2">{positionLabels[profile.position] || profile.position}</p>
          <div className="flex flex-col gap-1">
            <p className="text-slate-600 text-sm flex items-center gap-2">
              <span className="text-slate-400">●</span>
              Employee ID: <span className="font-bold text-slate-900">{generateEmployeeId(profile.id)}</span>
            </p>
            {profile.departments && (
              <p className="text-slate-600 text-sm flex items-center gap-2">
                <span className="text-slate-400">●</span>
                Department: <span className="font-bold text-slate-900">{profile.departments.name}</span>
              </p>
            )}
            <p className="text-slate-600 text-[11px] font-medium leading-normal mt-2 italic">
              INTERNAL USE ONLY - NOT FOR EXTERNAL DISTRIBUTION
            </p>
          </div>
        </div>
      </div>

      {/* Two Column Grid */}
      <div className="grid grid-cols-2 gap-x-12 gap-y-10">
        {/* Employment Details */}
        <div>
          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
            Employment Details
          </h3>
          <div className="space-y-3">
            <DetailRow label="Status" value={employmentTypeLabels[profile.employment_type || ''] || 'N/A'} />
            <DetailRow 
              label="Hire Date" 
              value={profile.employment_date 
                ? new Date(profile.employment_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) 
                : profile.year_of_joining?.toString() || 'N/A'
              } 
            />
            <DetailRow label="Education" value={educationLabels[profile.level_of_education || ''] || 'N/A'} />
            <DetailRow label="State of Origin" value={profile.state_of_origin || 'N/A'} />
          </div>
        </div>

        {/* Contact Information */}
        <div>
          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
            Contact Information
          </h3>
          <div className="space-y-3">
            <DetailRow label="Email Address" value={profile.email_address || 'N/A'} />
            <DetailRow label="Mobile Phone" value={profile.phone_number || 'N/A'} />
            <DetailRow label="LGA" value={profile.lga || 'N/A'} />
            <DetailRow label="NIN" value={profile.nin || 'N/A'} />
          </div>
        </div>

        {/* Performance & Summary - Full Width */}
        <div className="col-span-2">
          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
            Employee Summary
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <SummaryCard label="Gender" value={genderLabels[profile.gender || ''] || 'N/A'} />
            <SummaryCard label="Marital Status" value={maritalStatusLabels[profile.marital_status || ''] || 'N/A'} />
            <SummaryCard label="Tenure" value={tenure || 'N/A'} />
            <SummaryCard label="Monthly Salary" value={profile.salary ? formatNairaCompact(profile.salary) : 'N/A'} highlight />
          </div>
        </div>

        {/* Bank Details */}
        <div>
          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
            Bank Details
          </h3>
          <div className="space-y-3">
            <DetailRow label="Bank Name" value={profile.bank_name || 'N/A'} />
            <DetailRow label="Account Number" value={profile.account_number || 'N/A'} />
            <DetailRow label="Account Name" value={profile.account_name || 'N/A'} />
          </div>
        </div>

        {/* Emergency Contact */}
        <div>
          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
            Emergency Contact
          </h3>
          <div className="space-y-3">
            <DetailRow label="Contact Name" value={profile.emergency_contact_name || 'N/A'} />
            <DetailRow label="Phone Number" value={profile.emergency_contact_phone || 'N/A'} />
            <DetailRow label="Relationship" value={profile.emergency_contact_relationship || 'N/A'} />
          </div>
        </div>

        {/* Skills & Experience - Full Width */}
        {profile.skills_experience && (
          <div className="col-span-2 mt-2">
            <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
              Skills & Experience
            </h3>
            <div className="p-4 border-l-4 border-orange-500 bg-orange-50/30">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {profile.skills_experience}
              </p>
            </div>
          </div>
        )}

        {/* Residential Address - Full Width */}
        {profile.residential_address && (
          <div className="col-span-2">
            <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">
              Residential Address
            </h3>
            <p className="text-sm text-slate-700">{profile.residential_address}</p>
          </div>
        )}
      </div>

      {/* Footer with Signatures */}
      <div className="absolute bottom-10 left-12 right-12 flex justify-between items-end border-t border-slate-100 pt-6">
        <div className="flex gap-12">
          <SignatureLine label="Manager Signature" />
          <SignatureLine label="HR Representative" />
        </div>
        <div className="text-[10px] text-slate-400 text-right">
          <p>Generated by HR Portal System v1.0</p>
          <p>© {new Date().getFullYear()} Sizzling Spices Ltd.</p>
        </div>
      </div>
    </div>
  );
};

// Helper Components
const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between border-b border-slate-50 pb-1">
    <span className="text-sm text-slate-500">{label}</span>
    <span className="text-sm font-bold text-slate-900 text-right max-w-[55%] truncate">{value}</span>
  </div>
);

const SummaryCard = ({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) => (
  <div className={`p-4 rounded-lg ${highlight ? 'bg-orange-50 border border-orange-100' : 'bg-slate-50'}`}>
    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</p>
    <p className={`text-lg font-bold ${highlight ? 'text-orange-600' : 'text-slate-900'}`}>{value}</p>
  </div>
);

const SignatureLine = ({ label }: { label: string }) => (
  <div className="w-32">
    <div className="h-10 border-b border-slate-300 mb-1"></div>
    <p className="text-[10px] text-slate-400 text-center uppercase font-bold">{label}</p>
  </div>
);

export default StaffProfilePrintable;
