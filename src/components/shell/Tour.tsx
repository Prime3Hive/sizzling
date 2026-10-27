// The walkthrough's on-screen part: a spotlight around the element a step is
// about, and a small card beside it with Back / Next / Skip. Opens by itself on
// a person's first visit (once more after approval), and again on demand via
// startTour().

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type { NavAccess } from './navigation';
import { hasSeenTour, markTourSeen, onStartTour, tourKind, tourSteps } from './tourSteps';

const PAD = 6;       // spotlight breathing room around the element
const GAP = 14;      // space between spotlight and card
const MARGIN = 12;   // keep the card this far from the screen edge
const CARD_W = 340;

/** The first copy of any anchor that is actually on screen. */
function findAnchor(anchors?: string[]): HTMLElement | null {
  for (const a of anchors ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${a}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

interface Box { top: number; left: number; width: number; height: number }

function placeCard(target: Box | null, card: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - card.width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - card.height - MARGIN);
  if (!target) return { top: clampY((vh - card.height) / 2), left: clampX((vw - card.width) / 2) };

  const right = target.left + target.width + GAP;
  const below = target.top + target.height + GAP;
  const above = target.top - GAP - card.height;
  const midX = target.left + target.width / 2 - card.width / 2;
  const midY = target.top + target.height / 2 - card.height / 2;

  // Tall, narrow things on the left (the sidebar): beside them.
  if (right + card.width <= vw - MARGIN && target.left < vw / 3) return { top: clampY(midY), left: right };
  // Things low on the screen (the phone tab bar): above them.
  if (target.top > vh / 2 && above >= MARGIN) return { top: above, left: clampX(midX) };
  if (below + card.height <= vh - MARGIN) return { top: below, left: clampX(midX) };
  if (above >= MARGIN) return { top: above, left: clampX(midX) };
  return { top: clampY(midY), left: clampX(target.left - GAP - card.width) };
}

export default function Tour({ access, loading, firstName }: {
  access: NavAccess;
  loading: boolean;
  firstName?: string;
}) {
  const { user } = useAuth();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const kind = tourKind(access);

  const steps = useMemo(
    () => tourSteps(access, { desktop, firstName }),
    [access, desktop, firstName],
  );
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  // First visit, and again after approval: open once roles have loaded.
  useEffect(() => {
    if (loading || !user || hasSeenTour(user.id, kind)) return;
    const t = window.setTimeout(() => { setI(0); setOpen(true); }, 700);
    return () => window.clearTimeout(t);
  }, [loading, user, kind]);

  useEffect(() => onStartTour(() => { setI(0); setOpen(true); }), []);

  const close = useCallback(() => {
    setOpen(false);
    if (user) markTourSeen(user.id, kind);
  }, [user, kind]);

  const measure = useCallback(() => {
    if (!open || !step) return;
    const el = findAnchor(step.anchors);
    const r = el?.getBoundingClientRect();
    const box = r
      ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
      : null;
    setTarget(box);
    const card = cardRef.current;
    if (card) setPos(placeCard(box, { width: card.offsetWidth, height: card.offsetHeight }));
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open) return;
    findAnchor(step?.anchors)?.scrollIntoView({ block: 'nearest' });
    measure();
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  // Keyboard: arrows move, Escape skips. Focus the card so screen readers
  // announce each step.
  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, i, steps.length, close]);

  if (!open || !step) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Catches clicks so the page behind can't be used mid-tour. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed rounded-xl transition-all duration-300 ease-out',
          target ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : '',
        )}
        style={target
          ? { ...target, boxShadow: '0 0 0 9999px hsl(0 0% 0% / 0.55)' }
          : { top: '50%', left: '50%', width: 0, height: 0, boxShadow: '0 0 0 9999px hsl(0 0% 0% / 0.55)' }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed flex flex-col gap-3 rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl outline-none transition-[top,left] duration-300 ease-out"
        style={{
          width: `min(${CARD_W}px, calc(100vw - ${MARGIN * 2}px))`,
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Step {i + 1} of {steps.length}
            </div>
            <h2 id="tour-title" className="mt-1 font-display text-lg font-bold leading-snug">{step.title}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Skip the tour"
            className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p id="tour-body" className="text-[14.5px] leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="flex gap-1.5" aria-hidden>
          {steps.map((s, n) => (
            <span key={s.id} className={cn('h-1.5 flex-1 rounded-full transition-colors', n <= i ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1">
          {last ? (
            <Link to="/help" onClick={close} className="text-sm font-semibold text-brand-soft-foreground hover:underline">
              Open the guide
            </Link>
          ) : (
            <button type="button" onClick={close} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
              Skip
            </button>
          )}
          <span className="flex-1" />
          {i > 0 && (
            <Button variant="outline" onClick={() => setI(i - 1)} className="h-10">Back</Button>
          )}
          <Button onClick={() => (last ? close() : setI(i + 1))} className="h-10">
            {i === 0 ? 'Show me around' : last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
