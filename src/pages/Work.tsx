import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Search, X } from 'lucide-react';
import { useInbox, type InboxKind } from '@/hooks/useInbox';
import { visibleTabs, visibleWorkspaces } from '@/components/shell/navigation';
import { useNavAccess } from '@/components/shell/useNavAccess';
import { readRecent } from '@/lib/recentPages';
import { cn } from '@/lib/utils';

/** Which Inbox queue a page's badge counts. */
const BADGE_KIND: Record<string, InboxKind> = {
  '/expenses': 'expense',
  '/staff-portal?tab=leave': 'leave',
  '/attendance': 'attendance',
  '/business/inventory-requests': 'inventory',
  '/users': 'signup',
};

const WS_TONE: Record<string, string> = {
  people: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  finance: 'bg-brand-soft text-primary',
  operations: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  admin: 'bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-200',
};

/**
 * Every workspace and page this person can open, findable by typing. Replaces
 * the phone's old "More" list: one card per workspace with its pages as chips,
 * so the whole portal fits on a screen or two instead of a long scroll.
 */
export default function Work() {
  const access = useNavAccess();
  const { waiting } = useInbox();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const workspaces = visibleWorkspaces(access).filter((w) => w.id !== 'me');

  const counts = useMemo(() => {
    const c: Partial<Record<InboxKind, number>> = {};
    for (const w of waiting) c[w.kind] = (c[w.kind] ?? 0) + 1;
    return c;
  }, [waiting]);

  const cards = workspaces
    .map((ws) => {
      const all = visibleTabs(ws, access);
      const wsHit = !query || ws.label.toLowerCase().includes(query);
      const tabs = all.filter((t) => wsHit
        || t.label.toLowerCase().includes(query)
        || (t.keywords ?? '').toLowerCase().includes(query));
      return { ws, tabs };
    })
    .filter((c) => c.tabs.length > 0);

  const reachable = new Set(workspaces.flatMap((w) => visibleTabs(w, access).map((t) => t.to)));
  const recent = readRecent().filter((r) => reachable.has(r.to)).slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-[1.75rem] font-bold leading-tight max-lg:hidden">Work</h1>

      <label className="flex h-[50px] items-center gap-2.5 rounded-2xl border border-input bg-card px-3.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-5 w-5 shrink-0" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a page — payroll, stock, invoices…"
          aria-label="Find a page"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search"
            className="-mr-1.5 inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-accent">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </label>

      {!query && recent.length > 0 && (
        <section aria-label="Recent">
          <div className="mb-2 text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Recent</div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
            {recent.map((r) => (
              <Link key={r.to} to={r.to}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border bg-card pl-3 pr-4 text-[13.5px] font-bold hover:border-orange-300">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                {r.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map(({ ws, tabs }) => {
          const Icon = ws.icon;
          return (
            <section key={ws.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', WS_TONE[ws.id])}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-extrabold">{ws.label}</span>
                  <span className="text-[12.5px] leading-snug text-muted-foreground">{ws.description}</span>
                </span>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                {tabs.map((t) => {
                  const kind = BADGE_KIND[t.to];
                  const n = kind ? counts[kind] ?? 0 : 0;
                  return (
                    <Link key={t.to} to={t.to}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-background px-3.5 text-[13.5px] font-semibold transition-colors hover:border-orange-300 active:bg-accent">
                      {t.label === 'Overview' ? `${ws.label} overview` : t.label}
                      {n > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-chilli px-1.5 text-[11px] font-extrabold tabular-nums text-white">
                          {n}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {workspaces.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Pages for your role show up here once an administrator approves your access.
        </p>
      )}
      {workspaces.length > 0 && cards.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing matches “{q}”. Try a page name like “payroll” or “stock”.
        </p>
      )}
    </div>
  );
}
