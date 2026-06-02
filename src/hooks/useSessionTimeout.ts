import { useEffect, useRef, useCallback } from "react";

const ACTIVITY_EVENTS = [
  "mousemove", "mousedown", "keydown", "scroll", "touchstart", "click",
] as const;

interface Options {
  /** Total inactivity timeout in milliseconds. Default: 30 minutes */
  timeoutMs?: number;
  /** How many ms before timeout to trigger the warning. Default: 5 minutes */
  warningMs?: number;
  onWarn: (remainingMs: number) => void;
  onExpire: () => void;
}

export function useSessionTimeout({
  timeoutMs = 30 * 60 * 1000,
  warningMs = 5 * 60 * 1000,
  onWarn,
  onExpire,
}: Options) {
  const lastActivityRef = useRef<number>(Date.now());
  const warnFiredRef    = useRef<boolean>(false);
  const onWarnRef       = useRef(onWarn);
  const onExpireRef     = useRef(onExpire);

  // Keep refs current so the interval closure doesn't go stale
  useEffect(() => { onWarnRef.current  = onWarn;  }, [onWarn]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    warnFiredRef.current    = false;
  }, []);

  useEffect(() => {
    // Attach activity listeners
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, resetTimer, { passive: true })
    );

    const interval = setInterval(() => {
      const idle     = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - idle;

      if (remaining <= 0) {
        clearInterval(interval);
        onExpireRef.current();
        return;
      }

      if (!warnFiredRef.current && remaining <= warningMs) {
        warnFiredRef.current = true;
        onWarnRef.current(remaining);
      }
    }, 10_000); // check every 10 seconds

    return () => {
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach((ev) =>
        window.removeEventListener(ev, resetTimer)
      );
    };
  }, [timeoutMs, warningMs, resetTimer]);

  return { resetTimer };
}
