/**
 * Display formatting for prices in notifications, digests and alert copy.
 *
 * DISPLAY_CURRENCY (env, read per call so tests can switch it):
 *   - 'TRY' (default for this Turkish fork): "1.299,99 TL"
 *   - 'USD': "$1299.99" — byte-identical to the upstream format
 *   - any other ISO code: Intl currency formatting
 */
export function displayCurrency(): string {
  return (process.env.DISPLAY_CURRENCY || 'TRY').toUpperCase();
}

export function formatMoney(value: number): string {
  const currency = displayCurrency();
  if (currency === 'USD') return `$${value.toFixed(2)}`;
  if (currency === 'TRY') {
    return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  }
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
