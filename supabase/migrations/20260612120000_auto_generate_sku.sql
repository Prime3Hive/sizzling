-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-generated, unique product SKUs
--
-- Every product gets a system SKU (SKU-00001, SKU-00002, …) on insert when one
-- isn't supplied. Uniqueness is enforced case-insensitively. Works for every
-- creation path (Inventory form, procurement quick-create, etc.).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.product_sku_seq;

CREATE OR REPLACE FUNCTION public.fn_generate_product_sku()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE candidate text;
BEGIN
  IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
    LOOP
      candidate := 'SKU-' || lpad(nextval('public.product_sku_seq')::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.products WHERE lower(sku) = lower(candidate));
    END LOOP;
    NEW.sku := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_product_sku ON public.products;
CREATE TRIGGER trg_generate_product_sku
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_generate_product_sku();

-- Backfill: give a SKU to products that have none
DO $$
DECLARE r record; candidate text;
BEGIN
  FOR r IN SELECT id FROM public.products WHERE sku IS NULL OR btrim(sku) = '' LOOP
    LOOP
      candidate := 'SKU-' || lpad(nextval('public.product_sku_seq')::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.products WHERE lower(sku) = lower(candidate));
    END LOOP;
    UPDATE public.products SET sku = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- De-duplicate any pre-existing duplicate SKUs before enforcing uniqueness
DO $$
DECLARE r record; candidate text;
BEGIN
  FOR r IN
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY lower(sku) ORDER BY created_at) AS rn
      FROM public.products WHERE sku IS NOT NULL
    ) t WHERE t.rn > 1
  LOOP
    LOOP
      candidate := 'SKU-' || lpad(nextval('public.product_sku_seq')::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.products WHERE lower(sku) = lower(candidate));
    END LOOP;
    UPDATE public.products SET sku = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- Enforce case-insensitive uniqueness for non-null SKUs
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique
  ON public.products (lower(sku)) WHERE sku IS NOT NULL;
