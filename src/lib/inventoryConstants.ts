// Inventory categories for catering business
export const INVENTORY_CATEGORIES = [
  { value: 'proteins', label: 'Proteins', description: 'Meat, poultry, fish, eggs' },
  { value: 'raw_materials', label: 'Raw Materials', description: 'Basic ingredients and supplies' },
  { value: 'perishables', label: 'Perishables', description: 'Fresh produce, dairy, items with short shelf life' },
  { value: 'packaging', label: 'Packaging', description: 'Containers, wraps, boxes, bags' },
  { value: 'gas', label: 'Gas', description: 'Cooking gas, propane cylinders' },
  { value: 'coal', label: 'Coal', description: 'Charcoal, firewood' },
  { value: 'consumables', label: 'Consumables', description: 'Disposables, cleaning supplies, paper products' },
] as const;

export const UNITS_OF_MEASURE = [
  'kg', 'g', 'lb', 'oz', 'bag', 'pack', 'piece', 'skewer', 
  'liter', 'ml', 'cup', 'tray', 'box', 'carton', 'cylinder', 'roll'
] as const;

export type InventoryCategory = typeof INVENTORY_CATEGORIES[number]['value'];
export type UnitOfMeasure = typeof UNITS_OF_MEASURE[number];

// Category colors for visual distinction
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  proteins: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  raw_materials: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  perishables: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  packaging: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  gas: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  coal: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
  consumables: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
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
};

export const movementMeta = (t: string) =>
  MOVEMENT_META[t] ?? { label: t, cls: "bg-muted text-muted-foreground border-border" };
