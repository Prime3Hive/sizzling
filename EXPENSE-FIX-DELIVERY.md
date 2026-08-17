# Expense fix — delivery notes

Implementation of `EXPENSE-FIX-INSTRUCTIONS.md`, all five phases. This file records
what was built, what deviates from the specification and why, and what is still
outstanding on someone else's desk.

---

## 1. The parser defect (E-01) — cause

There is **no** comma→period `replace` anywhere in the codebase and **no** non-`en-NG`
locale, so candidates (a), (b) and (c) in prompt 0.2 do not exist as written. The
mechanism is a locale-dependent variant of (b), and it happens in the browser rather
than in application code:

Every amount field was `<input type="number">` and every read was `parseFloat(value)`.
Chromium sanitises a number input's `value` using the **device's** locale. On a phone
set to any comma-decimal locale, typing `922,340` leaves `input.value === "922.340"`,
and `parseFloat("922.340")` is `922.34`. Amounts typed without separators (`1373250`)
pass through untouched — which is exactly why 1,373,250.00 and 687,395.00 survived in
the same table.

The specific line that stored the ₦922.34 was the staff expense report line amount
(`MyReports.tsx`), read at the `parseFloat` in its submit handler.

The fix is therefore not a smarter parser bolted onto the same input — it is to stop
letting the browser interpret the number at all. See `src/lib/money.ts`.

---

## 2. What was built

### Phase 1 — money (§2)

| File | What |
|---|---|
| `src/lib/money.ts` | `parseMoney` (comma is always a thousands separator), `formatMinor`, live typing formatter with caret preservation |
| `src/lib/money.test.ts` | All 9 mandated vectors plus 24 more |
| `src/components/ui/money-input.tsx` | `type="text" inputmode="decimal"`, never `type="number"`; parsed value echoed beneath the field |
| `20260817100000_expense_money_minor_units.sql` | `amount_minor BIGINT` on `expenses`, `payables`, `staff_reports` |
| `sql/M-02-suspect-amounts.sql` | Read-only diagnostic — **you run this** |

Money is stored as integer kobo. Per the agreed strategy, `amount` became a
`GENERATED ALWAYS AS (amount_minor / 100.0) STORED` column, so the ~15 existing readers
and the posting functions keep working untouched.

### Phase 2 — record shape (§3)

`expense_claim` + `expense_line` tables. `total_minor` is maintained by trigger and can
never be entered directly. `src/lib/expenseSplitter.ts` implements paste-to-lines; the
worked example from §3.2 is a test and produces exactly 8 lines totalling ₦922,340 with
"Total amount 922,340" recognised as a stated total, not a 9th line.

### Phase 3 — one validator (§4)

`validateExpenseLine()` in `src/lib/expenseValidation.ts`. Every capture route imports
it: the single form, the bulk grid, the staff claim, and the M-03 correction screen.
The same rules are enforced in the database by
`20260817130000_expense_server_validation.sql` — if the two ever disagree, the database
wins. Category, cost centre and expense account are foreign keys to controlled tables;
every free-text path is gone from expense capture.

### Phase 4 — the forms (§5, §6)

Mobile-first throughout: full-screen sheet below 640px, sticky action bar above
`env(safe-area-inset-bottom)`, 44px minimum targets, 16px inputs, searchable sheets for
selects with more than 8 options, camera capture on receipts with client-side image
compression. Field order is identical at every breakpoint. Staff claims persist to
`localStorage` on every change and are offered back on reopen.

### Phase 5 — display and posting (§7, §8)

Sortable list with a total for the filtered set, receipt warning icons, word-boundary
truncation, and cards rather than a scrolling table below 640px.
`20260817120000_expense_posting_rules.sql` rewrites `fn_post_expense`: the expense
account comes from the line, and the credit leg follows the payment method — cash
spending no longer posts as bank spending.

---

## 3. Deviations from the specification, and why

| § | Specified | Delivered | Why |
|---|---|---|---|
| E-20 | Session tokens live in `sessionStorage` and die with the tab | **No change needed** | `client.ts` already sets `storage: localStorage`. The only `sessionStorage` use is a reload guard in `App.tsx`. The §6.2 dependency on this dissolves; drafts persist regardless |
| E-12 | Stop the goods receipt generating an expense | **Already done** | `ReceiveGoodsDialog.tsx` no longer inserts an expense; the comment recording the removal is still there |
| §5.4 | Payee typeahead "against the vendor master" | Minimal `payees` table created | `FIX-INSTRUCTIONS.md`, which the spec makes authoritative for the vendor master, **is not in this repository**, and no vendor/supplier table existed. If procure-to-pay later brings its own, these rows are the migration source |
| §5.1 | Budget marked required (`*`) | **Required in the form; column stays nullable** | `20260614120000_expense_budget_optional.sql` deliberately dropped that NOT NULL. Implemented as specified, but the DB constraint was not re-imposed so this is a one-line reversal if it proves wrong |
| §3.1 | `expense_claim.period_id` | `period_month date`, generated from `claim_date` | `period_locks` is a "locked through" watermark, not a table of periods — there is no id to reference |
| §8 | Withholding tax credited to 1150 | **Implemented as specified, flagged** | 1150 is "WHT Receivable", an asset. That is right for tax a *customer* withholds from us, but tax we withhold from a *supplier* is owed onward to FIRS, i.e. a liability. The entry balances either way; the classification is the question. See the comment block at the top of the posting migration |
| §8 | Remove the COGS/OpEX Account Type | Removed from expense capture; **left in `LPOSheet.tsx`** | That is procurement, governed by the missing companion document |

