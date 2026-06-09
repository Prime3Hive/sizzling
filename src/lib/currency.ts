// Nigerian Naira currency formatting utilities

export const formatNaira = (amount: number): string => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(amount);
};

export const formatNairaCompact = (amount: number): string => {
  const formatted = formatNaira(amount);
  return formatted.replace('NGN', '₦');
};

/**
 * Abbreviated Naira for dense dashboards / chart axes / KPI sub-labels.
 * e.g. 1_250_000 → "₦1.3m", 42_000 → "₦42k", 850 → "₦850", -5000 → "-₦5k".
 */
export const formatNairaShort = (amount: number): string => {
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000)     return `${sign}₦${(abs / 1_000).toFixed(0)}k`;
  return `${sign}₦${abs.toFixed(0)}`;
};