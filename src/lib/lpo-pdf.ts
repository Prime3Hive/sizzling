import jsPDF from 'jspdf';
import { format } from 'date-fns';

export interface CompanyDetails {
  name: string;
  tagline: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  taxId: string;
}

// ── Brand colours (from Sizzling Spices logo) ────────────────────────────────
const OR  = { r: 255, g: 100, b:   0 } as const; // orange — primary brand
const DR  = { r: 185, g:  20, b:  20 } as const; // dark red — emphasis
const ALT = { r: 255, g: 248, b: 242 } as const; // very light orange tint
const GR1 = { r:  20, g:  20, b:  20 } as const; // near-black — body text
const GR2 = { r:  90, g:  90, b:  90 } as const; // medium gray — secondary
const GR3 = { r: 205, g: 205, b: 205 } as const; // light gray — cell borders
const WH  = { r: 255, g: 255, b: 255 } as const; // white

export const DEFAULT_COMPANY: CompanyDetails = {
  name:    'Sizzling Spices',
  tagline: 'Delectable finger foods, spices and more.',
  address: 'No 4 Ogbu E.O, Kado Estate, Abuja, Nigeria',
  city:    '',
  phone:   '07011000453 / 08127575751',
  email:   'sizzlingspicesng@gmail.com',
  taxId:   'RC-000000',
};

const STORAGE_KEY = 'lpo_company_details';

export const getStoredCompany = (): CompanyDetails => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_COMPANY, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_COMPANY };
};

export const saveCompanyDetails = (details: CompanyDetails): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(details));
};

// ── Logo loader ───────────────────────────────────────────────────────────────
async function loadLogo(): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = '/favicon.png';
  });
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function setFill(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setFillColor(c.r, c.g, c.b);
}
function setTxt(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setTextColor(c.r, c.g, c.b);
}
function setDraw(doc: jsPDF, c: { r: number; g: number; b: number }) {
  doc.setDrawColor(c.r, c.g, c.b);
}

// Section label — dark-red bold uppercase + thin orange underline
function sectionLabel(doc: jsPDF, y: number, label: string, lx: number, rx: number) {
  setTxt(doc, DR);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(label, lx, y);
  setDraw(doc, OR);
  doc.setLineWidth(0.35);
  doc.line(lx, y + 2, rx, y + 2);
  doc.setLineWidth(0.2);
}

