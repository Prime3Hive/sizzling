import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// ResponsiveTable
//
// A single column definition drives both a desktop <table> and a stacked
// card layout on small screens, so every list in the app reads cleanly on a
// phone without bespoke per-page markup.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResponsiveColumn<T> {
  /** Stable key for the column. */
  key: string;
  /** Header label (desktop table head + mobile card row label). */
  header?: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /** Text alignment for the desktop cell. */
  align?: "left" | "right" | "center";
  /** Extra classes for the desktop cell. */
  className?: string;
  /** Extra classes for the desktop header. */
  headClassName?: string;
  /** Render this column as the card title (top row) on mobile. */
  primary?: boolean;
  /** Hide this column from the mobile card entirely. */
  hideOnMobile?: boolean;
  /** Render full-width at the foot of the mobile card (e.g. actions). */
  mobileFooter?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Optional secondary line under the title on the mobile card. */
  mobileSubtitle?: (row: T) => React.ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  emptyState?: React.ReactNode;
}

const alignCls = (a?: "left" | "right" | "center") =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

export function ResponsiveTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  mobileSubtitle,
  className,
  rowClassName,
  emptyState,
}: ResponsiveTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const footerCols = columns.filter((c) => c.mobileFooter);
  const trailing = columns.find(
    (c) => c !== primary && c.align === "right" && !c.mobileFooter && !c.hideOnMobile,
  );
  const bodyCols = columns.filter(
    (c) => c !== primary && c !== trailing && !c.mobileFooter && !c.hideOnMobile,
  );

  return (
    <>
      {/* ── Desktop: table ── */}
      <div className={cn("hidden md:block overflow-x-auto", className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(alignCls(c.align), c.headClassName)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow
                key={rowKey(row, i)}
                className={cn(onRowClick && "cursor-pointer hover:bg-muted/30", rowClassName?.(row))}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(alignCls(c.align), c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Mobile: one card per row ──
          The title leads, the row's headline figure (its first right-aligned
          column — usually the amount) sits opposite it where the eye expects
          a number, and the rest follow as labelled pairs. */}
      <div className="md:hidden divide-y divide-border">
        {data.map((row, i) => {
          const open = onRowClick ? () => onRowClick(row) : undefined;
          return (
            <div
              key={rowKey(row, i)}
              className={cn(
                "py-3.5 px-1 first:pt-1",
                open && "cursor-pointer active:bg-muted/40",
                rowClassName?.(row),
              )}
              onClick={open}
              role={open ? "button" : undefined}
              tabIndex={open ? 0 : undefined}
              onKeyDown={open ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
              } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-snug">{primary.cell(row)}</div>
                  {mobileSubtitle && (
                    <div className="mt-0.5 text-[12.5px] text-muted-foreground">{mobileSubtitle(row)}</div>
                  )}
                </div>
                {trailing && (
                  <div className="shrink-0 text-right text-[15px] font-bold tabular-nums">{trailing.cell(row)}</div>
                )}
              </div>

              {bodyCols.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                  {bodyCols.map((c) => (
                    <div key={c.key} className="flex min-w-0 flex-col">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.header}
                      </dt>
                      <dd className="text-sm">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {footerCols.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  {footerCols.map((c) => (
                    <div key={c.key} className="w-full">{c.cell(row)}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
