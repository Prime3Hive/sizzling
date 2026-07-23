// ── ReportDetailsDialog ───────────────────────────────────────────────────────
// Full read-only view of a staff report — who, when, scores, line items and the
// review outcome — available at every stage, on both the staff and admin sides.
// Admin passes `children` (grading form) and `footer` (approve / reject actions).

import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  REPORT_TYPES, REPORT_STATUS_COLOR, OPERATIONS_FIELDS, gradeColor,
  type ReportType, type ReportStatus,
} from '@/lib/reports';
import { formatNairaCompact } from '@/lib/currency';

export interface StaffReportRecord {
  id: string;
  user_id: string;
  report_type: ReportType;
  report_date: string;
  submitted_at: string;
  status: string;
  title: string | null;
  summary?: string | null;
  amount: number | null;
  payment_method: string | null;
  details?: any;
  timeliness_score: number | null;
  quality_score: number | null;
  performance_score: number | null;
  grade: string | null;
  review_note: string | null;
  reviewed_at?: string | null;
  converted_ref?: string | null;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm mt-0.5">{children}</div>
    </div>
  );
}

function LineList({ label, children, total }: { label: string; children: React.ReactNode; total?: number | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
      <div className="rounded-lg border divide-y">
        {children}
        {total != null && (
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40">
            <span className="text-xs font-medium text-muted-foreground">Total</span>
            <span className="text-sm font-semibold">{formatNairaCompact(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function LineRow({ title, sub, right }: { title: string; sub?: string | null; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {sub ? <p className="text-xs text-muted-foreground truncate">{sub}</p> : null}
      </div>
      <div className="text-sm whitespace-nowrap text-right">{right}</div>
    </div>
  );
}

/** Type-specific line items / sections of a report body. */
function ReportBody({ report }: { report: StaffReportRecord }) {
  const details = report.details ?? {};
  const lines: any[] = Array.isArray(details.lines) ? details.lines : [];

  switch (report.report_type) {
    case 'expense':
      return lines.length ? (
        <LineList label={`Expense lines (${lines.length})`} total={report.amount}>
          {lines.map((l, i) => (
            <LineRow key={i} title={l.category || 'General'} sub={l.description}
              right={<span className="font-semibold">{formatNairaCompact(l.amount ?? 0)}</span>} />
          ))}
        </LineList>
      ) : null;

    case 'credit':
      return lines.length ? (
        <LineList label={`Items bought on credit (${lines.length})`} total={report.amount}>
          {lines.map((l, i) => (
            <LineRow key={i} title={l.item || 'Miscellaneous'} sub={l.qty ? `Qty ${l.qty}` : null}
              right={<span className="font-semibold">{formatNairaCompact(l.amount ?? 0)}</span>} />
          ))}
        </LineList>
      ) : null;

    case 'inventory':
      return lines.length ? (
        <LineList label={`Stock lines (${lines.length})`}>
          {lines.map((l, i) => (
            <LineRow key={i} title={l.item}
              right={<span className="text-muted-foreground text-xs">counted <span className="text-sm font-semibold text-foreground">{l.counted ?? 0}</span> · used <span className="text-sm font-semibold text-foreground">{l.used ?? 0}</span></span>} />
          ))}
        </LineList>
      ) : null;

    case 'kitchen':
      return lines.length ? (
        <LineList label={`Food prepared (${lines.length})`}>
          {lines.map((l, i) => (
            <LineRow key={i} title={l.item}
              right={<span className="text-muted-foreground text-xs">prep <span className="text-sm font-semibold text-foreground">{l.prepared ?? 0}</span> · served <span className="text-sm font-semibold text-foreground">{l.served ?? 0}</span> · wasted <span className="text-sm font-semibold text-foreground">{l.wasted ?? 0}</span></span>} />
          ))}
        </LineList>
      ) : null;

    case 'operations': {
      const ops = details.operations ?? {};
      const filled = OPERATIONS_FIELDS.filter(f => ops[f.key]);
      return filled.length ? (
        <div className="space-y-2">
          {filled.map(f => (
            <div key={f.key} className="rounded-lg border px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{f.label}</p>
              <p className="text-sm whitespace-pre-wrap">{ops[f.key]}</p>
            </div>
          ))}
        </div>
      ) : null;
    }

    default:
      return null;
  }
}

export default function ReportDetailsDialog({ report, open, onOpenChange, staffName, children, footer }: {
  report: StaffReportRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown on the admin side; omit when staff view their own report. */
  staffName?: string;
  /** Rendered below the details (e.g. the admin grading form). */
  children?: React.ReactNode;
  /** Extra footer actions (e.g. approve / reject). */
  footer?: React.ReactNode;
}) {
  if (!report) return null;

  const details = report.details ?? {};
  const late = report.timeliness_score != null && report.timeliness_score < 100;
  const reviewed = report.status !== 'submitted';
  const creditSource = details.source ?? details.supplier;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {REPORT_TYPES[report.report_type]?.label ?? report.report_type}
            <Badge className={`text-xs border capitalize ${REPORT_STATUS_COLOR[report.status as ReportStatus] ?? ''}`}>{report.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* People & dates */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {staffName && <DetailField label="Submitted by">{staffName}</DetailField>}
            <DetailField label="For date">{format(parseISO(report.report_date), 'dd MMM yyyy')}</DetailField>
            <DetailField label="Submitted">
              {format(parseISO(report.submitted_at), 'dd MMM yyyy, HH:mm')}
              {late && <span className="ml-1.5 text-xs text-amber-600 font-medium">late</span>}
            </DetailField>
            {report.reviewed_at && <DetailField label="Reviewed">{format(parseISO(report.reviewed_at), 'dd MMM yyyy, HH:mm')}</DetailField>}
            {report.amount != null && (
              <DetailField label="Amount">
                <span className="font-semibold">{formatNairaCompact(report.amount)}</span>
                {report.payment_method && <span className="text-muted-foreground capitalize"> · {report.payment_method}</span>}
              </DetailField>
            )}
            {report.report_type === 'sales' && details.sale_type && (
              <DetailField label="Sales channel">{details.sale_type === 'event' ? 'Event sales' : 'Shop sales'}</DetailField>
            )}
            {report.report_type === 'credit' && creditSource && (
              <DetailField label="Bought from">
                {creditSource}
                <span className="text-xs text-muted-foreground"> · {details.is_supplier ? 'registered supplier' : 'not a supplier'}</span>
              </DetailField>
            )}
            {report.report_type === 'credit' && details.due_date && (
              <DetailField label="Payment due">{format(parseISO(details.due_date), 'dd MMM yyyy')}</DetailField>
            )}
          </div>

          {/* Scores */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Timeliness</p>
              <p className="text-lg font-semibold mt-0.5">{report.timeliness_score ?? '—'}</p>
            </div>
            <div className="rounded-lg border px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Quality</p>
              <p className="text-lg font-semibold mt-0.5">{report.quality_score ?? '—'}</p>
            </div>
            <div className="rounded-lg border px-3 py-2 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overall</p>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <p className="text-lg font-semibold">{report.performance_score ?? '—'}</p>
                {report.grade && <Badge className={`text-xs border ${gradeColor(report.grade)}`}>{report.grade}</Badge>}
              </div>
            </div>
          </div>

          <Separator />

          <ReportBody report={report} />

          {/* Staff notes */}
          {report.summary && (
            <div className="rounded-lg bg-muted/40 border px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{report.summary}</p>
            </div>
          )}

          {/* Review outcome */}
          {reviewed && (report.review_note || report.status === 'rejected') && (
            report.status === 'rejected' ? (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-red-600 mb-1">Rejection note</p>
                <p className="text-sm text-red-700">{report.review_note || 'No reason provided.'}</p>
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-emerald-600 mb-1">Review note</p>
                <p className="text-sm text-emerald-800">{report.review_note}</p>
              </div>
            )
          )}
          {report.converted_ref && (
            <p className="text-xs text-violet-600">This report has been converted to a financial record{REPORT_TYPES[report.report_type]?.convertsTo ? ` (${REPORT_TYPES[report.report_type].convertsTo})` : ''}.</p>
          )}

          {children}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {footer}
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
