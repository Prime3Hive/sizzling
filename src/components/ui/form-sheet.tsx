import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// FormSheet
//
// §5.2: "The modal must be a full-screen sheet below 640px, not a centred
// dialog. A centred dialog on a phone puts the Save button below the fold —
// which is how a half-filled form gets abandoned."
//
// So: full-screen below sm, a centred 720px-max dialog above it. The body
// scrolls; the action bar does not, and sits above the safe-area inset.
// ─────────────────────────────────────────────────────────────────────────────

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Rendered into the sticky action bar. */
  footer?: React.ReactNode;
  /** Ask before closing when the form has unsaved changes. */
  dirty?: boolean;
  /** Wider variant for the bulk grid, which is a real table at lg. */
  size?: 'form' | 'wide';
}

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dirty,
  size = 'form',
}: FormSheetProps) {
  const titleId = React.useId();
  const descId = React.useId();

  const requestClose = React.useCallback(() => {
    if (dirty && !window.confirm('Discard the details you have entered?')) return;
    onOpenChange(false);
  }, [dirty, onOpenChange]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
        else onOpenChange(true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          onEscapeKeyDown={(e) => {
            // Escape prompts when the form is dirty (§5.3).
            e.preventDefault();
            requestClose();
          }}
          className={cn(
            'fixed z-50 bg-background flex flex-col',
            // Phone: a full-screen sheet, so Save is never below the fold.
            'inset-0 w-full h-full max-h-none rounded-none border-0',
            // Tablet and desktop: a centred dialog, capped so a text input is
            // never 1400px wide.
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border sm:shadow-lg',
            size === 'wide' ? 'sm:w-[95vw] sm:max-w-5xl' : 'sm:w-[95vw] sm:max-w-[720px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        >
          {/* Header — fixed */}
          <div className="flex items-start justify-between gap-4 border-b px-4 py-3 sm:px-6 sm:py-4 shrink-0">
            <div className="min-w-0">
              <DialogPrimitive.Title id={titleId} className="text-lg font-semibold truncate">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description id={descId} className="text-sm text-muted-foreground mt-0.5">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              // 44px tap target.
              className="shrink-0 -mr-2 -mt-1 h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body — the only thing that scrolls */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>

          {/* Action bar — sticky, above the home indicator */}
          {footer && (
            <div
              className="shrink-0 border-t bg-background px-4 py-3 sm:px-6"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * A labelled field. Every input gets a real <label for> — a placeholder is not
 * a label — and required fields are marked both visually and for assistive
 * technology.
 */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium leading-none flex items-center gap-1">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive flex items-start gap-1">
          {/* Never rely on colour alone. */}
          <span aria-hidden>⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Legend explaining the asterisk, shown once per form. */
export const RequiredLegend = () => (
  <p className="text-xs text-muted-foreground">
    Fields marked <span className="text-destructive">*</span> are required.
  </p>
);
