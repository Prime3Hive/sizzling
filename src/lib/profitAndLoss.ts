// Pure helpers for THE P&L (see src/hooks/useProfitAndLoss.ts).

/**
 * THE profit and loss. Every page that shows revenue, cost of sales, OpEx,
 * payroll, commission or net profit reads it from here, and this reads it from
 * one database function (fn_profit_and_loss) over the general ledger.
 * No page sums raw tables for profit any more.
 *
 * Every row — and the total — satisfies
 *   grossProfit − opex − payroll − commission = netProfit
 */
export interface PLRow {
  /** First day of the month, yyyy-MM-dd. */
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  payroll: number;
  commission: number;
  netProfit: number;
  /**
   * Where the revenue came from. On every row
   *   salesDaily + salesEvent + invoiceDaily + invoiceEvent + otherRevenue = revenue
   * because the database adds these same rounded parts to make `revenue`.
   */
  salesDaily: number;
  salesEvent: number;
  invoiceDaily: number;
  invoiceEvent: number;
  /** Income posted by anything other than a sale or an invoice (manual journals). */
  otherRevenue: number;
}

export type PLTotals = Omit<PLRow, 'month'>;

export const EMPTY_PL: PLTotals = {
  revenue: 0, cogs: 0, grossProfit: 0, opex: 0, payroll: 0, commission: 0, netProfit: 0,
  salesDaily: 0, salesEvent: 0, invoiceDaily: 0, invoiceEvent: 0, otherRevenue: 0,
};

const PL_KEYS = Object.keys(EMPTY_PL) as (keyof PLTotals)[];

// Money is summed in kobo so twelve months add up to the year exactly.
const kobo = (n: number) => Math.round(n * 100);

export function sumPL(rows: PLRow[]): PLTotals {
  const out = { ...EMPTY_PL };
  for (const k of PL_KEYS) {
    out[k] = rows.reduce((t, r) => t + kobo(r[k]), 0) / 100;
  }
  return out;
}

/** Total cost for a row: cost of sales + operating expenses + payroll + commission. */
export const totalCost = (r: Pick<PLRow, 'cogs' | 'opex' | 'payroll' | 'commission'>) =>
  (kobo(r.cogs) + kobo(r.opex) + kobo(r.payroll) + kobo(r.commission)) / 100;

export const toPLRow = (r: any): PLRow => {
  const revenue = Number(r.revenue ?? 0);
  // Before migration 20261123100000 the function returns no split; everything
  // is then reported as "other" so the parts still add up to the total.
  const hasSplit = r.sales_daily !== undefined;
  return {
    month: String(r.month),
    revenue,
    cogs: Number(r.cogs ?? 0),
    grossProfit: Number(r.gross_profit ?? 0),
    opex: Number(r.opex ?? 0),
    payroll: Number(r.payroll ?? 0),
    commission: Number(r.commission ?? 0),
    netProfit: Number(r.net_profit ?? 0),
    salesDaily: Number(r.sales_daily ?? 0),
    salesEvent: Number(r.sales_event ?? 0),
    invoiceDaily: Number(r.invoice_daily ?? 0),
    invoiceEvent: Number(r.invoice_event ?? 0),
    otherRevenue: hasSplit ? Number(r.other_revenue ?? 0) : revenue,
  };
};

/**
 * Month-on-month change for a tile. Returns null when a percentage would
 * mislead: nothing to compare against, or a negative base. Very large swings
 * are capped so a tile never reads "+4,812.3%".
 */
export function monthChange(now: number, before: number): { text: string; up: boolean } | null {
  if (!(before > 0) || now < 0) return null;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  if (Math.abs(pct) >= 300) {
    return { text: up ? `${(now / before).toFixed(1)}× last month` : 'far below last month', up };
  }
  return { text: `${up ? '+' : ''}${pct.toFixed(1)}% vs last month`, up };
}

/** Year-to-date range: 1 Jan to today. */
export function ytdRange(now = new Date()) {
  const y = now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-01-01`, to: `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` };
}

