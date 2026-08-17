import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  parseMoney,
  isMoneyError,
  formatMinor,
  formatAmountForTyping,
  caretAfterFormat,
  type ParseMoneyOptions,
} from '@/lib/money';

// ─────────────────────────────────────────────────────────────────────────────
// MoneyInput
//
// Deliberately NOT <input type="number">. A number input suppresses the
// thousands separator, puts a spinner on a phone that nobody wants, and — the
// reason this component exists — lets the BROWSER interpret the number using
// the device's locale. On a comma-decimal device that turns "922,340" into
// 922.34 before any of our code sees it.
//
// So: type="text" with inputmode="decimal", grouped as the user types, and
// parsed by parseMoney() alone. The parsed value is echoed beneath the field so
// the user can confirm the figure before they submit.
// ─────────────────────────────────────────────────────────────────────────────

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** Raw text the user has typed. Owned by the caller. */
  value: string;
  onChange: (raw: string) => void;
  /** Parser options — ceiling, allowZero, label. */
  parseOptions?: ParseMoneyOptions;
  /** Show the parsed amount beneath the field. Default true. */
  showPreview?: boolean;
  /** An error from the shared validator, shown in place of the preview. */
  error?: string | null;
  /** id of the element describing this field, merged with the preview id. */
  describedBy?: string;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, parseOptions, showPreview = true, error, className, id, describedBy, ...rest },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  // Where to put the caret after React re-renders with the regrouped value.
  const pendingCaret = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    if (pendingCaret.current !== null && innerRef.current) {
      innerRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const formatted = formatAmountForTyping(raw);
    pendingCaret.current = caretAfterFormat(raw, caret, formatted);
    onChange(formatted);
  };

  const parsed = value.trim() === '' ? null : parseMoney(value, parseOptions);
  const previewId = id ? `${id}-preview` : undefined;
  const hasError = !!error || (parsed !== null && isMoneyError(parsed));
  const message = error ?? (parsed !== null && isMoneyError(parsed) ? parsed.error : null);

  return (
    <>
      <Input
        {...rest}
        ref={setRefs}
        id={id}
        // text, never number — see the note at the top of this file.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint={rest.enterKeyHint ?? 'next'}
        value={value}
        onChange={handleChange}
        aria-invalid={hasError || undefined}
        aria-describedby={[describedBy, previewId].filter(Boolean).join(' ') || undefined}
        className={cn(
          // 16px minimum, or iOS Safari zooms the page on focus and the user
          // loses their place in the form.
          'text-base tabular-nums',
          hasError && 'border-destructive focus-visible:ring-destructive',
          className,
        )}
      />
      {showPreview && (
        <p
          id={previewId}
          className={cn(
            'text-sm min-h-[1.25rem]',
            hasError ? 'text-destructive' : 'text-muted-foreground',
          )}
          // Announce the parsed figure and any error to screen readers.
          role={hasError ? 'alert' : undefined}
          aria-live={hasError ? undefined : 'polite'}
        >
          {message ?? (parsed && !isMoneyError(parsed) ? formatMinor(parsed.minor) : '')}
        </p>
      )}
    </>
  );
});