// Shared header — used by both filled LPO and blank template
function drawHeader(
  doc: jsPDF, company: CompanyDetails, logoB64: string | null,
  W: number, M: number, subtitle: string,
) {
  const HDR = 34;

  setFill(doc, OR);
  doc.rect(0, 0, W, HDR, 'F');

  const LOGO_SZ = 20;
  const LOGO_X  = M;
  const LOGO_Y  = (HDR - LOGO_SZ) / 2;
  if (logoB64) {
    setFill(doc, WH);
    doc.circle(LOGO_X + LOGO_SZ / 2, LOGO_Y + LOGO_SZ / 2, LOGO_SZ / 2 + 1.2, 'F');
    doc.addImage(logoB64, 'PNG', LOGO_X, LOGO_Y, LOGO_SZ, LOGO_SZ);
  }

  const TX = logoB64 ? LOGO_X + LOGO_SZ + 5 : M;

  setTxt(doc, WH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('SIZZLING SPICES', TX, 12);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.text(company.tagline, TX, 18.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const addrLine = [company.address, company.city].filter(Boolean).join(', ');
  doc.text(addrLine, TX, 24.5);
  doc.text(`Tel: ${company.phone}   |   Email: ${company.email}`, TX, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('LOCAL PURCHASE ORDER', W - M, 12, { align: 'right' });

  const titleW = doc.getTextWidth('LOCAL PURCHASE ORDER');
  setDraw(doc, WH);
  doc.setLineWidth(0.4);
  doc.line(W - M - titleW, 13.5, W - M, 13.5);
  doc.setLineWidth(0.2);

  if (subtitle) {
    setTxt(doc, WH);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text(subtitle, W - M, 22, { align: 'right' });
  }

  setTxt(doc, WH);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(`Printed: ${format(new Date(), 'dd MMM yyyy, HH:mm')}`, W - M, 30, { align: 'right' });
}

// Shared footer
function drawFooter(doc: jsPDF, company: CompanyDetails, W: number, H: number) {
  const FY = H - 14;

  setDraw(doc, OR);
  doc.setLineWidth(0.7);
  doc.line(0, FY, W, FY);
  doc.setLineWidth(0.2);

  setTxt(doc, DR);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(company.name.toUpperCase(), W / 2, FY + 5.5, { align: 'center' });

  setTxt(doc, GR2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const parts = [company.tagline, company.email, company.phone].filter(Boolean);
  doc.text(parts.join('   ·   '), W / 2, FY + 11, { align: 'center' });
}

// ── Column definitions (shared; no Unicode currency symbols → use NGN) ────────
const TABLE_COLS = [
  { h: '#',           x: (M: number) => M,        w: 7,  right: false },
  { h: 'DESCRIPTION', x: (M: number) => M + 8,    w: 75, right: false },
  { h: 'QTY',         x: (M: number) => M + 83,   w: 18, right: true  },
  { h: 'UOM',         x: (M: number) => M + 101,  w: 18, right: false },
  { h: 'UNIT PRICE',  x: (M: number) => M + 119,  w: 34, right: true  },
  { h: 'AMOUNT',      x: (M: number) => M + 153,  w: 29, right: true  },
] as const;

// ── Filled LPO PDF ────────────────────────────────────────────────────────────
export async function generateLPOPDF(lpo: any, company: CompanyDetails): Promise<void> {
  const logoB64 = await loadLogo();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();
  const H   = doc.internal.pageSize.getHeight();
  const M   = 14;
  const CW  = W - M * 2; // 182 mm

  drawHeader(doc, company, logoB64, W, M, lpo.lpo_number);

  let y = 34 + 7; // below header + gap

  // ── Meta row ─────────────────────────────────────────────────────────────────
  const statusColours: Record<string, { r: number; g: number; b: number }> = {
    draft:              { r: 100, g: 100, b: 100 },
    sent:               { r:  30, g:  80, b: 200 },
    received:           { r:  20, g: 140, b:  60 },
    partially_received: { r: 190, g: 100, b:  10 },
    cancelled:          { r: 200, g:  30, b:  30 },
  };

  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y - 1, CW, 16, 1.5, 1.5, 'FD');

  const MID = M + CW / 2;
  doc.setLineWidth(0.2);
  doc.line(MID, y - 1, MID, y + 15); // centre divider

  const metaCells = [
    { label: 'ORDER DATE',        value: format(new Date(lpo.order_date), 'dd MMM yyyy'), x: M + 5,   color: GR1 },
    { label: 'EXPECTED DELIVERY', value: lpo.expected_delivery ? format(new Date(lpo.expected_delivery), 'dd MMM yyyy') : '—', x: MID + 5, color: GR1 },
  ];

  metaCells.forEach(cell => {
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(cell.label, cell.x, y + 4);
    setTxt(doc, cell.color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(cell.value, cell.x, y + 11);
  });

  // Status (right-aligned in right cell)
  const sc = statusColours[lpo.status as string] ?? statusColours.draft;
  setTxt(doc, GR2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('STATUS', W - M - 5, y + 4, { align: 'right' });
  setTxt(doc, sc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text((lpo.status as string).replace(/_/g, ' ').toUpperCase(), W - M - 5, y + 11, { align: 'right' });

  if (lpo.payment_method) {
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Payment: ${lpo.payment_method}`, MID + 5, y + 11);
  }

  y += 22;

  // ── Supplier ──────────────────────────────────────────────────────────────────
  sectionLabel(doc, y, 'SUPPLIER', M, W - M);
  y += 7;

  setTxt(doc, GR1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(lpo.supplier_name, M, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTxt(doc, GR2);
  let sy = y + 6;
  if (lpo.supplier_address) { doc.text(lpo.supplier_address, M, sy); sy += 5; }
  if (lpo.supplier_phone)   { doc.text(`Tel: ${lpo.supplier_phone}`, M, sy); sy += 5; }
  if (lpo.supplier_email)   { doc.text(`Email: ${lpo.supplier_email}`, M, sy); sy += 5; }

  y = Math.max(sy + 5, y + 26);

  // ── Items table ───────────────────────────────────────────────────────────────
  sectionLabel(doc, y, 'ITEMS', M, W - M);
  y += 5;

  const TC = TABLE_COLS.map(c => ({ ...c, x: c.x(M) }));

  // Header
  setFill(doc, OR);
  doc.rect(M, y, CW, 7, 'F');
  setTxt(doc, WH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  TC.forEach(c => {
    if (c.right) doc.text(c.h, c.x + c.w - 1,  y + 5, { align: 'right' });
    else         doc.text(c.h, c.x + 1.5,        y + 5);
  });
  y += 7;

  // Data rows
  const items: any[] = lpo.lpo_items ?? [];
  doc.setFontSize(8.5);

  items.forEach((item, i) => {
    const ROW_H = 8;
    if (i % 2 !== 0) {
      setFill(doc, ALT);
      doc.rect(M, y, CW, ROW_H, 'F');
    }
    setTxt(doc, GR1);
    doc.setFont('helvetica', 'normal');

    const label = item.description
      ? `${item.item_name} — ${item.description}`
      : item.item_name;

    doc.text(String(i + 1),                        TC[0].x + 1.5, y + 5.5);
    doc.text(String(label).substring(0, 50),        TC[1].x + 1.5, y + 5.5);
    doc.text(
      Number(item.quantity).toLocaleString(),
      TC[2].x + TC[2].w - 1, y + 5.5, { align: 'right' },
    );
    doc.text(String(item.unit_of_measure ?? 'unit'), TC[3].x + 1.5, y + 5.5);
    doc.text(
      Number(item.unit_price).toLocaleString('en-NG', { minimumFractionDigits: 2 }),
      TC[4].x + TC[4].w - 1, y + 5.5, { align: 'right' },
    );
    doc.text(
      Number(item.total_price).toLocaleString('en-NG', { minimumFractionDigits: 2 }),
      TC[5].x + TC[5].w - 1, y + 5.5, { align: 'right' },
    );
    y += ROW_H;
  });

  // Bottom border
  setDraw(doc, OR);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  doc.setLineWidth(0.2);
  y += 6;

  // ── Grand total ───────────────────────────────────────────────────────────────
  const totalFmt = Number(lpo.total_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  const totalStr = `NGN  ${totalFmt}`;
  const rightEdge = TC[5].x + TC[5].w - 1;

  setTxt(doc, GR2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('GRAND TOTAL', rightEdge - 45, y + 5.5, { align: 'right' });

  setTxt(doc, DR);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(totalStr, rightEdge, y + 6, { align: 'right' });

  const totalLineW = doc.getTextWidth(totalStr);
  setDraw(doc, DR);
  doc.setLineWidth(0.55);
  doc.line(rightEdge - totalLineW, y + 7.5, rightEdge, y + 7.5);
  doc.setLineWidth(0.2);

  y += 16;

  // ── Notes ─────────────────────────────────────────────────────────────────────
  if (lpo.notes) {
    sectionLabel(doc, y, 'NOTES & TERMS', M, W - M);
    y += 7;

    const noteLines = doc.splitTextToSize(String(lpo.notes), CW - 2);
    setTxt(doc, GR1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(noteLines, M, y);
    y += noteLines.length * 5 + 8;
  }

  // ── Signature blocks ──────────────────────────────────────────────────────────
  if (y > H - 80) y = H - 78;

  const sigW = (CW - 8) / 2;
  (['PREPARED / AUTHORIZED BY', 'RECEIVED / APPROVED BY'] as const).forEach((title, i) => {
    const bx = M + i * (sigW + 8);
    setFill(doc, OR);
    doc.rect(bx, y, sigW, 6, 'F');
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.rect(bx, y, sigW, 32, 'D');
    doc.setLineWidth(0.2);
    setTxt(doc, WH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(title, bx + sigW / 2, y + 4.2, { align: 'center' });
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Signature: _________________________', bx + 4, y + 15);
    doc.text('Name:       _________________________', bx + 4, y + 22);
    doc.text('Date:         _________________________', bx + 4, y + 29);
  });

  drawFooter(doc, company, W, H);
  doc.save(`${lpo.lpo_number}.pdf`);
}

// ── Blank / hand-written LPO template ────────────────────────────────────────
export async function generateBlankLPOPDF(company: CompanyDetails): Promise<void> {
  const logoB64 = await loadLogo();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();
  const H   = doc.internal.pageSize.getHeight();
  const M   = 14;
  const CW  = W - M * 2;

  drawHeader(doc, company, logoB64, W, M, 'BLANK TEMPLATE');

  let y = 34 + 7;

  // ── Meta grid (2 × 2 cells) ───────────────────────────────────────────────────
  const META_H = 30;
  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CW, META_H, 1.5, 1.5, 'FD');

  const MID_X = M + CW / 2;
  const MID_Y = y + META_H / 2;
  doc.setLineWidth(0.2);
  doc.line(MID_X, y,     MID_X, y + META_H); // vertical mid
  doc.line(M,     MID_Y, M + CW, MID_Y);      // horizontal mid

  const CELL_H = META_H / 2;
  const CELL_W = CW / 2;
  const metaFields = [
    { label: 'LPO NUMBER', cx: M,      cy: y },
    { label: 'ORDER DATE', cx: MID_X,  cy: y },
    { label: 'DELIVERY DATE', cx: M,   cy: MID_Y },
    { label: 'STATUS / PAYMENT METHOD', cx: MID_X, cy: MID_Y },
  ];

  metaFields.forEach(f => {
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(f.label, f.cx + 4, f.cy + 5);
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.line(f.cx + 4, f.cy + CELL_H - 4, f.cx + CELL_W - 4, f.cy + CELL_H - 4);
    doc.setLineWidth(0.2);
  });

  y += META_H + 7;

  // ── Supplier blank fields ─────────────────────────────────────────────────────
  sectionLabel(doc, y, 'SUPPLIER', M, W - M);
  y += 7;

  const fieldLine = (label: string, fx: number, fy: number, lw: number) => {
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label, fx, fy);
    setDraw(doc, GR3);
    doc.setLineWidth(0.35);
    doc.line(fx, fy + 5, fx + lw, fy + 5);
    doc.setLineWidth(0.2);
  };

  fieldLine('Company / Supplier Name:', M, y, CW);
  y += 11;
  fieldLine('Address:', M, y, CW);
  y += 11;

  const halfCW = (CW - 6) / 2;
  fieldLine('Tel:', M, y, halfCW);
  fieldLine('Email:', M + halfCW + 6, y, halfCW);
  y += 13;

  // ── Items table with 10 printable rows ───────────────────────────────────────
  sectionLabel(doc, y, 'ITEMS', M, W - M);
  y += 5;

  const ROWS   = 10;
  const ROW_H  = 9.2;
  const HDR_H  = 7;

  const TC = TABLE_COLS.map(c => ({ ...c, x: c.x(M) }));

  // Orange header
  setFill(doc, OR);
  doc.rect(M, y, CW, HDR_H, 'F');
  setTxt(doc, WH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  TC.forEach(c => {
    if (c.right) doc.text(c.h, c.x + c.w - 1,  y + 5, { align: 'right' });
    else         doc.text(c.h, c.x + 1.5,        y + 5);
  });

  const dataTop = y + HDR_H;
  const dataBot = dataTop + ROWS * ROW_H;

  // Horizontal row dividers
  setDraw(doc, GR3);
  doc.setLineWidth(0.2);
  for (let i = 1; i < ROWS; i++) {
    const ly = dataTop + i * ROW_H;
    doc.line(M, ly, W - M, ly);
  }

  // Vertical column dividers (through header and data)
  const divX = [TC[1].x, TC[2].x, TC[3].x, TC[4].x, TC[5].x];
  divX.forEach(cx => {
    doc.line(cx, y, cx, dataBot);
  });

  // Outer orange border
  setDraw(doc, OR);
  doc.setLineWidth(0.4);
  doc.rect(M, y, CW, HDR_H + ROWS * ROW_H, 'D');
  doc.setLineWidth(0.2);

  // Row numbers
  setTxt(doc, GR2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  for (let i = 0; i < ROWS; i++) {
    doc.text(String(i + 1), M + 1.5, dataTop + i * ROW_H + 6.2);
  }

  y = dataBot;

  // ── Total row ─────────────────────────────────────────────────────────────────
  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.3);
  doc.rect(M, y, CW, 11, 'FD');
  doc.setLineWidth(0.2);

  setTxt(doc, GR1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const totalLabelX = TC[5].x - 2;
  doc.text('GRAND TOTAL (NGN)', totalLabelX, y + 7.5, { align: 'right' });

  // Writing underline for amount
  setDraw(doc, GR1);
  doc.setLineWidth(0.4);
  doc.line(TC[5].x + 2, y + 7.5, TC[5].x + TC[5].w - 2, y + 7.5);
  doc.setLineWidth(0.2);

  y += 16;

  // ── Signature blocks ──────────────────────────────────────────────────────────
  if (y > H - 80) y = H - 78;

  const sigW = (CW - 8) / 2;
  (['PREPARED / AUTHORIZED BY', 'RECEIVED / APPROVED BY'] as const).forEach((title, i) => {
    const bx = M + i * (sigW + 8);
    setFill(doc, OR);
    doc.rect(bx, y, sigW, 6, 'F');
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.rect(bx, y, sigW, 32, 'D');
    doc.setLineWidth(0.2);
    setTxt(doc, WH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(title, bx + sigW / 2, y + 4.2, { align: 'center' });
    setTxt(doc, GR2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Signature: _________________________', bx + 4, y + 15);
    doc.text('Name:       _________________________', bx + 4, y + 22);
    doc.text('Date:         _________________________', bx + 4, y + 29);
  });

  drawFooter(doc, company, W, H);
  doc.save('LPO-Blank-Template.pdf');
}
