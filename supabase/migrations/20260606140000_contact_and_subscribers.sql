-- ─────────────────────────────────────────────────────────────────────────────
-- Public contact messages + newsletter subscribers
--
-- • contact_messages: submissions from the public website contact form.
--     Anyone (anonymous visitors) may INSERT. Only admins may read / manage.
-- • subscribers: newsletter / mailing-list sign-ups.
--     Anyone may INSERT (subscribe). Only admins may read / manage / export.
--
-- No email is sent server-side — the owner views everything in the in-app inbox.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Contact messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  email       text        NOT NULL,
  phone       text,
  subject     text,
  message     text        NOT NULL,
  source      text        NOT NULL DEFAULT 'website',
  status      text        NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'read', 'replied', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status  ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anonymous visitors) may submit a message
DROP POLICY IF EXISTS "anyone can submit contact message" ON contact_messages;
CREATE POLICY "anyone can submit contact message"
  ON contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins may read / update / delete
DROP POLICY IF EXISTS "admins manage contact messages" ON contact_messages;
CREATE POLICY "admins manage contact messages"
  ON contact_messages FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );

-- ── Newsletter subscribers ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE,
  name            text,
  source          text        NOT NULL DEFAULT 'website',
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unsubscribed')),
  subscribed_at   timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone may subscribe
DROP POLICY IF EXISTS "anyone can subscribe" ON subscribers;
CREATE POLICY "anyone can subscribe"
  ON subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins may read / update / delete (view list, export, unsubscribe)
DROP POLICY IF EXISTS "admins manage subscribers" ON subscribers;
CREATE POLICY "admins manage subscribers"
  ON subscribers FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  );
