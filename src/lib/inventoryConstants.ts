// Inventory categories — the same names as the matching expense categories.
// The value stored in the database IS the label; the database normalises old
// spellings ("RAW MATERIALS", "Protein", "Procurement" …) onto this list.
export const INVENTORY_CATEGORIES = [
  { value: 'Proteins', label: 'Proteins', description: 'Chicken, beef, fish, prawns, gizzard, lamb, eggs' },
  { value: 'Fresh Produce', label: 'Fresh Produce', description: 'Peppers, tomatoes, onions, vegetables, herbs, plantain, yam, potatoes' },
  { value: 'Dry Goods & Seasonings', label: 'Dry Goods & Seasonings', description: 'Flour, oil, spices, sauces, sugar, butter, bread, rice' },
  { value: 'Packaging & Disposables', label: 'Packaging & Disposables', description: 'Packs, foil, cling film, takeaway, serviettes, toothpicks' },
  { value: 'Cooking Fuel', label: 'Cooking Fuel', description: 'Gas, charcoal' },
  { value: 'Cleaning & Hygiene', label: 'Cleaning & Hygiene', description: 'Detergent, hypo, hair nets, brushes' },
  { value: 'Finished Goods', label: 'Finished Goods', description: 'Made in production (snacks, sauces)' },
] as const;

// The fixed unit list. Pack sizes for an item are set up as pack units.
export const UNITS_OF_MEASURE = ['kg', 'litre', 'piece', 'pack', 'bag', 'carton'] as const;

export type InventoryCategory = typeof INVENTORY_CATEGORIES[number]['value'];
export type UnitOfMeasure = typeof UNITS_OF_MEASURE[number];

// Category colors for visual distinction
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Proteins': { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  'Fresh Produce': { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  'Dry Goods & Seasonings': { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  'Packaging & Disposables': { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  'Cooking Fuel': { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  'Cleaning & Hygiene': { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  'Finished Goods': { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
};

export const getCategoryColor = (category: string) => {
  return CATEGORY_COLORS[category] || { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
};

export const getCategoryLabel = (category: string) => {
  const cat = INVENTORY_CATEGORIES.find(c => c.value === category);
  return cat?.label || category;
};

// ── Stock movement presentation ───────────────────────────────────────────────
export const MOVEMENT_META: Record<string, { label: string; cls: string }> = {
  purchase:   { label: "Stock In",    cls: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800" },
  usage:      { label: "Usage",       cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" },
  sale:       { label: "Sale",        cls: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800" },
  adjustment: { label: "Adjustment",  cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800" },
  stock_take: { label: "Stock Take",  cls: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800" },
  transfer:   { label: "Transfer",    cls: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700" },
  reversal:   { label: "Reversal",    cls: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-300 dark:border-zinc-700" },
  return:     { label: "Return",      cls: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800" },
  production_issue:  { label: "Used in production", cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800" },
  production_output: { label: "Produced",           cls: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800" },
};

export const movementMeta = (t: string) =>
  MOVEMENT_META[t] ?? { label: t, cls: "bg-muted text-muted-foreground border-border" };
