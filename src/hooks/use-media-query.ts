import * as React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// useMediaQuery
//
// Tailwind's responsive classes cannot hide a Radix overlay: SheetContent and
// PopoverContent both portal to <body>, so a `sm:hidden` wrapper around the
// Root leaves the portalled content mounted and visible at every width.
// Anything that needs a *different overlay* per breakpoint has to branch in
// JavaScript, not in CSS — that is what this is for.
//
// Pass the same breakpoint the classes would have used, e.g. '(min-width:
// 640px)' for Tailwind's `sm`.
// ─────────────────────────────────────────────────────────────────────────────

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

export function useMediaQuery(query: string): boolean {
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  const subscribeToQuery = React.useMemo(() => subscribe(query), [query]);

  // Server/pre-hydration snapshot: assume the small layout, which is the one
  // that degrades safely if the guess is wrong.
  return React.useSyncExternalStore(subscribeToQuery, getSnapshot, () => false);
}
