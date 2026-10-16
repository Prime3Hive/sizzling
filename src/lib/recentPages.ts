// The last few workspace pages this person opened, for the Work screen's
// "Recent" row. Kept in this browser only: it's a convenience, so a private
// window or cleared storage just means an empty row.

const KEY = 'sizzling:recent-pages';
const MAX = 6;

export interface RecentPage { to: string; label: string; workspace: string }

export function readRecent(): RecentPage[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.to === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(page: RecentPage) {
  try {
    const next = [page, ...readRecent().filter((r) => r.to !== page.to)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — nothing to remember */
  }
}
