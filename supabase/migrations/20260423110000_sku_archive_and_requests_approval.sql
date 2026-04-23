-- ================================================================
-- SKU ARCHIVE FLAG + INVENTORY REQUESTS APPROVAL FLOW
-- ================================================================

-- ── 1. ADD is_archived TO skus ────────────────────────────────────
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- ── 2. ENHANCE inventory_requests FOR APPROVAL FLOW ──────────────
-- Make legacy FK columns nullable (old requests used product/warehouse system)
ALTER TABLE public.inventory_requests
  ALTER COLUMN product_id  DROP NOT NULL,
  ALTER COLUMN warehouse_id DROP NOT NULL;

-- Add SKU-based request support
ALTER TABLE public.inventory_requests
  ADD COLUMN IF NOT EXISTS sku_id         UUID REFERENCES public.skus(id),
  ADD COLUMN IF NOT EXISTS approved_by    UUID,
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS purchase_cost  NUMERIC(12,2);

-- Update status check to include new states
-- (status was VARCHAR with default 'pending' — add 'approved', 'rejected')
-- No constraint change needed; VARCHAR accepts any value.

-- ── 3. RLS UPDATE for new approval columns ───────────────────────
-- Admin can update any request (approve/reject); existing policy covers this.
-- No additional policies needed — existing inventory_requests_update handles it.
