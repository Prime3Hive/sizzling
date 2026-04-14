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