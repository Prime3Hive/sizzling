import type { Database as Generated } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Hand-written table types for tables that ./types.ts does not yet know about.
//
// ./types.ts is generated from the live database and has drifted a long way
// behind the migrations. The gap is not cosmetic: because the generated
// Database type has no entry for a table, `.from('contact_messages')` does not
// type-check, so every call site reaches for `(supabase as any)` — and an
// `any` client will happily compile a query against a table that does not
// exist anywhere. That is exactly how the contact form shipped writing into a
// table nobody had created: nothing failed until a visitor pressed Send.
//
// Each entry below is transcribed from the migration that owns the table, and
// is a stopgap. When ./types.ts is regenerated (`npm run types:supabase`, see
// docs/SUPABASE-TYPES.md) any table that reappears there should be deleted
// from this file — the generated definition always wins.
//
//   contact_messages, subscribers
//     └── supabase/migrations/20260606140000_contact_and_subscribers.sql
// ─────────────────────────────────────────────────────────────────────────────

export type ContactMessageStatus = 'new' | 'read' | 'replied' | 'archived';
export type SubscriberStatus = 'active' | 'unsubscribed';

type ExtraTables = {
  contact_messages: {
    Row: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      subject: string | null;
      message: string;
      source: string;
      status: ContactMessageStatus;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      name: string;
      email: string;
      phone?: string | null;
      subject?: string | null;
      message: string;
      source?: string;
      status?: ContactMessageStatus;
      created_at?: string;
      updated_at?: string;
    };
    Update: {
      id?: string;
      name?: string;
      email?: string;
      phone?: string | null;
      subject?: string | null;
      message?: string;
      source?: string;
      status?: ContactMessageStatus;
      created_at?: string;
      updated_at?: string;
    };
    Relationships: [];
  };
  subscribers: {
    Row: {
      id: string;
      email: string;
      name: string | null;
      source: string;
      status: SubscriberStatus;
      subscribed_at: string;
      unsubscribed_at: string | null;
    };
    Insert: {
      id?: string;
      email: string;
      name?: string | null;
      source?: string;
      status?: SubscriberStatus;
      subscribed_at?: string;
      unsubscribed_at?: string | null;
    };
    Update: {
      id?: string;
      email?: string;
      name?: string | null;
      source?: string;
      status?: SubscriberStatus;
      subscribed_at?: string;
      unsubscribed_at?: string | null;
    };
    Relationships: [];
  };
};

/** The generated schema plus the tables above. This is what the client uses. */
export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Tables'> & {
    Tables: Generated['public']['Tables'] & ExtraTables;
  };
};
