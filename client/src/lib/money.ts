/**
 * Price display for the whole UI. VITE_DISPLAY_CURRENCY (build-time):
 *   - 'TRY' (default for this Turkish fork): "1.299,99 TL"
 *   - 'USD': "$1299.99" — the upstream format
 * Tests pin USD in vite.config.ts so upstream assertions keep passing.
 */
const CURRENCY = ((import.meta.env.VITE_DISPLAY_CURRENCY as string | undefined) || 'TRY').toUpperCase()

export function displayCurrency(): string {
  return CURRENCY
}

export function formatMoney(value: number): string {
  if (CURRENCY === 'USD') return `$${value.toFixed(2)}`
  if (CURRENCY === 'TRY') {
    return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
  }
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency: CURRENCY })
  } catch {
    return `${value.toFixed(2)} ${CURRENCY}`
  }
}

/** Compact axis label: "1.299 TL" / "$1299". */
export function formatMoneyAxis(value: number): string {
  if (CURRENCY === 'USD') return `$${value}`
  if (CURRENCY === 'TRY') return `${Math.round(value).toLocaleString('tr-TR')} TL`
  return formatMoney(value)
}
