import type { jsPDF } from 'jspdf';
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
const ALT = { r: 255, g: 246, b: 239 } as const; // very light orange tint
const GR1 = { r:  20, g:  20, b:  20 } as const; // near-black — body text
const GR2 = { r: 105, g: 105, b: 105 } as const; // medium gray — secondary
const GR3 = { r: 214, g: 214, b: 214 } as const; // light gray — cell borders
const GR4 = { r: 244, g: 244, b: 244 } as const; // subtle fill
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

// ── Page geometry ─────────────────────────────────────────────────────────────
const M       = 12;   // page margin
const HDR_H   = 30;   // full brand header (first page)
const CONT_H  = 16;   // slim continuation header
const FOOT_H  = 15;   // reserved footer band
const GAP     = 6;    // gap under any header

// ── Formatting helpers ────────────────────────────────────────────────────────
/**
 * jsPDF's built-in fonts are WinAnsi-encoded, so characters pasted in from Word
 * or a browser (curly quotes, en/em dashes, the naira sign) come out as garbage.
 * Every piece of user-entered text goes through here first.
 */
const clean = (v: unknown): string =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/₦/g, 'NGN ')
    .replace(/[•●·]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\n\x20-\xFF]/g, '');

const money = (n: unknown): string =>
  (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (n: unknown): string => {
  const v = Number(n) || 0;
  return Number.isInteger(v)
    ? v.toLocaleString('en-NG')
    : v.toLocaleString('en-NG', { maximumFractionDigits: 3 });
};

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function chunkToWords(n: number): string {
  let s = '';
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} hundred`;
    n %= 100;
    if (n) s += ' and ';
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    n %= 10;
    if (n) s += `-${ONES[n]}`;
  } else if (n > 0) {
    s += ONES[n];
  }
  return s;
}

function toWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < SCALES.length) {
    const c = n % 1000;
    if (c) parts.unshift(chunkToWords(c) + (SCALES[i] ? ` ${SCALES[i]}` : ''));
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(' ');
}

/** "Four hundred and fifty thousand naira, fifty kobo only" */
function amountInWords(amount: number): string {
  const v = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(v);
  const kobo  = Math.round((v - whole) * 100);
  let s = `${toWords(whole)} naira`;
  if (kobo > 0) s += `, ${toWords(kobo)} kobo`;
  s += ' only';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
type RGB = { r: number; g: number; b: number };
const setFill = (doc: jsPDF, c: RGB) => doc.setFillColor(c.r, c.g, c.b);
const setTxt  = (doc: jsPDF, c: RGB) => doc.setTextColor(c.r, c.g, c.b);
const setDraw = (doc: jsPDF, c: RGB) => doc.setDrawColor(c.r, c.g, c.b);

const font = (doc: jsPDF, style: 'normal' | 'bold' | 'italic', size: number) => {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
};

const STATUS_COLOURS: Record<string, RGB> = {
  draft:              { r: 110, g: 110, b: 110 },
  sent:               { r:  30, g:  80, b: 200 },
  received:           { r:  20, g: 140, b:  60 },
  partially_received: { r: 190, g: 100, b:  10 },
  cancelled:          { r: 200, g:  30, b:  30 },
};

// Section label — dark-red bold uppercase + thin orange underline
function sectionLabel(doc: jsPDF, y: number, label: string, lx: number, rx: number) {
  setTxt(doc, DR);
  font(doc, 'bold', 7.5);
  doc.text(label, lx, y);
  setDraw(doc, OR);
  doc.setLineWidth(0.35);
  doc.line(lx, y + 1.8, rx, y + 1.8);
  doc.setLineWidth(0.2);
}

// ── Table columns — widths sum to the 186 mm content width ────────────────────
interface Col { h: string; w: number; align: 'left' | 'right' | 'center' }
const COLS: Col[] = [
  { h: '#',           w:  9, align: 'center' },
  { h: 'DESCRIPTION', w: 74, align: 'left'   },
  { h: 'QTY',         w: 16, align: 'right'  },
  { h: 'UOM',         w: 17, align: 'left'   },
  { h: 'UNIT PRICE',  w: 33, align: 'right'  },
  { h: 'AMOUNT',      w: 37, align: 'right'  },
];
const PAD = 2;

/** Absolute x offsets for each column, plus helpers for text anchoring. */
function layoutCols(): Array<Col & { x: number; tx: number }> {
  let x = M;
  return COLS.map(c => {
    const col = {
      ...c,
      x,
      tx: c.align === 'right' ? x + c.w - PAD : c.align === 'center' ? x + c.w / 2 : x + PAD,
    };
    x += c.w;
    return col;
  });
}
const TC = layoutCols();
const DESC_W = COLS[1].w - PAD * 2;

// ── Rendering context with pagination ─────────────────────────────────────────
interface Ctx {
  doc: jsPDF;
  W: number;
  H: number;
  CW: number;
  company: CompanyDetails;
  logo: string | null;
  subtitle: string;
  y: number;
  /** When true a page break re-draws the items table head. */
  inTable: boolean;
}

const bottomLimit = (ctx: Ctx) => ctx.H - FOOT_H - 4;

function drawBrandHeader(ctx: Ctx) {
  const { doc, W, company, logo, subtitle } = ctx;

  setFill(doc, OR);
  doc.rect(0, 0, W, HDR_H, 'F');

  const LOGO_SZ = 18;
  const LOGO_Y  = (HDR_H - LOGO_SZ) / 2;
  if (logo) {
    setFill(doc, WH);
    doc.circle(M + LOGO_SZ / 2, LOGO_Y + LOGO_SZ / 2, LOGO_SZ / 2 + 1.1, 'F');
    doc.addImage(logo, 'PNG', M, LOGO_Y, LOGO_SZ, LOGO_SZ);
  }
  const TX = logo ? M + LOGO_SZ + 5 : M;

  const headW = W - M - TX - 68; // leave room for the title block on the right

  setTxt(doc, WH);
  font(doc, 'bold', 15);
  doc.text(clean(company.name).toUpperCase(), TX, 11);

  font(doc, 'italic', 6.8);
  doc.text(doc.splitTextToSize(clean(company.tagline), headW)[0], TX, 15.8);

  font(doc, 'normal', 6.6);
  const addrLine = clean([company.address, company.city].filter(Boolean).join(', '));
  doc.text(doc.splitTextToSize(addrLine, headW)[0], TX, 21);
  doc.text(
    doc.splitTextToSize(clean(`Tel: ${company.phone}   |   ${company.email}`), headW)[0],
    TX, 25.6,
  );

  // Title + number pill on the right
  font(doc, 'bold', 12.5);
  doc.text('LOCAL PURCHASE ORDER', W - M, 11.5, { align: 'right' });
  const titleW = doc.getTextWidth('LOCAL PURCHASE ORDER');
  setDraw(doc, WH);
  doc.setLineWidth(0.4);
  doc.line(W - M - titleW, 13.2, W - M, 13.2);
  doc.setLineWidth(0.2);

  if (subtitle) {
    font(doc, 'bold', 9);
    const pw = doc.getTextWidth(subtitle) + 9;
    setFill(doc, WH);
    doc.roundedRect(W - M - pw, 16, pw, 7, 1.4, 1.4, 'F');
    setTxt(doc, OR);
    doc.text(subtitle, W - M - pw / 2, 20.8, { align: 'center' });
  }

  setTxt(doc, WH);
  font(doc, 'normal', 6.2);
  doc.text(`Printed ${format(new Date(), 'dd MMM yyyy, HH:mm')}`, W - M, 27.4, { align: 'right' });
}

function drawContinuationHeader(ctx: Ctx) {
  const { doc, W, company, subtitle } = ctx;

  setFill(doc, OR);
  doc.rect(0, 0, W, CONT_H, 'F');

  setTxt(doc, WH);
  font(doc, 'bold', 9.5);
  doc.text(clean(company.name).toUpperCase(), M, 10.4);

  font(doc, 'normal', 8);
  const right = subtitle ? `LOCAL PURCHASE ORDER · ${subtitle} (continued)` : 'LOCAL PURCHASE ORDER (continued)';
  doc.text(right, W - M, 10.4, { align: 'right' });
}

/** Footers are painted after all content so "page x of y" is accurate. */
function paintFooters(ctx: Ctx) {
  const { doc, W, H, company } = ctx;
  const total = doc.getNumberOfPages();
  const FY = H - FOOT_H;

  for (let p = 1; p <= total; p++) {
    doc.setPage(p);

    setDraw(doc, OR);
    doc.setLineWidth(0.7);
    doc.line(0, FY, W, FY);
    doc.setLineWidth(0.2);

    setTxt(doc, DR);
    font(doc, 'bold', 7.5);
    doc.text(clean(company.name).toUpperCase(), M, FY + 5.5);

    font(doc, 'bold', 7);
    setTxt(doc, GR1);
    doc.text(`Page ${p} of ${total}`, W - M, FY + 5.5, { align: 'right' });

    setTxt(doc, GR2);
    font(doc, 'normal', 6.3);
    const contact = [company.email, company.phone].filter(Boolean).map(clean).join('  ·  ');
    doc.text(doc.splitTextToSize(contact, W - M * 2 - 46)[0], M, FY + 10);
    doc.text('Computer-generated document', W - M, FY + 10, { align: 'right' });
  }
  doc.setPage(total);
}

function drawTableHead(ctx: Ctx) {
  const { doc, CW } = ctx;
  setFill(doc, OR);
  doc.rect(M, ctx.y, CW, 7.5, 'F');
  setTxt(doc, WH);
  font(doc, 'bold', 6.8);
  TC.forEach(c => {
    doc.text(c.h, c.tx, ctx.y + 5, c.align === 'left' ? undefined : { align: c.align });
  });
  ctx.y += 7.5;
}

/** Start a new page; redraws the slim header and (optionally) the table head. */
function newPage(ctx: Ctx) {
  ctx.doc.addPage();
  drawContinuationHeader(ctx);
  ctx.y = CONT_H + GAP;
  if (ctx.inTable) drawTableHead(ctx);
}

/** Ensure `need` mm of vertical space remains, breaking the page if not. */
function ensure(ctx: Ctx, need: number) {
  if (ctx.y + need > bottomLimit(ctx)) newPage(ctx);
}

// ── Reusable blocks ───────────────────────────────────────────────────────────

/** Bordered box with an orange-tinted caption strip. Returns the content top y. */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, caption: string): number {
  const { doc } = ctx;
  setFill(doc, ALT);
  doc.rect(x, y, w, 6, 'F');
  setDraw(doc, GR3);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'D');
  doc.line(x, y + 6, x + w, y + 6);
  doc.setLineWidth(0.2);
  setTxt(doc, DR);
  font(doc, 'bold', 6.5);
  doc.text(caption, x + 3, y + 4.2);
  return y + 6;
}

function drawMetaStrip(ctx: Ctx, cells: Array<{ label: string; value: string; pill?: RGB }>) {
  const { doc, CW } = ctx;
  const H_ = 15;
  const cw = CW / cells.length;

  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, ctx.y, CW, H_, 1.5, 1.5, 'FD');

  setDraw(doc, GR3);
  doc.setLineWidth(0.2);
  cells.forEach((_, i) => {
    if (i > 0) doc.line(M + i * cw, ctx.y + 2, M + i * cw, ctx.y + H_ - 2);
  });

  cells.forEach((cell, i) => {
    const cx = M + i * cw + 4;
    setTxt(doc, GR2);
    font(doc, 'normal', 6.2);
    doc.text(cell.label, cx, ctx.y + 5.5);

    if (cell.pill) {
      font(doc, 'bold', 7.2);
      const pw = doc.getTextWidth(cell.value) + 7;
      setFill(doc, cell.pill);
      doc.roundedRect(cx, ctx.y + 7.6, pw, 5.4, 1.2, 1.2, 'F');
      setTxt(doc, WH);
      doc.text(cell.value, cx + pw / 2, ctx.y + 11.4, { align: 'center' });
    } else {
      setTxt(doc, GR1);
      font(doc, 'bold', 8.5);
      doc.text(cell.value, cx, ctx.y + 11.5);
    }
  });

  ctx.y += H_ + 6;
}

/** Side-by-side supplier / deliver-to panels sized to their content. */
function drawParties(ctx: Ctx, lpo: any) {
  const { doc, CW, company } = ctx;
  const boxW = (CW - 6) / 2;
  const innerW = boxW - 6;

  // Supplier rows are always present — a half-filled record must still print as
  // a complete form rather than an empty box.
  const supplierLines: string[] = lpo.supplier_address
    ? (doc.splitTextToSize(clean(lpo.supplier_address), innerW) as string[])
    : ['Address: —'];
  supplierLines.push(`Tel: ${clean(lpo.supplier_phone) || '—'}`);
  supplierLines.push(`Email: ${clean(lpo.supplier_email) || '—'}`);

  const buyerLines: string[] = [];
  const addr = clean([company.address, company.city].filter(Boolean).join(', '));
  if (addr) buyerLines.push(...doc.splitTextToSize(addr, innerW));
  if (company.phone) buyerLines.push(clean(`Tel: ${company.phone}`));
  if (company.email) buyerLines.push(clean(`Email: ${company.email}`));
  if (company.taxId) buyerLines.push(clean(`RC / TIN: ${company.taxId}`));

  // Long trading names wrap onto a second line rather than being cut off.
  font(doc, 'bold', 9.5);
  const titleLines = (v: string) => {
    const all = doc.splitTextToSize(v, innerW) as string[];
    return all.length > 2 ? [all[0], `${all[1].replace(/\s+\S*$/, '')}...`] : all;
  };

  const blocks = [
    { caption: 'SUPPLIER',   title: titleLines(clean(lpo.supplier_name) || '—'), lines: supplierLines },
    { caption: 'DELIVER TO', title: titleLines(clean(company.name)),             lines: buyerLines    },
  ];

  // Both panels share a baseline grid so their addresses line up.
  const titleRows = Math.max(...blocks.map(b => b.title.length));
  const bodyH = (b: typeof blocks[number]) => 6 + titleRows * 5 + 1 + b.lines.length * 4.2 + 3;
  const boxH = Math.max(...blocks.map(bodyH), 28);

  ensure(ctx, boxH + 6);

  blocks.forEach((b, i) => {
    const bx = M + i * (boxW + 6);
    const top = panel(ctx, bx, ctx.y, boxW, boxH, b.caption);

    setTxt(doc, GR1);
    font(doc, 'bold', 9.5);
    b.title.forEach((ln, li) => doc.text(ln, bx + 3, top + 5.5 + li * 5));

    setTxt(doc, GR2);
    font(doc, 'normal', 7.4);
    const bodyTop = top + 5.5 + (titleRows - 1) * 5 + 5.4;
    b.lines.forEach((ln, li) => doc.text(ln, bx + 3, bodyTop + li * 4.2));
  });

  ctx.y += boxH + 6;
}

/** Optional order-detail chips (payment method, cost centre, category, account). */
function drawOrderDetails(ctx: Ctx, lpo: any) {
  const { doc, CW } = ctx;
  const fields = [
    { label: 'PAYMENT METHOD',   value: lpo.payment_method },
    { label: 'COST CENTRE',      value: lpo.cost_center },
    { label: 'EXPENSE CATEGORY', value: lpo.expense_category },
    { label: 'ACCOUNT TYPE',     value: lpo.account_type },
  ].filter(f => f.value);
  if (!fields.length) return;

  const H_ = 13;
  ensure(ctx, H_ + 6);

  setFill(doc, GR4);
  setDraw(doc, GR3);
  doc.setLineWidth(0.25);
  doc.rect(M, ctx.y, CW, H_, 'FD');
  doc.setLineWidth(0.2);

  const cw = CW / fields.length;
  fields.forEach((f, i) => {
    const cx = M + i * cw + 4;
    if (i > 0) {
      setDraw(doc, GR3);
      doc.line(M + i * cw, ctx.y + 2, M + i * cw, ctx.y + H_ - 2);
    }
    setTxt(doc, GR2);
    font(doc, 'normal', 5.9);
    doc.text(f.label, cx, ctx.y + 5);
    setTxt(doc, GR1);
    font(doc, 'bold', 7.6);
    doc.text(doc.splitTextToSize(clean(f.value), cw - 8)[0], cx, ctx.y + 10);
  });

  ctx.y += H_ + 6;
}

/** Items table with wrapped descriptions and automatic page breaks. */
function drawItems(ctx: Ctx, items: any[]) {
  const { doc, CW, W } = ctx;

  ensure(ctx, 26);
  sectionLabel(ctx.doc, ctx.y, 'ITEMS', M, W - M);
  ctx.y += 4.5;

  ctx.inTable = true;
  drawTableHead(ctx);

  const rowTopStart = ctx.y;
  let bandStart = rowTopStart;

  const closeBand = () => {
    // Column rules for the band drawn on the current page
    setDraw(doc, GR3);
    doc.setLineWidth(0.2);
    TC.slice(1).forEach(c => doc.line(c.x, bandStart - 7.5, c.x, ctx.y));
    setDraw(doc, OR);
    doc.setLineWidth(0.5);
    doc.line(M, ctx.y, W - M, ctx.y);
    doc.setLineWidth(0.2);
  };

  items.forEach((item, i) => {
    const name = clean(item.item_name).trim() || '—';
    const nameLines = (doc.splitTextToSize(name, DESC_W) as string[]).slice(0, 3);
    const descLines = item.description
      ? (doc.splitTextToSize(clean(item.description), DESC_W) as string[]).slice(0, 3)
      : [];
    const rowH = Math.max(
      7.4,
      2.0 + nameLines.length * 4.0 + (descLines.length ? descLines.length * 3.4 + 0.6 : 0) + 1.8,
    );

    if (ctx.y + rowH > bottomLimit(ctx)) {
      closeBand();
      newPage(ctx);
      bandStart = ctx.y;
    }

    if (i % 2 !== 0) {
      setFill(doc, ALT);
      doc.rect(M, ctx.y, CW, rowH, 'F');
    }

    const baseY = ctx.y + 5.1;

    setTxt(doc, GR2);
    font(doc, 'normal', 7.5);
    doc.text(String(i + 1), TC[0].tx, baseY, { align: 'center' });

    setTxt(doc, GR1);
    font(doc, 'normal', 8.2);
    nameLines.forEach((ln, li) => doc.text(ln, TC[1].tx, baseY + li * 4.0));

    if (descLines.length) {
      setTxt(doc, GR2);
      font(doc, 'normal', 6.6);
      const dTop = baseY + nameLines.length * 4.0 + 0.3;
      descLines.forEach((ln, li) => doc.text(ln, TC[1].tx, dTop + li * 3.4));
    }

    setTxt(doc, GR1);
    font(doc, 'normal', 8.2);
    doc.text(qty(item.quantity), TC[2].tx, baseY, { align: 'right' });

    setTxt(doc, GR2);
    font(doc, 'normal', 7.6);
    doc.text(clean(item.unit_of_measure || 'unit').substring(0, 8), TC[3].tx, baseY);

    setTxt(doc, GR1);
    font(doc, 'normal', 8.2);
    doc.text(money(item.unit_price), TC[4].tx, baseY, { align: 'right' });
    font(doc, 'bold', 8.2);
    doc.text(
      money(item.total_price ?? (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)),
      TC[5].tx, baseY, { align: 'right' },
    );

    // Hairline between rows
    if (i < items.length - 1) {
      setDraw(doc, GR3);
      doc.setLineWidth(0.15);
      doc.line(M, ctx.y + rowH, W - M, ctx.y + rowH);
      doc.setLineWidth(0.2);
    }

    ctx.y += rowH;
  });

  if (!items.length) {
    setTxt(doc, GR2);
    font(doc, 'italic', 8);
    doc.text('No items on this order.', M + PAD, ctx.y + 6);
    ctx.y += 10;
  }

  closeBand();
  ctx.inTable = false;
  ctx.y += 6;
}

/** Totals panel (right) + amount in words (left). */
function drawTotals(ctx: Ctx, items: any[], total: number) {
  const { doc, W } = ctx;
  const PANEL_W = 78;
  const px = W - M - PANEL_W;
  const wordsW = px - M - 6;

  const words = doc.splitTextToSize(amountInWords(total), wordsW) as string[];
  const panelH = 9 + 9 + 11;
  const blockH = Math.max(panelH, 14 + words.length * 4);

  ensure(ctx, blockH + 6);
  const top = ctx.y;

  // Amount in words
  setTxt(doc, GR2);
  font(doc, 'normal', 6.4);
  doc.text('AMOUNT IN WORDS', M, top + 4);
  setTxt(doc, GR1);
  font(doc, 'italic', 8);
  words.forEach((ln, i) => doc.text(ln, M, top + 9.5 + i * 4));

  // Summary rows
  const rows: Array<[string, string]> = [
    ['Total items', String(items.length)],
    ['Subtotal (NGN)', money(total)],
  ];
  let ry = top;
  rows.forEach(([label, value]) => {
    setDraw(doc, GR3);
    doc.setLineWidth(0.25);
    doc.line(px, ry, px + PANEL_W, ry);
    setTxt(doc, GR2);
    font(doc, 'normal', 7.4);
    doc.text(label, px + 3, ry + 6);
    setTxt(doc, GR1);
    font(doc, 'bold', 8);
    doc.text(value, px + PANEL_W - 3, ry + 6, { align: 'right' });
    ry += 9;
  });

  // Grand total band
  setFill(doc, OR);
  doc.rect(px, ry, PANEL_W, 11, 'F');
  setTxt(doc, WH);
  font(doc, 'bold', 7.4);
  doc.text('GRAND TOTAL', px + 3, ry + 7);
  font(doc, 'bold', 11);
  doc.text(`NGN ${money(total)}`, px + PANEL_W - 3, ry + 7.2, { align: 'right' });

  ctx.y = top + blockH + 6;
}

function drawNotes(ctx: Ctx, notes: string) {
  const { doc, CW } = ctx;
  const lines = doc.splitTextToSize(clean(notes), CW - 8) as string[];

  // Long terms are split across pages rather than running off the sheet.
  let i = 0;
  while (i < lines.length) {
    const avail = bottomLimit(ctx) - ctx.y - 16;
    if (avail < 8) { newPage(ctx); continue; }

    const slice = lines.slice(i, i + Math.max(1, Math.floor(avail / 4.2)));
    const boxH = 6 + slice.length * 4.2 + 4;
    const top = panel(ctx, M, ctx.y, CW, boxH, i === 0 ? 'NOTES & TERMS' : 'NOTES & TERMS (CONTINUED)');

    setTxt(doc, GR1);
    font(doc, 'normal', 8);
    slice.forEach((ln, li) => doc.text(ln, M + 4, top + 5 + li * 4.2));

    ctx.y += boxH + 6;
    i += slice.length;
  }
}

function drawSignatures(ctx: Ctx) {
  const { doc, CW } = ctx;
  const BOX_H = 30;

  // Follows the content, but never floats mid-page: once it would run past the
  // footer it drops to a new page, and it is pinned down when content runs long.
  const limit = ctx.H - FOOT_H - 2;
  if (ctx.y + BOX_H > limit) newPage(ctx);
  ctx.y = Math.min(ctx.y + 2, limit - BOX_H);

  const sigW = (CW - 6) / 2;
  (['PREPARED / AUTHORIZED BY', 'RECEIVED / APPROVED BY'] as const).forEach((title, i) => {
    const bx = M + i * (sigW + 6);

    setFill(doc, OR);
    doc.rect(bx, ctx.y, sigW, 6, 'F');
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.rect(bx, ctx.y, sigW, BOX_H, 'D');
    doc.setLineWidth(0.2);

    setTxt(doc, WH);
    font(doc, 'bold', 6.2);
    doc.text(title, bx + sigW / 2, ctx.y + 4.2, { align: 'center' });

    const labels = ['Signature', 'Name', 'Date'];
    labels.forEach((label, li) => {
      const ly = ctx.y + 13 + li * 7;
      setTxt(doc, GR2);
      font(doc, 'normal', 7);
      doc.text(`${label}:`, bx + 4, ly);
      setDraw(doc, GR3);
      doc.setLineWidth(0.3);
      doc.line(bx + 20, ly + 0.8, bx + sigW - 4, ly + 0.8);
      doc.setLineWidth(0.2);
    });
  });

  ctx.y += BOX_H + 4;
}

async function createCtx(company: CompanyDetails, subtitle: string): Promise<Ctx> {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogo()]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ctx: Ctx = { doc, W, H, CW: W - M * 2, company, logo, subtitle: clean(subtitle), y: 0, inTable: false };
  drawBrandHeader(ctx);
  ctx.y = HDR_H + GAP;
  return ctx;
}

// ── Filled LPO PDF ────────────────────────────────────────────────────────────
export async function generateLPOPDF(lpo: any, company: CompanyDetails): Promise<void> {
  const ctx = await createCtx(company, lpo.lpo_number ?? '');
  const items: any[] = lpo.lpo_items ?? [];

  const status = String(lpo.status ?? 'draft');
  drawMetaStrip(ctx, [
    { label: 'ORDER DATE', value: lpo.order_date ? format(new Date(lpo.order_date), 'dd MMM yyyy') : '—' },
    {
      label: 'EXPECTED DELIVERY',
      value: lpo.expected_delivery ? format(new Date(lpo.expected_delivery), 'dd MMM yyyy') : '—',
    },
    {
      label: 'STATUS',
      value: status.replace(/_/g, ' ').toUpperCase(),
      pill: STATUS_COLOURS[status] ?? STATUS_COLOURS.draft,
    },
  ]);

  drawParties(ctx, lpo);
  drawOrderDetails(ctx, lpo);
  drawItems(ctx, items);

  const total = Number(lpo.total_amount)
    || items.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
  drawTotals(ctx, items, total);

  if (lpo.notes) drawNotes(ctx, String(lpo.notes));
  drawSignatures(ctx);

  paintFooters(ctx);
  ctx.doc.save(`${lpo.lpo_number ?? 'LPO'}.pdf`);
}

// ── Blank / hand-written LPO template ────────────────────────────────────────
export async function generateBlankLPOPDF(company: CompanyDetails): Promise<void> {
  const ctx = await createCtx(company, 'BLANK TEMPLATE');
  const { doc, W, CW } = ctx;

  // ── Meta grid (2 × 2 cells) ─────────────────────────────────────────────────
  const META_H = 26;
  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, ctx.y, CW, META_H, 1.5, 1.5, 'FD');

  const MID_X = M + CW / 2;
  const MID_Y = ctx.y + META_H / 2;
  setDraw(doc, GR3);
  doc.setLineWidth(0.2);
  doc.line(MID_X, ctx.y, MID_X, ctx.y + META_H);
  doc.line(M, MID_Y, M + CW, MID_Y);

  const CELL_H = META_H / 2;
  const CELL_W = CW / 2;
  ([
    { label: 'LPO NUMBER',     cx: M,     cy: ctx.y },
    { label: 'ORDER DATE',     cx: MID_X, cy: ctx.y },
    { label: 'DELIVERY DATE',  cx: M,     cy: MID_Y },
    { label: 'PAYMENT METHOD', cx: MID_X, cy: MID_Y },
  ] as const).forEach(f => {
    setTxt(doc, GR2);
    font(doc, 'normal', 6.2);
    doc.text(f.label, f.cx + 4, f.cy + 5);
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.line(f.cx + 4, f.cy + CELL_H - 3.5, f.cx + CELL_W - 4, f.cy + CELL_H - 3.5);
    doc.setLineWidth(0.2);
  });

  ctx.y += META_H + 6;

  // ── Supplier / deliver-to ───────────────────────────────────────────────────
  const boxW = (CW - 6) / 2;
  const BOX_H = 30;

  const supTop = panel(ctx, M, ctx.y, boxW, BOX_H, 'SUPPLIER');
  ([['Name', 0], ['Address', 1], ['Tel / Email', 2]] as const).forEach(([label, i]) => {
    const ly = supTop + 6.5 + i * 7;
    setTxt(doc, GR2);
    font(doc, 'normal', 6.8);
    doc.text(`${label}:`, M + 3, ly);
    setDraw(doc, GR3);
    doc.setLineWidth(0.3);
    doc.line(M + 22, ly + 0.8, M + boxW - 3, ly + 0.8);
    doc.setLineWidth(0.2);
  });

  const bx = M + boxW + 6;
  const buyTop = panel(ctx, bx, ctx.y, boxW, BOX_H, 'DELIVER TO');
  setTxt(doc, GR1);
  font(doc, 'bold', 9.5);
  doc.text(doc.splitTextToSize(clean(company.name), boxW - 6)[0], bx + 3, buyTop + 5.5);
  setTxt(doc, GR2);
  font(doc, 'normal', 7.4);
  const buyerLines = [
    ...(doc.splitTextToSize(clean([company.address, company.city].filter(Boolean).join(', ')), boxW - 6) as string[]),
    clean(`Tel: ${company.phone}`),
    clean(`Email: ${company.email}`),
  ];
  buyerLines.forEach((ln, i) => doc.text(ln, bx + 3, buyTop + 10.8 + i * 4.2));

  ctx.y += BOX_H + 6;

  // ── Items grid ──────────────────────────────────────────────────────────────
  sectionLabel(doc, ctx.y, 'ITEMS', M, W - M);
  ctx.y += 4.5;

  const gridTop = ctx.y;
  ctx.inTable = true;
  drawTableHead(ctx);
  ctx.inTable = false;

  const dataTop = ctx.y;
  const ROW_H = 9;
  const ROWS = Math.max(6, Math.floor((ctx.H - FOOT_H - 4 - 52 - dataTop) / ROW_H));
  const dataBot = dataTop + ROWS * ROW_H;

  setDraw(doc, GR3);
  doc.setLineWidth(0.2);
  for (let i = 1; i < ROWS; i++) doc.line(M, dataTop + i * ROW_H, W - M, dataTop + i * ROW_H);
  TC.slice(1).forEach(c => doc.line(c.x, gridTop, c.x, dataBot));

  setDraw(doc, OR);
  doc.setLineWidth(0.4);
  doc.rect(M, gridTop, CW, dataBot - gridTop, 'D');
  doc.setLineWidth(0.2);

  setTxt(doc, GR2);
  font(doc, 'normal', 7.5);
  for (let i = 0; i < ROWS; i++) {
    doc.text(String(i + 1), TC[0].tx, dataTop + i * ROW_H + 6, { align: 'center' });
  }

  ctx.y = dataBot;

  // ── Total row ───────────────────────────────────────────────────────────────
  setFill(doc, ALT);
  setDraw(doc, OR);
  doc.setLineWidth(0.35);
  doc.rect(M, ctx.y, CW, 11, 'FD');
  doc.setLineWidth(0.2);

  setTxt(doc, GR1);
  font(doc, 'bold', 8);
  doc.text('GRAND TOTAL (NGN)', TC[5].x - 3, ctx.y + 7, { align: 'right' });
  setDraw(doc, GR1);
  doc.setLineWidth(0.4);
  doc.line(TC[5].x + 2, ctx.y + 7.5, TC[5].x + TC[5].w - 2, ctx.y + 7.5);
  doc.setLineWidth(0.2);

  ctx.y += 11 + 8;

  drawSignatures(ctx);
  paintFooters(ctx);
  doc.save('LPO-Blank-Template.pdf');
}
