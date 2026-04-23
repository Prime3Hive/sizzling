import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import { type Invoice } from "@/types/invoices";

const COMPANY = {
  name: "Sizzling Spices",
  tagline: "Delectable finger foods, spices and more.",
  address: "No 4 Ogbu E.O Street, Off Abdurrahman Mora Street, Kado Estate, Nigeria",
  phone: "07011000453, 08127575751",
  email: "",
};

interface Props {
  invoice: Invoice;
}

export default function InvoicePrintView({ invoice }: Props) {
  const isEvent = invoice.invoice_type === "event";
  const docType = invoice.status === "quotation" ? "QUOTATION" : "INVOICE";
  const displayNumber = invoice.invoice_number ?? invoice.quotation_number;
  const items = invoice.items ?? [];
  const accentColor = isEvent ? "#7c3aed" : "#1d4ed8";

  const s: Record<string, React.CSSProperties> = {
    page:         { fontFamily: "Arial, sans-serif", color: "#111", fontSize: 13, lineHeight: 1.5, padding: 32 },
    header:       { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
    companyName:  { fontSize: 22, fontWeight: 700, color: "#b91c1c", marginBottom: 4 },
    companyInfo:  { fontSize: 12, color: "#555" },
    docType:      { fontSize: 26, fontWeight: 700, textAlign: "right" as const, letterSpacing: 2, color: accentColor },
    docNum:       { fontSize: 12, textAlign: "right" as const, color: "#555", marginTop: 4 },
    divider:      { borderTop: "2px solid #e5e7eb", margin: "16px 0" },
    thinDivider:  { borderTop: "1px solid #e5e7eb", margin: "12px 0" },
    sectionTitle: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1, color: "#888", marginBottom: 6 },
    metaGrid:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 32px", marginBottom: 20 },
    label:        { fontSize: 11, color: "#888", marginBottom: 2 },
    value:        { fontSize: 13, fontWeight: 600 },
    valueLight:   { fontSize: 13, color: "#333" },
    table:        { width: "100%", borderCollapse: "collapse" as const, marginBottom: 20 },
    th:           { background: "#f3f4f6", padding: "8px 10px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.5, color: "#555" },
    thRight:      { background: "#f3f4f6", padding: "8px 10px", textAlign: "right" as const, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.5, color: "#555" },
    td:           { padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 13, verticalAlign: "top" },
    tdRight:      { padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 13, textAlign: "right" as const, verticalAlign: "top" },
    totalsBox:    { marginLeft: "auto", width: 280, marginTop: 8 },
    totalsRow:    { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 },
    totalsTotal:  { display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 15, fontWeight: 700, borderTop: "2px solid #111", marginTop: 4 },
    foot:         { fontSize: 11, color: "#888", marginTop: 32, borderTop: "1px solid #e5e7eb", paddingTop: 12 },
    acctBox:      { border: `1px solid ${accentColor}30`, borderRadius: 6, padding: "12px 16px", background: `${accentColor}08`, marginTop: 16 },
    acctGrid:     { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 },
    waiterRow:    { background: "#f9fafb", borderTop: "1px dashed #d1d5db", borderBottom: "1px dashed #d1d5db" },
  };

  // Subtotal = invoice.subtotal which already includes waiter_total
  // Items-only subtotal for display purposes
  const itemsSubtotal = invoice.subtotal - (invoice.waiter_total ?? 0);

  return (
    <div style={s.page}>

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <div style={s.companyName}>{COMPANY.name}</div>
          <div style={{ ...s.companyInfo, fontStyle: "italic", marginBottom: 4 }}>{COMPANY.tagline}</div>
          <div style={s.companyInfo}>{COMPANY.address}</div>
          <div style={s.companyInfo}>{COMPANY.phone}</div>
        </div>
        <div>
          <div style={s.docType}>{docType}</div>
          <div style={s.docNum}># {displayNumber}</div>
          {invoice.invoice_number && invoice.status !== "quotation" && (
            <div style={{ ...s.docNum, color: "#aaa", marginTop: 2 }}>
              Quotation ref: {invoice.quotation_number}
            </div>
          )}
        </div>
      </div>

      <div style={s.divider} />

      {/* ── Bill to + Dates ── */}
      <div style={s.metaGrid}>
        {/* Bill To */}
        <div>
          <div style={s.sectionTitle}>Bill To</div>
          <div style={s.value}>{invoice.customer_name}</div>
          {invoice.customer_email   && <div style={s.valueLight}>{invoice.customer_email}</div>}
          {invoice.customer_phone   && <div style={s.valueLight}>{invoice.customer_phone}</div>}
          {invoice.customer_address && <div style={s.valueLight}>{invoice.customer_address}</div>}
        </div>

        {/* Dates */}
        <div>
          <div style={s.sectionTitle}>Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px" }}>
            <span style={s.label}>Issue Date</span>
            <span style={s.valueLight}>{format(new Date(invoice.issue_date), "dd MMM yyyy")}</span>
            {invoice.valid_until && (
              <>
                <span style={s.label}>Valid Until</span>
                <span style={s.valueLight}>{format(new Date(invoice.valid_until), "dd MMM yyyy")}</span>
              </>
            )}
            {invoice.converted_at && (
              <>
                <span style={s.label}>Invoice Date</span>
                <span style={s.valueLight}>{format(new Date(invoice.converted_at), "dd MMM yyyy")}</span>
              </>
            )}
            <span style={s.label}>Status</span>
            <span style={{ ...s.valueLight, fontWeight: 600, color: accentColor }}>
              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Event details (event only) ── */}
      {isEvent && (invoice.event_name || invoice.event_date || invoice.event_venue || invoice.number_of_guests) && (
        <>
          <div style={s.thinDivider} />
          <div style={{ marginBottom: 16 }}>
            <div style={s.sectionTitle}>Event Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 13 }}>
              {invoice.event_name && (
                <>
                  <span style={s.label}>Event</span>
                  <span style={s.valueLight}>{invoice.event_name}</span>
                </>
              )}
              {invoice.event_date && (
                <>
                  <span style={s.label}>Date</span>
                  <span style={s.valueLight}>{format(new Date(invoice.event_date), "dd MMMM yyyy")}</span>
                </>
              )}
              {invoice.event_venue && (
                <>
                  <span style={s.label}>Venue</span>
                  <span style={s.valueLight}>{invoice.event_venue}</span>
                </>
              )}
              {invoice.number_of_guests != null && (
                <>
                  <span style={s.label}>Guests</span>
                  <span style={s.valueLight}>{invoice.number_of_guests.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div style={s.divider} />

      {/* ── Line items ── */}
      <div style={s.sectionTitle}>
        {isEvent ? "Services & Packages" : "Products & Items"}
      </div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>#</th>
            <th style={s.th}>{isEvent ? "Package / Service" : "Description"}</th>
            <th style={s.thRight}>Qty</th>
            <th style={s.th}>Unit</th>
            <th style={s.thRight}>Unit Price</th>
            <th style={s.thRight}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const subLines = item.item_details
              ? item.item_details.split("\n").filter(Boolean)
              : [];
            return (
              <tr key={item.id ?? idx}>
                <td style={{ ...s.td, color: "#999", width: 24 }}>{idx + 1}</td>
                <td style={s.td}>
                  <div style={{ fontWeight: 600 }}>{item.description}</div>
                  {subLines.length > 0 && (
                    <ul style={{ marginTop: 4, paddingLeft: 0, listStyle: "none" }}>
                      {subLines.map((line, li) => (
                        <li key={li} style={{ fontSize: 11, color: "#666", display: "flex", gap: 6, marginTop: 2 }}>
                          <span style={{ color: accentColor, flexShrink: 0 }}>·</span>
                          <span>{line.replace(/^[-•·]\s*/, "")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td style={s.tdRight}>{item.quantity}</td>
                <td style={s.td}>{item.unit}</td>
                <td style={s.tdRight}>{formatNairaCompact(item.unit_price)}</td>
                <td style={{ ...s.tdRight, fontWeight: 600 }}>{formatNairaCompact(item.total_price)}</td>
              </tr>
            );
          })}

          {/* Waiter row (event only) */}
          {isEvent && invoice.waiter_required && invoice.waiter_total > 0 && (
            <tr style={s.waiterRow}>
              <td style={{ ...s.td, color: "#999" }}>—</td>
              <td style={s.td}>
                <div style={{ fontWeight: 600 }}>Waiter Service</div>
                {invoice.number_of_waiters != null && invoice.cost_per_waiter != null && (
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                    {invoice.number_of_waiters} waiter{invoice.number_of_waiters > 1 ? "s" : ""} ×{" "}
                    {formatNairaCompact(invoice.cost_per_waiter)} each
                  </div>
                )}
              </td>
              <td style={s.tdRight}>{invoice.number_of_waiters ?? ""}</td>
              <td style={s.td}>waiter</td>
              <td style={s.tdRight}>
                {invoice.cost_per_waiter != null ? formatNairaCompact(invoice.cost_per_waiter) : ""}
              </td>
              <td style={{ ...s.tdRight, fontWeight: 600 }}>{formatNairaCompact(invoice.waiter_total)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div style={s.totalsBox}>
        {(invoice.waiter_total ?? 0) > 0 && (
          <>
            <div style={s.totalsRow}>
              <span style={{ color: "#555" }}>Items subtotal</span>
              <span>{formatNairaCompact(itemsSubtotal)}</span>
            </div>
            <div style={s.totalsRow}>
              <span style={{ color: "#555" }}>Waiter service</span>
              <span>{formatNairaCompact(invoice.waiter_total)}</span>
            </div>
          </>
        )}
        {(invoice.waiter_total ?? 0) === 0 && (
          <div style={s.totalsRow}>
            <span style={{ color: "#555" }}>Subtotal</span>
            <span>{formatNairaCompact(invoice.subtotal)}</span>
          </div>
        )}
        {invoice.discount_amount > 0 && (
          <div style={{ ...s.totalsRow, color: "#dc2626" }}>
            <span>Discount ({invoice.discount_percent}%)</span>
            <span>− {formatNairaCompact(invoice.discount_amount)}</span>
          </div>
        )}
        {invoice.service_charge_amount > 0 && (
          <div style={s.totalsRow}>
            <span style={{ color: "#555" }}>Service Charge ({invoice.service_charge_percent}%)</span>
            <span>{formatNairaCompact(invoice.service_charge_amount)}</span>
          </div>
        )}
        {invoice.tax_amount > 0 && (
          <div style={s.totalsRow}>
            <span style={{ color: "#555" }}>Tax / VAT ({invoice.tax_percent}%)</span>
            <span>{formatNairaCompact(invoice.tax_amount)}</span>
          </div>
        )}
        <div style={s.totalsTotal}>
          <span>Total</span>
          <span style={{ color: accentColor }}>{formatNairaCompact(invoice.total_amount)}</span>
        </div>
        {invoice.amount_paid > 0 && (
          <>
            <div style={{ ...s.totalsRow, color: "#16a34a" }}>
              <span>Amount Paid</span>
              <span>{formatNairaCompact(invoice.amount_paid)}</span>
            </div>
            <div style={{ ...s.totalsRow, fontWeight: 700 }}>
              <span>Balance Due</span>
              <span>{formatNairaCompact(invoice.total_amount - invoice.amount_paid)}</span>
            </div>
          </>
        )}
      </div>

      {/* ── Account details ── */}
      {(invoice.bank_name || invoice.account_number || invoice.account_name) && (
        <>
          <div style={s.thinDivider} />
          <div style={s.sectionTitle}>Payment Account Details</div>
          <div style={s.acctBox}>
            <div style={s.acctGrid}>
              {invoice.bank_name && (
                <div>
                  <div style={s.label}>Bank</div>
                  <div style={s.value}>{invoice.bank_name}</div>
                </div>
              )}
              {invoice.account_number && (
                <div>
                  <div style={s.label}>Account Number</div>
                  <div style={{ ...s.value, fontFamily: "monospace", letterSpacing: 1 }}>
                    {invoice.account_number}
                  </div>
                </div>
              )}
              {invoice.account_name && (
                <div>
                  <div style={s.label}>Account Name</div>
                  <div style={s.value}>{invoice.account_name}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Notes & Terms ── */}
      {(invoice.notes || invoice.terms) && (
        <>
          <div style={s.thinDivider} />
          {invoice.notes && (
            <div style={{ marginBottom: 10 }}>
              <div style={s.sectionTitle}>Notes</div>
              <div style={{ fontSize: 12, color: "#555", whiteSpace: "pre-wrap" }}>{invoice.notes}</div>
            </div>
          )}
          {invoice.terms && (
            <div>
              <div style={s.sectionTitle}>Terms &amp; Conditions</div>
              <div style={{ fontSize: 12, color: "#555", whiteSpace: "pre-wrap" }}>{invoice.terms}</div>
            </div>
          )}
        </>
      )}

      {/* ── Footer ── */}
      <div style={s.foot}>
        <div style={{ textAlign: "center" }}>
          Thank you for your business! · {COMPANY.name} · {COMPANY.phone}
        </div>
      </div>
    </div>
  );
}
