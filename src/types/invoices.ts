export type InvoiceType = 'daily_sales' | 'event';
export type InvoiceStatus = 'quotation' | 'invoice' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  sku_id: string | null;
  description: string;
  /** Multi-line list of sub-items included in this cost (event invoices) */
  item_details: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  sort_order: number;
  created_at: string;
}

export interface Invoice {
  id: string;
  user_id: string;
  quotation_number: string;
  invoice_number: string | null;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  event_name: string | null;
  event_date: string | null;
  event_venue: string | null;
  number_of_guests: number | null;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  tax_percent: number;
  tax_amount: number;
  service_charge_percent: number;
  service_charge_amount: number;
  /** Waiter cost is factored into total_amount */
  waiter_required: boolean;
  number_of_waiters: number | null;
  cost_per_waiter: number | null;
  waiter_total: number;
  total_amount: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  issue_date: string;
  valid_until: string | null;
  converted_at: string | null;
  notes: string | null;
  terms: string | null;
  /** Bank account details for client payment */
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  recorded_in_finance: boolean;
  finance_recorded_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  items?: InvoiceItem[];
}

export interface InvoiceFormItem {
  description: string;
  /** Bullet-point list of sub-items included at this price (event only) */
  item_details: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  product_id: string;
  sku_id: string;
}

export interface InvoiceFormData {
  invoice_type: InvoiceType;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  event_name: string;
  event_date: string;
  event_venue: string;
  number_of_guests: string;
  issue_date: string;
  valid_until: string;
  discount_percent: string;
  tax_percent: string;
  service_charge_percent: string;
  waiter_required: boolean;
  number_of_waiters: string;
  cost_per_waiter: string;
  notes: string;
  terms: string;
  account_name: string;
  account_number: string;
  bank_name: string;
}

export const makeBlankItem = (): InvoiceFormItem => ({
  description: '',
  item_details: '',
  quantity: 1,
  unit: 'lot',
  unit_price: 0,
  total_price: 0,
  product_id: '',
  sku_id: '',
});

export const DEFAULT_TERMS =
  'Payment is due within 30 days of invoice date. Prices are valid for 14 days from the date of quotation.';

export const UNITS = ['lot', 'pcs', 'kg', 'g', 'L', 'mL', 'plate', 'portion', 'head', 'hr', 'day'];

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  cancelled: 'Cancelled',
};

export const TYPE_LABELS: Record<InvoiceType, string> = {
  daily_sales: 'Daily Sales',
  event: 'Event',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
};
