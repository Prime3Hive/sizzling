import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Give every body/footer cell a `data-label` naming its column, read from the
 * table's last header row (colSpan-aware). The `.table-stack` styles in
 * index.css print it above the value when a phone shows each row as a card.
 * Re-runs whenever rows change, so paging, filtering and live data stay
 * labelled without any per-page wiring.
 */
export function useTableStack<T extends HTMLTableElement>(enabled = true) {
  const [node, setNode] = React.useState<T | null>(null);
  React.useLayoutEffect(() => {
    if (!enabled || !node) return;
    const label = () => {
      const head = node.tHead?.rows;
      if (!head || head.length === 0) return;
      const names: string[] = [];
      for (const th of Array.from(head[head.length - 1].cells)) {
        const text = (th.textContent ?? "").trim();
        for (let i = 0; i < (th.colSpan || 1); i++) names.push(text);
      }
      const rows = [
        ...Array.from(node.tBodies).flatMap((b) => Array.from(b.rows)),
        ...(node.tFoot ? Array.from(node.tFoot.rows) : []),
      ];
      for (const tr of rows) {
        let col = 0;
        for (const td of Array.from(tr.cells)) {
          const name = td.colSpan > 1 ? "" : names[col] ?? "";
          if (td.getAttribute("data-label") !== name) td.setAttribute("data-label", name);
          col += td.colSpan || 1;
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(node, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [node, enabled]);
  return setNode;
}

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Below md, show each row as a labelled card instead of a sideways scroll. */
  stack?: boolean;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, stack, ...props }, ref) => {
    const stackRef = useTableStack<HTMLTableElement>(!!stack);
    const setRef = React.useCallback((el: HTMLTableElement | null) => {
      stackRef(el);
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLTableElement | null>).current = el;
    }, [ref, stackRef]);
    return (
      // min-w-0 stops the scroller from being stretched by its own content when
      // it sits inside a flex/grid parent — without it the page scrolls sideways
      // instead of the table.
      <div className="relative w-full min-w-0 overflow-x-auto">
        <table ref={setRef} className={cn("w-full caption-bottom text-sm", stack && "table-stack", className)} {...props} />
      </div>
    );
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-12 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 sm:px-4",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0 sm:p-4", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
