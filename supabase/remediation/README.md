# Corrective data scripts (M-02 → M-06)

These are **not** migrations and must never be put in `supabase/migrations/`.
They touch live, corrupted financial data. Nothing here runs automatically, and
nothing here should run without a backup you have actually tested restoring.

## Run order

| Step | Script | Writes? | Gate before running |
|---|---|---|---|
| M-02 | `M-02_identify_duplicate_receipt_postings.sql` | No | Phase 1 migrations applied |
| M-03 | `M-03_reverse_duplicate_receipt_postings.sql` | **Yes** | M-02 output signed off by the finance lead |
| M-04 | `M-04_accounts_payable_recalculation.sql` | No | M-03 complete |
| M-05 | `M-05_bank_reconciliation_working.sql` | No | M-03 complete |
| M-06 | `M-06_opening_equity.sql` | **Yes** | M-04 and M-05 agreed, **and** a written opening-capital figure from the finance lead |

Only M-03 and M-06 change anything. The other three are reports, and they exist
so that the two that write have something agreed to write against.

## Migrations these depend on

Apply in this order first:

1. `20260816120000_phase1_append_only_journal.sql` — `fn_reverse_entry`, and the
   journal stops deleting itself
2. `20260816130000_phase1_no_delete_financial_records.sql` — cancellation columns
3. `20260819100000_phase1_cogs_on_stock_issue.sql` — cost recognised on issue

Each has a paired `.down.sql`. Read the rollback notes before relying on them:
they restore **code**, not **data**, because the data is a ledger.

## The rules these scripts are written to

- **Nothing is deleted.** Corrections are reversing entries that reference the
  original via `reversal_of_id`. Every script here obeys this, including M-03.
- **No number is adjusted to what it ought to be.** Where a balance is wrong,
  the entry that caused it gets reversed. M-06 is the one place a figure is
  posted directly, which is exactly why it demands a signature rather than a
  calculation.
- **M-03 refuses to run** while the application is still creating duplicates.
  Deploy the Phase 1 application fix first or it will stop you.

## Status

None of these have been executed. They were written without access to a
database and are unverified against a live schema. Run them against a staging
copy of production before they go anywhere near the live ledger.