---

## 4. Outstanding — not mine to decide

### Migration state of the live database — resolved

The first run of the M-02 diagnostic failed with:

```
ERROR: 42703: column e.cancelled_at does not exist
```

`cancelled_at` is added by `20260816130000_phase1_no_delete_financial_records.sql`,
which was committed but had not been applied. That mattered beyond the diagnostic:
the shipped application already reads that column in six places (the expense list and
cancel action, the dashboard category chart, the P&L, NJC Supplies and Payroll), so
those screens were failing too.

`sql/M-00-schema-probe.sql` established the state, and the migration has since been
applied. Confirmed present on `expenses`:

| Columns | From |
|---|---|
| `status`, `approved_by`, `approved_at` | `20260723110000_phase2_wht_vat_expense_approval.sql` |
| `cancelled_at`, `cancelled_by`, `cancellation_reason` | `20260816130000_phase1_no_delete_financial_records.sql` |

`amount` is still plain `numeric` with `is_generated = NEVER`, so none of the four
`20260817*` migrations in this delivery have run yet.

Because migrations here are applied by hand in the SQL editor, `20260817100000` opens
with a precondition block that re-checks every table, column and function the set
depends on and aborts with a list naming the file to apply for each missing one. That
block, not a checklist, is the gate — run the migration and it will tell you if anything
is still absent.

### The §0.2 gate

`sql/M-02-suspect-amounts.sql` is read-only and can be run now, before the migrations,
to capture the baseline the gate asks for. Query 1 gives the count; queries 2–4 give the
working lists for M-03. **Do not auto-correct from the results** — the factor is not
always 1000, and a value like `12,50` → 12.50 is invisible to this sweep.

Now that `cancelled_at` is confirmed, the cancelled-row filters are active, so the
counts are exact. Rejected rows are deliberately still included: a rejected expense with
a corrupted amount is a corrupted record worth seeing.

The M-03 correction screen is live at **Accounting → Amount Corrections**. It shows the
original narrative beside an empty field, a human types what the receipt says, and the
before-image, user and timestamp are recorded by trigger.

### Management decisions (§12)

Taken as the suggested defaults, all in `src/lib/expenseConfig.ts` and mirrored in the
`expense_settings` table:

- Receipt threshold ₦10,000
- Implausibility factor 100×
- Amount ceiling for review ₦50,000,000
- Future-date tolerance 0 days

Still genuinely open, deliberately not guessed:

- **Category → account mapping.** `CATEGORY_ACCOUNT_MAP` is empty, so the account field
  has no default, which is what §5.4 requires. The finance lead supplies this and it
  becomes a pre-fill the user can still override.
- **Who approves, and their limits.** `APPROVAL_LIMITS` is empty. The current rule
  stands: any admin may approve any amount, and the approver may not be the submitter
  (enforced by CHECK constraint, trigger and client validator).
- **How far back to re-capture** (M-03). Set a cut-off deliberately and record what is
  accepted as irrecoverable.

---

## 5. Deployment order — this matters

Once `amount` is a generated column it **cannot be written**. An old client inserting
`amount` will fail with "cannot insert into generated column".

Run `sql/M-00-schema-probe.sql` first and clear anything it reports as MISSING.

Then ship the application and the migrations **in the same release**, and run the
migrations in filename order:

```
20260817100000_expense_money_minor_units.sql
20260817110000_expense_claims_and_lines.sql
20260817120000_expense_posting_rules.sql
20260817130000_expense_server_validation.sql
```

Every one has a matching `.down.sql`. The posting migration re-posts every expense
journal under the corrected rules, skipping anything in a closed period.

The amount constraints are added `NOT VALID` on purpose: they bind every new write, but
existing zero or over-ceiling rows are exactly the corrupted data M-03 exists to fix, so
they must not abort the migration. The migration raises a NOTICE counting them. After
M-03 is complete, validate them:

```sql
ALTER TABLE public.expenses VALIDATE CONSTRAINT expenses_amount_minor_positive;
ALTER TABLE public.expenses VALIDATE CONSTRAINT expenses_amount_minor_ceiling;
ALTER TABLE public.payables VALIDATE CONSTRAINT payables_amount_minor_positive;
```

Run `sql/M-02-suspect-amounts.sql` **before** the migrations if you want the pre-change
picture; the first migration also sets an `amount_suspect` flag using the same rule.

---

## 6. Verification

- `npm test` — 89 tests, all passing. Includes the 9 mandated parser vectors (X-01),
  the implausibility check (X-02), the pasted-list rule and worked example (X-03), the
  claim reconciliation and approver rules (X-11), and text normalisation (M-06).
- `npm run build` — passes.
- `npx tsc --noEmit` — 195 errors, down from a 198 baseline. All of them are
  pre-existing noise from a stale `src/integrations/supabase/types.ts` that predates
  `invoices`, `payables`, `staff_reports`, `journal_entries` and others. **Regenerating
  that file is worth doing separately** and would clear most of them.

### Not verified

The acceptance tests U-01 to U-14 in §11 are device tests — iOS Safari zoom, tap target
size in the hand, camera capture, contrast in every state. The code targets every one of
them, but they need a real phone. Nothing here has been run against the production
database, because this environment has only the anon key.
