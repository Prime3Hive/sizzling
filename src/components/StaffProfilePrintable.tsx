import React from "react";
import { formatNairaCompact } from "@/lib/currency";

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
  isAdmin?: boolean;
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

const StaffProfilePrintable = ({ profile, passportUrl, isAdmin = false }: StaffProfilePrintableProps) => {
  const tenure = calculateTenure(profile.employment_date, profile.year_of_joining);
  const documentNumber = `SS-${new Date().getFullYear()}-${profile.id.slice(0, 3).toUpperCase()}`;

  return (
    <div
      style={{
        width: "210mm",
        minHeight: "297mm",
        fontFamily: "'Segoe UI', 'Inter', Arial, sans-serif",
        backgroundColor: "#ffffff",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── LEFT ACCENT SIDEBAR ── */}
      <div
        style={{
          width: "52px",
          background: "linear-gradient(180deg, #ea580c 0%, #c2410c 100%)",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "32px",
          paddingBottom: "32px",
          gap: "8px",
        }}
      >
        <img src="/favicon.png" alt="Logo" style={{ width: "28px", height: "28px", objectFit: "contain", filter: "brightness(10)" }} />
        <div style={{ width: "1px", flex: 1, background: "rgba(255,255,255,0.2)", margin: "12px 0" }} />
        <p style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: "8px",
          fontWeight: 700,
          letterSpacing: "3px",
          textTransform: "uppercase",
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}>CONFIDENTIAL</p>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, padding: "36px 40px 28px 36px", display: "flex", flexDirection: "column", gap: "0" }}>

        {/* ── HEADER ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px", paddingBottom: "20px", borderBottom: "2px solid #f1f5f9" }}>
          <div>
            <p style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: "2px" }}>
              Sizzling Spices Ltd.
            </p>
            <h1 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.5px" }}>
              Employee Profile
            </h1>
            <p style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>Human Resources Department</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: "6px",
              padding: "6px 12px",
              marginBottom: "8px",
              display: "inline-block",
            }}>
              <p style={{ fontSize: "9px", color: "#9a3412", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", margin: 0 }}>
                Document No.
              </p>
              <p style={{ fontSize: "12px", color: "#ea580c", fontWeight: 800, margin: "2px 0 0" }}>{documentNumber}</p>
            </div>
            <p style={{ fontSize: "9px", color: "#94a3b8", display: "block" }}>
              Generated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* ── EMPLOYEE IDENTITY ── */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "28px", alignItems: "stretch" }}>
          {/* Photo */}
          <div style={{
            width: "110px",
            height: "130px",
            borderRadius: "8px",
            overflow: "hidden",
            flexShrink: 0,
            border: "3px solid #f1f5f9",
            background: "#fff7ed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {passportUrl ? (
              <img src={passportUrl} alt={profile.full_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "44px", fontWeight: 700, color: "#ea580c" }}>{profile.full_name.charAt(0)}</span>
            )}
          </div>

          {/* Identity Info */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <h2 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: "0 0 4px", letterSpacing: "-0.5px" }}>
              {profile.full_name}
            </h2>
            <p style={{ fontSize: "14px", color: "#ea580c", fontWeight: 600, margin: "0 0 12px" }}>
              {positionLabels[profile.position] || profile.position}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <InfoPill label="ID" value={generateEmployeeId(profile.id)} accent />
              {profile.departments && <InfoPill label="Dept" value={profile.departments.name} />}
              {profile.employment_type && <InfoPill label="Type" value={employmentTypeLabels[profile.employment_type] || profile.employment_type} />}
              {tenure && <InfoPill label="Tenure" value={tenure} />}
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
            <StatBox label="Gender" value={genderLabels[profile.gender || ''] || '—'} />
            <StatBox label="Marital" value={maritalStatusLabels[profile.marital_status || ''] || '—'} />
            {isAdmin && profile.salary && <StatBox label="Salary" value={formatNairaCompact(profile.salary)} accent />}
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div style={{ height: "1px", background: "#f1f5f9", marginBottom: "24px" }} />

        {/* ── TWO COLUMN SECTIONS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px 40px", flex: 1 }}>

          {/* Employment Details */}
          <Section title="Employment Details">
            <Row label="Hire Date" value={profile.employment_date
              ? new Date(profile.employment_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : profile.year_of_joining?.toString() || '—'} />
            <Row label="Employment Type" value={employmentTypeLabels[profile.employment_type || ''] || '—'} />
            <Row label="Education Level" value={educationLabels[profile.level_of_education || ''] || '—'} />
            <Row label="Year Joined" value={profile.year_of_joining?.toString() || '—'} />
          </Section>

          {/* Contact Information */}
          <Section title="Contact Information">
            <Row label="Email" value={profile.email_address || '—'} />
            <Row label="Phone" value={profile.phone_number || '—'} />
            <Row label="State of Origin" value={profile.state_of_origin || '—'} />
            <Row label="LGA" value={profile.lga || '—'} />
          </Section>

          {/* Bank Details — visible to Admin and HR */}
          <Section title="Bank Details">
            <Row label="Bank Name" value={profile.bank_name || '—'} />
            <Row label="Account Number" value={profile.account_number || '—'} />
            <Row label="Account Name" value={profile.account_name || '—'} />
          </Section>

          {/* Emergency Contact */}
          <Section title="Emergency Contact">
            <Row label="Full Name" value={profile.emergency_contact_name || '—'} />
            <Row label="Phone" value={profile.emergency_contact_phone || '—'} />
            <Row label="Relationship" value={profile.emergency_contact_relationship || '—'} />
          </Section>

          {/* Personal / NIN */}
          <Section title="Personal Details">
            <Row label="Date of Birth" value={profile.date_of_birth
              ? new Date(profile.date_of_birth).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : '—'} />
            <Row label="NIN" value={profile.nin || '—'} />
            {profile.residential_address && (
              <Row label="Address" value={profile.residential_address} />
            )}
          </Section>

          {/* Skills – spans full width if present */}
          {profile.skills_experience && (
            <div style={{ gridColumn: "1 / -1" }}>
              <Section title="Skills & Experience">
                <p style={{ fontSize: "11px", color: "#475569", lineHeight: "1.7", whiteSpace: "pre-wrap", margin: 0 }}>
                  {profile.skills_experience}
                </p>
              </Section>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{
          marginTop: "28px",
          paddingTop: "16px",
          borderTop: "1px solid #f1f5f9",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}>
          <div style={{ display: "flex", gap: "48px" }}>
            <SigLine label="Authorised By" />
            <SigLine label="HR Representative" />
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "9px", color: "#cbd5e1", margin: 0 }}>INTERNAL USE ONLY — NOT FOR EXTERNAL DISTRIBUTION</p>
            <p style={{ fontSize: "9px", color: "#cbd5e1", margin: "2px 0 0" }}>© {new Date().getFullYear()} Sizzling Spices Ltd. · HR Portal</p>
          </div>
        </div>

      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p style={{
      fontSize: "9px",
      fontWeight: 700,
      color: "#ea580c",
      textTransform: "uppercase",
      letterSpacing: "2px",
      borderBottom: "1.5px solid #fed7aa",
      paddingBottom: "5px",
      marginBottom: "10px",
    }}>{title}</p>
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{children}</div>
  </div>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", paddingBottom: "5px", borderBottom: "1px solid #f8fafc" }}>
    <span style={{ color: "#94a3b8", fontWeight: 500 }}>{label}</span>
    <span style={{ color: "#1e293b", fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{value}</span>
  </div>
);

const InfoPill = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => (
  <span style={{
    fontSize: "10px",
    padding: "3px 10px",
    borderRadius: "20px",
    background: accent ? "#fff7ed" : "#f1f5f9",
    color: accent ? "#ea580c" : "#475569",
    fontWeight: 600,
    border: accent ? "1px solid #fed7aa" : "1px solid #e2e8f0",
    display: "inline-block",
  }}>
    <span style={{ color: "#94a3b8", fontWeight: 500 }}>{label}: </span>{value}
  </span>
);

const StatBox = ({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) => (
  <div style={{
    background: accent ? "#fff7ed" : "#f8fafc",
    border: accent ? "1px solid #fed7aa" : "1px solid #f1f5f9",
    borderRadius: "8px",
    padding: "8px 14px",
    textAlign: "center",
    minWidth: "90px",
  }}>
    <p style={{ fontSize: "8px", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 2px" }}>{label}</p>
    <p style={{ fontSize: "13px", fontWeight: 700, color: accent ? "#ea580c" : "#0f172a", margin: 0 }}>{value}</p>
  </div>
);

const SigLine = ({ label }: { label: string }) => (
  <div style={{ width: "120px" }}>
    <div style={{ height: "36px", borderBottom: "1.5px solid #cbd5e1", marginBottom: "4px" }} />
    <p style={{ fontSize: "9px", color: "#94a3b8", textAlign: "center", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", margin: 0 }}>{label}</p>
  </div>
);

export default StaffProfilePrintable;
