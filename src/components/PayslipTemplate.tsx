import React from "react";
import { format } from "date-fns";

interface PayslipRecord {
  id: string;
  staff_name: string;
  staff_id_number: string | null;
  department: string | null;
  position: string | null;
  salary_period: string;
  period_start: string;
  period_end: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  status: string;
  paid_at: string | null;
  notes: string | null;
}

interface PayslipTemplateProps {
  record: PayslipRecord;
}

const fmt = (n: number) =>
  `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

const PayslipTemplate = ({ record }: PayslipTemplateProps) => {
  const grossPay = Number(record.basic_salary) + Number(record.allowances);
  const totalDeductions = Number(record.deductions);
  const netPay = Number(record.net_pay);
  const docRef = `PAY-${record.id.slice(0, 6).toUpperCase()}`;

  return (
    <div
      id="payslip-template"
      style={{
        width: "210mm",
        minHeight: "148mm",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        backgroundColor: "#ffffff",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
      }}
    >
      {/* Left Accent Bar */}
      <div
        style={{
          width: "8px",
          background: "linear-gradient(180deg, #ea580c 0%, #c2410c 100%)",
          flexShrink: 0,
        }}
      />

      {/* Main Content */}
      <div style={{ flex: 1, padding: "28px 32px 24px 28px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #f1f5f9", paddingBottom: "16px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/favicon.png" alt="Logo" style={{ width: "32px", height: "32px", objectFit: "contain" }} />
            <div>
              <p style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Sizzling Spices Ltd.</p>
              <p style={{ fontSize: "9px", color: "#94a3b8", margin: 0, letterSpacing: "1px", textTransform: "uppercase" }}>Human Resources · Payroll</p>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "18px", fontWeight: 900, color: "#ea580c", margin: "0 0 2px", letterSpacing: "-0.5px" }}>PAYSLIP</p>
            <p style={{ fontSize: "9px", color: "#94a3b8", margin: 0 }}>Ref: {docRef}</p>
            <p style={{ fontSize: "9px", color: "#94a3b8", margin: "2px 0 0" }}>
              Generated: {format(new Date(), "dd MMM yyyy")}
            </p>
          </div>
        </div>

        {/* Employee + Period Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          {/* Employee Details */}
          <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "12px 16px" }}>
            <p style={{ fontSize: "8px", fontWeight: 700, color: "#ea580c", textTransform: "uppercase", letterSpacing: "1.5px", margin: "0 0 8px" }}>Employee Details</p>
            <InfoLine label="Name" value={record.staff_name} bold />
            <InfoLine label="Employee ID" value={record.staff_id_number || "—"} />
            <InfoLine label="Department" value={record.department || "—"} />
            <InfoLine label="Position" value={record.position?.replace(/_/g, " ") || "—"} />
          </div>

          {/* Pay Period */}
          <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "12px 16px" }}>
            <p style={{ fontSize: "8px", fontWeight: 700, color: "#ea580c", textTransform: "uppercase", letterSpacing: "1.5px", margin: "0 0 8px" }}>Pay Period</p>
            <InfoLine label="Period" value={record.salary_period.toUpperCase()} bold />
            <InfoLine
              label="From"
              value={format(new Date(record.period_start), "dd MMM yyyy")}
            />
            <InfoLine
              label="To"
              value={format(new Date(record.period_end), "dd MMM yyyy")}
            />
            <InfoLine
              label="Status"
              value={record.status === "paid" ? "✅ PAID" : "⏳ PENDING"}
              accent={record.status === "paid" ? "green" : "orange"}
            />
          </div>
        </div>

        {/* Earnings + Deductions Side by Side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>

          {/* Earnings */}
          <div>
            <p style={{ fontSize: "8px", fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "1.5px", borderBottom: "1.5px solid #dcfce7", paddingBottom: "4px", margin: "0 0 8px" }}>Earnings</p>
            <EarningsRow label="Basic Salary" value={fmt(record.basic_salary)} />
            <EarningsRow label="Allowances" value={fmt(record.allowances)} muted={Number(record.allowances) === 0} />
            <div style={{ borderTop: "1.5px solid #f1f5f9", marginTop: "6px", paddingTop: "6px" }}>
              <EarningsRow label="Gross Pay" value={fmt(grossPay)} bold />
            </div>
          </div>

          {/* Deductions */}
          <div>
            <p style={{ fontSize: "8px", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "1.5px", borderBottom: "1.5px solid #fee2e2", paddingBottom: "4px", margin: "0 0 8px" }}>Deductions</p>
            <EarningsRow label="Total Deductions" value={fmt(record.deductions)} red />
            <div style={{ borderTop: "1.5px solid #f1f5f9", marginTop: "6px", paddingTop: "6px" }}>
              <EarningsRow label="Net Deductions" value={fmt(totalDeductions)} bold red />
            </div>
          </div>
        </div>

        {/* Net Pay Highlight */}
        <div style={{
          background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
          border: "1.5px solid #fed7aa",
          borderRadius: "10px",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}>
          <div>
            <p style={{ fontSize: "9px", fontWeight: 700, color: "#9a3412", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0 }}>Net Pay</p>
            <p style={{ fontSize: "9px", color: "#c2410c", margin: "2px 0 0" }}>
              {format(new Date(record.period_start), "dd MMM")} – {format(new Date(record.period_end), "dd MMM yyyy")}
            </p>
          </div>
          <p style={{ fontSize: "26px", fontWeight: 900, color: "#ea580c", margin: 0, letterSpacing: "-1px" }}>
            {fmt(netPay)}
          </p>
        </div>

        {/* Bank + Notes Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          <div>
            <p style={{ fontSize: "8px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "1.5px", borderBottom: "1px solid #f1f5f9", paddingBottom: "4px", margin: "0 0 8px" }}>Bank Details</p>
            <InfoLine label="Bank" value={record.bank_name || "—"} />
            <InfoLine label="Account No." value={record.account_number || "—"} />
            <InfoLine label="Account Name" value={record.account_name || "—"} />
          </div>
          {record.notes && (
            <div>
              <p style={{ fontSize: "8px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "1.5px", borderBottom: "1px solid #f1f5f9", paddingBottom: "4px", margin: "0 0 8px" }}>Notes</p>
              <p style={{ fontSize: "10px", color: "#475569", lineHeight: "1.6", margin: 0 }}>{record.notes}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: "40px" }}>
            <SigLine label="Authorised By" />
            <SigLine label="HR Representative" />
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "8px", color: "#cbd5e1", margin: 0 }}>CONFIDENTIAL — For recipient use only</p>
            <p style={{ fontSize: "8px", color: "#cbd5e1", margin: "1px 0 0" }}>© {new Date().getFullYear()} Sizzling Spices Ltd.</p>
          </div>
        </div>

      </div>
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const InfoLine = ({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: "green" | "orange" }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", marginBottom: "4px" }}>
    <span style={{ color: "#94a3b8", fontWeight: 500 }}>{label}</span>
    <span style={{
      fontWeight: bold ? 700 : 600,
      color: accent === "green" ? "#16a34a" : accent === "orange" ? "#ea580c" : "#1e293b",
      textAlign: "right",
      maxWidth: "60%",
    }}>{value}</span>
  </div>
);

const EarningsRow = ({ label, value, bold, muted, red }: { label: string; value: string; bold?: boolean; muted?: boolean; red?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
    <span style={{ color: muted ? "#cbd5e1" : "#475569" }}>{label}</span>
    <span style={{
      fontWeight: bold ? 700 : 500,
      color: red ? "#dc2626" : muted ? "#cbd5e1" : "#0f172a",
    }}>{value}</span>
  </div>
);

const SigLine = ({ label }: { label: string }) => (
  <div style={{ width: "100px" }}>
    <div style={{ height: "28px", borderBottom: "1px solid #cbd5e1", marginBottom: "3px" }} />
    <p style={{ fontSize: "8px", color: "#94a3b8", textAlign: "center", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 600, margin: 0 }}>{label}</p>
  </div>
);

export default PayslipTemplate;
