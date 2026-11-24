// Costing and reports (inventory redesign, stage 4). Pure working-out for the
// Reports screen; the figures come from the database functions in
// 20261124400000_stock_reports.sql.

export interface CostReport {
  from: string;
  to: string;
  opening_value: number;
  closing_value: number;
  purchases: number;
  /** Positive = cost. */
  cogs: { kitchen: number; event: number; waste: number; count_difference: number; usage: number; sale: number };
  /** Signed: positive adds to stock value. */
  other: { correction: number; production: number; opening: number; return: number; transfer: number; reversal: number };
  /** null for someone who cannot see the profit and loss. */
  revenue: { daily: number; event: number } | null;
  ledger_cogs: number | null;
  /** The latest opening count: before it, movement costs are in mixed units. */
  reliable_from: string | null;
  movements_without_cost: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The database's JSON, with every figure a number. */
export function toCostReport(raw: any): CostReport {
  const c = raw?.cogs ?? {}, o = raw?.other ?? {};
  return {
    from: raw?.from, to: raw?.to,
    opening_value: n(raw?.opening_value), closing_value: n(raw?.closing_value), purchases: n(raw?.purchases),
    cogs: { kitchen: n(c.kitchen), event: n(c.event), waste: n(c.waste), count_difference: n(c.count_difference), usage: n(c.usage), sale: n(c.sale) },
    other: { correction: n(o.correction), production: n(o.production), opening: n(o.opening), return: n(o.return), transfer: n(o.transfer), reversal: n(o.reversal) },
    revenue: raw?.revenue ? { daily: n(raw.revenue.daily), event: n(raw.revenue.event) } : null,
    ledger_cogs: raw?.ledger_cogs == null ? null : n(raw.ledger_cogs),
    reliable_from: raw?.reliable_from ?? null,
    movements_without_cost: n(raw?.movements_without_cost),
  };
}

export const COGS_LABEL: Record<keyof CostReport['cogs'], string> = {
  kitchen: 'Issued to kitchen',
  event: 'Event issues, less returns',
  waste: 'Waste',
  count_difference: 'Count differences',
  usage: 'Used, route not said',
  sale: 'Finished goods and stock sold',
};

export const OTHER_LABEL: Record<keyof CostReport['other'], string> = {
  correction: 'Corrections outside a count',
  production: 'Production (used and made)',
  opening: 'Opening stock entered',
  return: 'Returns',
  transfer: 'Transfers',
  reversal: 'Reversals',
};

export interface CostStatement {
  cogsTotal: number;
  otherTotal: number;
  /** opening + purchases − cost of goods + other. */
  expectedClosing: number;
  /** expectedClosing − closing: 0 when the stock records add up. */
  unexplained: number;
  foodRevenue: number | null;
  /** Cost of goods as a share of food revenue, in percent. */
  foodCostPct: number | null;
  /** The ledger's cost of sales less this report's: roughly the change in stock value. */
  ledgerGap: number | null;
}

/** The costing check: opening + purchases − cost of goods (± other) = closing. */
export function costStatement(r: CostReport): CostStatement {
  const cogsTotal = r2(Object.values(r.cogs).reduce((s, v) => s + v, 0));
  const otherTotal = r2(Object.values(r.other).reduce((s, v) => s + v, 0));
  const expectedClosing = r2(r.opening_value + r.purchases - cogsTotal + otherTotal);
  const foodRevenue = r.revenue ? r2(r.revenue.daily + r.revenue.event) : null;
  return {
    cogsTotal, otherTotal, expectedClosing,
    unexplained: r2(expectedClosing - r.closing_value),
    foodRevenue,
    foodCostPct: foodCostPct(cogsTotal, foodRevenue),
    ledgerGap: r.ledger_cogs == null ? null : r2(r.ledger_cogs - cogsTotal),
  };
}

/** Cost as a share of revenue, in percent to one place; null when there is no revenue to divide by. */
export function foodCostPct(cost: number, revenue: number | null | undefined): number | null {
  if (revenue == null || revenue <= 0) return null;
  return Math.round((cost / revenue) * 1000) / 10;
}

// ── Usage by item ────────────────────────────────────────────────────────────

export interface UsageRow {
  week_start: string;
  product_id: string;
  sku_id: string | null;
  item_name: string;
  stock_unit: string | null;
  route: string;
  quantity: number;
  value: number;
}

export interface UsageItem {
  product_id: string;
  sku_id: string | null;
  item_name: string;
  stock_unit: string;
  /** Quantity out per route over the whole period. */
  byRoute: Record<string, number>;
  /** Quantity out per week (every route). */
  byWeek: Record<string, number>;
  quantity: number;
  value: number;
}

/** One line per item, with its routes and its weeks, largest cost first. */
export function pivotUsage(rows: UsageRow[]): { items: UsageItem[]; weeks: string[]; routes: string[] } {
  const items = new Map<string, UsageItem>();
  const weeks = new Set<string>();
  const routes = new Set<string>();
  for (const r of rows) {
    const q = n(r.quantity), v = n(r.value);
    let it = items.get(r.product_id);
    if (!it) {
      it = { product_id: r.product_id, sku_id: r.sku_id, item_name: r.item_name, stock_unit: r.stock_unit ?? '', byRoute: {}, byWeek: {}, quantity: 0, value: 0 };
      items.set(r.product_id, it);
    }
    it.byRoute[r.route] = (it.byRoute[r.route] ?? 0) + q;
    it.byWeek[r.week_start] = (it.byWeek[r.week_start] ?? 0) + q;
    it.quantity += q;
    it.value += v;
    weeks.add(r.week_start);
    routes.add(r.route);
  }
  return {
    items: [...items.values()].map((i) => ({ ...i, value: r2(i.value) })).sort((a, b) => b.value - a.value || a.item_name.localeCompare(b.item_name)),
    weeks: [...weeks].sort(),
    routes: [...routes],
  };
}

// ── Periods and export ───────────────────────────────────────────────────────

/** First and last day of a month given as yyyy-MM. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The last `count` months, newest first, as yyyy-MM. */
export function recentMonths(today: Date, count = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** A CSV a spreadsheet opens cleanly: every cell quoted, quotes doubled. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (c: string | number | null | undefined) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}
