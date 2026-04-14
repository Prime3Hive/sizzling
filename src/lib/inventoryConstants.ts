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
