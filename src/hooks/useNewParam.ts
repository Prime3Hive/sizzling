import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * The `?new=` value the page was opened with, or null — the phone's ＋ New
 * sheet and the search palette link straight to a page's create form that way
 * (`?new=1`, or a kind such as `?new=expense`). It is read once and stripped
 * from the URL straight after, so Back, a refresh or a shared link don't pop
 * the form open again.
 */
export function useNewParam(): string | null {
  const [params, setParams] = useSearchParams();
  const [wanted] = useState(() => params.get('new'));
  useEffect(() => {
    if (!params.get('new')) return;
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
    // Run once on arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return wanted;
}
