// Shared definitions and grading logic for the Daily Checklists module.
// A checklist template carries a type and a list of items. It is assigned to a
// staff member (cadence + due time) who completes it; the submission is graded
// on completion (how many items done), timeliness and an admin quality score.

import { gradeFromScore, combinePerformance, computeTimeliness } from './reports';

export type ChecklistStatus = 'submitted' | 'approved' | 'rejected';

export const CHECKLIST_TYPES: { value: string; label: string }[] = [
  { value: 'opening',  label: 'Opening' },
  { value: 'closing',  label: 'Closing' },
  { value: 'kitchen',  label: 'Kitchen' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'safety',   label: 'Safety' },
  { value: 'custom',   label: 'Custom' },
];

export function checklistTypeLabel(type: string): string {
  return CHECKLIST_TYPES.find(t => t.value === type)?.label ?? type;
}

// An item on a template.
export interface ChecklistItem {
  id: string;
  label: string;
  required?: boolean;
}

// A completed item on a submission.
export interface ChecklistResult {
  id: string;
  label: string;
  done: boolean;
  note?: string;
}

/** % of items marked done (0–100). Required items still count once each. */
export function completionScore(results: ChecklistResult[] = []): number {
  if (results.length === 0) return 0;
  const done = results.filter(r => r.done).length;
  return Math.round((done / results.length) * 100);
}

/** True when every item flagged `required` on the template was completed. */
export function requiredItemsDone(items: ChecklistItem[] = [], results: ChecklistResult[] = []): boolean {
  const doneIds = new Set(results.filter(r => r.done).map(r => r.id));
  return items.filter(i => i.required).every(i => doneIds.has(i.id));
}

/**
 * A submission's self-graded score before admin review: the average of how much
 * was completed and how on-time it was. Admin quality later folds in.
 */
export function checklistAutoScore(opts: {
  results: ChecklistResult[];
  checklistDate: string;
  submittedAt: string | Date;
  dueTime?: string | null;
}): { completion: number; timeliness: number; performance: number; grade: string } {
  const completion = completionScore(opts.results);
  const timeliness = computeTimeliness({
    reportDate: opts.checklistDate,
    submittedAt: opts.submittedAt,
    dueTime: opts.dueTime,
  });
  const performance = Math.round((completion + timeliness) / 2);
  return { completion, timeliness, performance, grade: gradeFromScore(performance) };
}

/** Final score once an admin adds a quality rating: blend auto-performance with quality. */
export function checklistFinalScore(autoPerformance: number | null, quality: number | null): number | null {
  return combinePerformance(autoPerformance, quality);
}

export const CHECKLIST_STATUS_COLOR: Record<ChecklistStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected:  'bg-red-100 text-red-700 border-red-200',
};

/** Make a stable-ish id for a new template item. */
export function newItemId(): string {
  return `item_${Math.random().toString(36).slice(2, 9)}`;
}
