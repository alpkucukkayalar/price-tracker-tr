import type { CampaignVerdict, TurkishRetailer } from '../types'

/** Turkish label + Tailwind tone for each verdict. */
export const VERDICT_META: Record<CampaignVerdict, { label: string; tone: string; emoji: string }> = {
  collecting: { label: 'Veri toplanıyor', tone: 'text-text-muted bg-surface-hover', emoji: '⏳' },
  insufficient_data: { label: 'Yetersiz veri', tone: 'text-text-muted bg-surface-hover', emoji: '❔' },
  real_discount: { label: 'Gerçek indirim', tone: 'text-success bg-success/10', emoji: '✅' },
  inflated_discount: { label: 'Abartılı indirim', tone: 'text-warning bg-warning/10', emoji: '⚠️' },
  fake_discount: { label: 'Sahte indirim', tone: 'text-danger bg-danger/10', emoji: '🚩' },
  no_discount: { label: 'İndirim yok', tone: 'text-text-muted bg-surface-hover', emoji: '➖' },
  price_increased: { label: 'Fiyat arttı', tone: 'text-danger bg-danger/10', emoji: '📈' },
}

export const RETAILER_META: Record<TurkishRetailer, { label: string; color: string }> = {
  trendyol: { label: 'Trendyol', color: '#f27a1a' },
  hepsiburada: { label: 'Hepsiburada', color: '#ff6000' },
  amazon_tr: { label: 'Amazon.com.tr', color: '#ff9900' },
  n11: { label: 'N11', color: '#7849f7' },
}

/** Client-side mirror of server detectTurkishRetailer (for cards/filters). */
export function detectRetailer(url: string): TurkishRetailer | null {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`)
  if (is('trendyol.com') || host === 'ty.gl') return 'trendyol'
  if (is('hepsiburada.com') || host === 'hb.biz') return 'hepsiburada'
  if (is('amazon.com.tr')) return 'amazon_tr'
  if (is('n11.com')) return 'n11'
  return null
}

export function pctLabel(x: number | null): string {
  return x === null ? '—' : `%${Math.round(Math.abs(x) * 100)}`
}
