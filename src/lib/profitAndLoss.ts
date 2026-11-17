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
}

export const EMPTY_PL: Omit<PLRow, 'month'> = {
  revenue: 0, cogs: 0, grossProfit: 0, opex: 0, payroll: 0, commission: 0, netProfit: 0,
};

export function sumPL(rows: PLRow[]): Omit<PLRow, 'month'> {
  return rows.reduce((t, r) => ({
    revenue: t.revenue + r.revenue,
    cogs: t.cogs + r.cogs,
    grossProfit: t.grossProfit + r.grossProfit,
    opex: t.opex + r.opex,
    payroll: t.payroll + r.payroll,
    commission: t.commission + r.commission,
    netProfit: t.netProfit + r.netProfit,
  }), { ...EMPTY_PL });
}

export const toPLRow = (r: any): PLRow => ({
  month: String(r.month),
  revenue: Number(r.revenue ?? 0),
  cogs: Number(r.cogs ?? 0),
  grossProfit: Number(r.gross_profit ?? 0),
  opex: Number(r.opex ?? 0),
  payroll: Number(r.payroll ?? 0),
  commission: Number(r.commission ?? 0),
  netProfit: Number(r.net_profit ?? 0),
});

/** Year-to-date range: 1 Jan to today. */
export function ytdRange(now = new Date()) {
  const y = now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-01-01`, to: `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` };
}

