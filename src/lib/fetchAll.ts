// Supabase/PostgREST returns at most the requested range (and a server cap of
// 1000 rows). A dashboard that fetches rows and sums them in the browser must
// page through ALL of them, or the totals silently stop at the cap — the cause
// of "100 paid" on the overview against 176 on the P&L.
//
// Prefer aggregating in SQL. Where rows are genuinely needed, use this.

const PAGE = 1000;

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start, start + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}
