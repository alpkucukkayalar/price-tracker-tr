import { TR } from './i18n-tr'

/**
 * UI language. VITE_LANG (build-time): 'tr' (default for this fork) or 'en'.
 * Tests pin 'en' in vite.config.ts so upstream English assertions still hold.
 */
const LANG = ((import.meta.env.VITE_LANG as string | undefined) || 'tr').toLowerCase()

export function uiLang(): string {
  return LANG
}

/** Translate an English UI string; unknown strings fall back to English. */
export function t(s: string): string {
  if (LANG !== 'tr') return s
  return TR[s] ?? s
}

/** Locale for dates/numbers in the UI. */
export function uiLocale(): string {
  return LANG === 'tr' ? 'tr-TR' : 'en-US'
}

/** "5m ago" / "5 dk önce" style relative label. */
export function ago(value: number, unit: 'm' | 'h' | 'd'): string {
  if (LANG !== 'tr') return `${value}${unit} ago`
  const u = unit === 'm' ? 'dk' : unit === 'h' ? 'sa' : 'gün'
  return `${value} ${u} önce`
}

/** English plural "s" suffix; Turkish nouns stay singular after a number. */
export function pl(n: number): string {
  return LANG !== 'tr' && n !== 1 ? 's' : ''
}

/** Inline English/Turkish pair for sentences with interpolated values. */
export function tl(en: string, tr: string): string {
  return LANG === 'tr' ? tr : en
}
