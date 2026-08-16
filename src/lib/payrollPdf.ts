import type { jsPDF } from "jspdf";
import { format } from "date-fns";

/** Minimal shape needed to render a payroll register row. */
export interface PayrollPdfRecord {
  staff_id_number: string | null;
  staff_name: string;
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
  status: string;
}

// jsPDF's built-in Helvetica is WinAnsi-encoded and has no ₦ glyph, so the
// register uses "NGN" in headers and plain grouped numbers in cells.
const money = (n: number) =>
  Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface Col {
  key: keyof PayrollPdfRecord | "sn";
  header: string;
  width: number;
  align: "left" | "right";
}

const COLUMNS: Col[] = [
  { key: "sn", header: "S/N", width: 10, align: "left" },
  { key: "staff_id_number", header: "Staff ID", width: 24, align: "left" },
  { key: "staff_name", header: "Staff Name", width: 38, align: "left" },
  { key: "department", header: "Department", width: 30, align: "left" },
  { key: "period_start", header: "Period", width: 41, align: "left" },
  { key: "basic_salary", header: "Basic (NGN)", width: 28, align: "right" },
  { key: "allowances", header: "Allow. (NGN)", width: 22, align: "right" },
  { key: "deductions", header: "Deduct. (NGN)", width: 22, align: "right" },
  { key: "net_pay", header: "Net Pay (NGN)", width: 30, align: "right" },
  { key: "status", header: "Status", width: 18, align: "left" },
];

/** Truncate text to fit a column width at the given font size. */
function fit(doc: jsPDF, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(t + "…") > width) t = t.slice(0, -1);
  return t + "…";
}

export interface PayrollPdfOptions {
  /** Heading shown under the title, e.g. "All Staff" or a staff name. */
  scopeLabel?: string;
  /** Extra filter context, e.g. "Status: Paid · Period: monthly". */
  filterLabel?: string;
  fileName?: string;
}

/**
 * Render a payroll register (one row per record) to a paginated A4-landscape PDF
 * and trigger a download. Works for the full list or any filtered subset.
 */
export async function exportPayrollRegisterPdf(
  records: PayrollPdfRecord[],
  opts: PayrollPdfOptions = {},
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const tableW = COLUMNS.reduce((s, c) => s + c.width, 0);

  const totals = records.reduce(
    (acc, r) => {
      acc.basic += Number(r.basic_salary) || 0;
      acc.allow += Number(r.allowances) || 0;
      acc.deduct += Number(r.deductions) || 0;
      acc.net += Number(r.net_pay) || 0;
      return acc;
    },
    { basic: 0, allow: 0, deduct: 0, net: 0 },
  );

  const rowH = 7;
  const headerBottom = 34; // y where the table starts
  let pageNo = 0;

  const cellX = (idx: number) => {
    let x = marginX;
    for (let i = 0; i < idx; i++) x += COLUMNS[i].width;
    return x;
  };

  const drawPageHeader = () => {
    pageNo += 1;
    // Brand + title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(234, 88, 12); // orange-600
    doc.text("Sizzling Spices Ltd.", marginX, 14);

    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("PAYROLL REGISTER", marginX, 21);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const meta: string[] = [];
    if (opts.scopeLabel) meta.push(opts.scopeLabel);
    if (opts.filterLabel) meta.push(opts.filterLabel);
    meta.push(`${records.length} record${records.length === 1 ? "" : "s"}`);
    doc.text(meta.join("  ·  "), marginX, 26.5);

    // Right-aligned generated date
    doc.text(
      `Generated: ${format(new Date(), "dd MMM yyyy, HH:mm")}`,
      pageW - marginX,
      14,
      { align: "right" },
    );

    // Table header row
    doc.setFillColor(234, 88, 12);
    doc.rect(marginX, headerBottom - 5, tableW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    COLUMNS.forEach((c, i) => {
      const x = cellX(i);
      const tx = c.align === "right" ? x + c.width - 1.5 : x + 1.5;
      doc.text(c.header, tx, headerBottom - 0.5, { align: c.align });
    });
  };

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150, 163, 175);
    doc.text(
      "CONFIDENTIAL — Payroll information",
      marginX,
      pageH - 6,
    );
    doc.text(`Page ${pageNo}`, pageW - marginX, pageH - 6, { align: "right" });
  };

  drawPageHeader();
  let y = headerBottom + rowH;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  records.forEach((r, idx) => {
    // New page if the next row (or the totals row) would overflow
    if (y + rowH > pageH - 14) {
      drawFooter();
      doc.addPage();
      drawPageHeader();
      y = headerBottom + rowH;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
    }

    // Zebra striping
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y - 5, tableW, rowH, "F");
    }

    const period = `${format(new Date(r.period_start), "dd MMM")} – ${format(
      new Date(r.period_end),
      "dd MMM yyyy",
    )}`;

    const values: Record<string, string> = {
      sn: String(idx + 1),
      staff_id_number: r.staff_id_number || "—",
      staff_name: r.staff_name,
      department: r.department || "—",
      period_start: period,
      basic_salary: money(r.basic_salary),
      allowances: money(r.allowances),
      deductions: money(r.deductions),
      net_pay: money(r.net_pay),
      status: r.status === "paid" ? "Paid" : "Pending",
    };

    COLUMNS.forEach((c, i) => {
      const x = cellX(i);
      if (c.key === "net_pay") doc.setFont("helvetica", "bold");
      else doc.setFont("helvetica", "normal");

      if (c.key === "status") {
        doc.setTextColor(
          r.status === "paid" ? 22 : 217,
          r.status === "paid" ? 163 : 119,
          r.status === "paid" ? 74 : 6,
        );
      } else if (c.key === "deductions") {
        doc.setTextColor(220, 38, 38);
      } else if (c.key === "allowances") {
        doc.setTextColor(22, 163, 74);
      } else {
        doc.setTextColor(30, 41, 59);
      }

      const raw = values[c.key as string];
      const tx = c.align === "right" ? x + c.width - 1.5 : x + 1.5;
      doc.text(fit(doc, raw, c.width - 2.5), tx, y - 0.5, { align: c.align });
    });

    y += rowH;
  });

  // Totals row
  if (y + rowH > pageH - 14) {
    drawFooter();
    doc.addPage();
    drawPageHeader();
    y = headerBottom + rowH;
  }
  doc.setDrawColor(234, 88, 12);
  doc.setLineWidth(0.4);
  doc.line(marginX, y - 5, marginX + tableW, y - 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("TOTAL", cellX(2) + 1.5, y);
  doc.text(money(totals.basic), cellX(5) + COLUMNS[5].width - 1.5, y, { align: "right" });
  doc.setTextColor(22, 163, 74);
  doc.text(money(totals.allow), cellX(6) + COLUMNS[6].width - 1.5, y, { align: "right" });
  doc.setTextColor(220, 38, 38);
  doc.text(money(totals.deduct), cellX(7) + COLUMNS[7].width - 1.5, y, { align: "right" });
  doc.setTextColor(15, 23, 42);
  doc.text(money(totals.net), cellX(8) + COLUMNS[8].width - 1.5, y, { align: "right" });

  drawFooter();

  const name =
    opts.fileName ||
    `Payroll_Register_${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(name);
}
