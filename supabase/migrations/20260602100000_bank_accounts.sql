-- Bank accounts table — stores company bank accounts selectable during invoice creation.
-- Admins can add/deactivate; all authenticated users can read active accounts.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name     text        NOT NULL,
  account_number text       NOT NULL,
  account_name  text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read bank accounts (needed for invoice creation)
CREATE POLICY "Authenticated users can read bank accounts"
  ON bank_accounts FOR SELECT
  TO authenticated
  USING (true);

-- Admins can insert / update / delete
CREATE POLICY "Admins can manage bank accounts"
  ON bank_accounts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'
    )
  );

-- Seed the first account
INSERT INTO bank_accounts (bank_name, account_number, account_name, sort_order)
VALUES ('Zenith Bank', '1015041015', 'Sizzling Spices', 0)
ON CONFLICT DO NOTHING;
