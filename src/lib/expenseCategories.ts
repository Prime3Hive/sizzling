// The approved expense categories and the ledger account each one posts to.
//
// The live list is the database table public.expense_categories (read through
// useExpenseCategories); this copy exists for suggestions and tests. The
// database rejects any category not on its list, so the two cannot drift
// silently: a name here that the table lacks simply fails to save.

export const EXPENSE_CATEGORY_LIST = [
  { name: 'Proteins',                        account: '5000' },
  { name: 'Fresh Produce',                   account: '5000' },
  { name: 'Dry Goods & Seasonings',          account: '5000' },
  { name: 'Packaging & Disposables',         account: '5000' },
  { name: 'Cooking Fuel',                    account: '5000' },
  { name: 'Kitchen Labour',                  account: '5050' },
  { name: 'Event Labour',                    account: '5050' },
  { name: 'Event Logistics',                 account: '5050' },
  { name: 'Transport & Delivery',            account: '5400' },
  { name: 'Vehicle Repairs & Maintenance',   account: '5400' },
  { name: 'Premises Repairs & Maintenance',  account: '5400' },
  { name: 'Cleaning & Hygiene',              account: '5400' },
  { name: 'Kitchen Tools & Small Equipment', account: '5400' },
  { name: 'Office & Admin',                  account: '5400' },
  { name: 'Commissions',                     account: '5120' },
  { name: 'Imports & Shipping',              account: '5400' },
  { name: 'Bank Charges',                    account: '5400' },
  { name: 'Miscellaneous',                   account: '5900' },
] as const;

export type ExpenseCategoryName = typeof EXPENSE_CATEGORY_LIST[number]['name'];

// Same order and patterns as SQL fn_guess_expense_category.
const RULES: [RegExp, ExpenseCategoryName][] = [
  [/(bank charge|pos charge|transfer charge|sms alert|stamp duty|maintenance fee)/, 'Bank Charges'],
  [/(commission|njc)/, 'Commissions'],
  [/(import|freight|shipping|clearing)/, 'Imports & Shipping'],
  [/(waiter|usher|event staff|chef)/, 'Event Labour'],
  [/(cook|chopping|helper|moi ?moi maker|snack maker|labou?r)/, 'Kitchen Labour'],
  [/(canopy|chair|tent|hire|venue|decor)/, 'Event Logistics'],
  [/(vulcani|mechanic|tyre|tire|engine oil|bus repair|bike repair|car repair)/, 'Vehicle Repairs & Maintenance'],
  [/(plumb|security room|building|carpent|electrician|paint|roof)/, 'Premises Repairs & Maintenance'],
  [/(detergent|hypo|bleach|soap|hair ?net|brush|sponge|disinfect|saniti|mop|broom|glove)/, 'Cleaning & Hygiene'],
  [/(sieve|chopping board|drum|sealing machine|knife|cooler|bowl|basin|\bpot\b)/, 'Kitchen Tools & Small Equipment'],
  [/(stationer|airtime|\bdata\b|printing|paper|ink)/, 'Office & Admin'],
  [/(\bgas\b|charcoal|coal|firewood)/, 'Cooking Fuel'],
  [/(fuel|petrol|keke|bolt|uber|rider|pick ?up|barrow|transport|delivery|okada|bus fare)/, 'Transport & Delivery'],
  [/(chicken|beef|fish|prawn|shrimp|gizzard|lamb|goat|\begg|turkey|croaker|kidney|liver|meat|sausage|snail|catfish|mackerel|titus|tilapia|panla|ponmo|cow ?leg|offal)/, 'Proteins'],
  [/(pack|foil|cling|takeaway|take away|serviette|toothpick|nylon|container|plate|spoon|fork|straw|wrap|disposable)/, 'Packaging & Disposables'],
  [/(pepper|tomato|onion|cabbage|carrot|herb|parsley|plantain|\byam|potato|lettuce|cucumber|garlic|ginger|scent leaf|ugwu|spinach|vegetable|lemon|lime|fruit|coriander|spring onion|green beans)/, 'Fresh Produce'],
  [/(flour|\boil\b|spice|sauce|sugar|butter|bread|rice|beans|salt|seasoning|maggi|knorr|curry|thyme|pasta|spaghetti|noodle|milk|cream|mayonnaise|ketchup|vinegar|crayfish|semovita|garri|egusi|ogbono)/, 'Dry Goods & Seasonings'],
];

/** Suggest a category from free text (item names, descriptions), or null. */
export function guessExpenseCategory(text: string | null | undefined): ExpenseCategoryName | null {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return null;
  for (const [re, name] of RULES) if (re.test(t)) return name;
  return null;
}
