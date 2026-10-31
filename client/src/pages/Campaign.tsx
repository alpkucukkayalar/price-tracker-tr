import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { getCampaignOverview } from '../api'
import type { CampaignOverview, CampaignVerdict, TurkishRetailer } from '../types'
import { formatMoney } from '../lib/money'
import { VERDICT_META, RETAILER_META, pctLabel } from '../lib/campaign'
import useTitle from '../useTitle'

type StoreFilter = 'all' | TurkishRetailer | 'other'

// Most actionable first: fakes and hikes on top.
const VERDICT_ORDER: CampaignVerdict[] = [
  'fake_discount', 'price_increased', 'inflated_discount', 'real_discount', 'no_discount', 'collecting', 'insufficient_data',
]

/**
 * Efsane Cuma overview: every tracker's campaign verdict on one page, with a
 * per-store filter (Trendyol / Hepsiburada / Amazon.com.tr / N11).
 */
export default function CampaignPage() {
  useTitle('Efsane Cuma')
  const [data, setData] = useState<CampaignOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [store, setStore] = useState<StoreFilter>('all')

  useEffect(() => {
    getCampaignOverview().then(setData).catch(e => setError(String(e?.message ?? e)))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return data.trackers
      .filter(t => store === 'all' || (store === 'other' ? t.retailer === null : t.retailer === store))
      .sort((a, b) => {
        const hikeA = a.analysis.preCampaignHikeWarning ? -1 : 0
        const hikeB = b.analysis.preCampaignHikeWarning ? -1 : 0
        return VERDICT_ORDER.indexOf(a.analysis.verdict) + hikeA - (VERDICT_ORDER.indexOf(b.analysis.verdict) + hikeB)
      })
  }, [data, store])

  if (error) return <div className="text-danger text-sm">{error}</div>
  if (!data) return <div className="text-text-muted text-sm">Yükleniyor…</div>

  const counts = new Map<StoreFilter, number>([['all', data.trackers.length]])
  for (const t of data.trackers) {
    const k: StoreFilter = t.retailer ?? 'other'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const phase = data.trackers[0]?.analysis.phase
  const daysLeft = data.trackers[0]?.analysis.daysUntilStart ?? 0
  const verdictCounts = new Map<CampaignVerdict, number>()
  for (const t of data.trackers) verdictCounts.set(t.analysis.verdict, (verdictCounts.get(t.analysis.verdict) ?? 0) + 1)
  const hikes = data.trackers.filter(t => t.analysis.preCampaignHikeWarning).length

  const chip = (key: StoreFilter, label: string) => (
    <button
      key={key}
      onClick={() => setStore(key)}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        store === key ? 'bg-primary text-white border-primary' : 'bg-surface border-border text-text-muted hover:text-text'
      }`}
    >
      {label} ({counts.get(key) ?? 0})
    </button>
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Flame className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold">{data.campaign.name}</h1>
      </div>
      <p className="text-sm text-text-muted mb-4">
        {data.campaign.start} – {data.campaign.end}
        {phase === 'before' && ` · başlangıca ${daysLeft} gün var`}
        {phase === 'during' && ' · kampanya sürüyor'}
        {phase === 'after' && ' · kampanya bitti'}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-sm">
        {phase === 'before' ? (
          <>
            <Summary label="Takip edilen ürün" value={data.trackers.length} />
            <Summary label="Zam tespit edilen" value={hikes} tone={hikes ? 'text-warning' : ''} />
            <Summary label="Veri toplanan" value={verdictCounts.get('collecting') ?? 0} />
            <Summary label="Kampanyaya kalan gün" value={daysLeft} />
          </>
        ) : (
          <>
            <Summary label="Gerçek indirim" value={verdictCounts.get('real_discount') ?? 0} tone="text-success" />
            <Summary label="Abartılı indirim" value={verdictCounts.get('inflated_discount') ?? 0} tone="text-warning" />
            <Summary label="Sahte indirim" value={verdictCounts.get('fake_discount') ?? 0} tone="text-danger" />
            <Summary
              label="İndirim yok / zam"
              value={(verdictCounts.get('no_discount') ?? 0) + (verdictCounts.get('price_increased') ?? 0)}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {chip('all', 'Tümü')}
        {(Object.keys(RETAILER_META) as TurkishRetailer[]).map(r => chip(r, RETAILER_META[r].label))}
        {(counts.get('other') ?? 0) > 0 && chip('other', 'Diğer')}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-text-muted">
          Bu mağazadan takip edilen ürün yok. <Link to="/add">Ürün ekle</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(t => {
            const a = t.analysis
            const meta = a.preCampaignHikeWarning
              ? { label: 'Zam tespit edildi', tone: VERDICT_META.inflated_discount.tone, emoji: '⚠️' }
              : VERDICT_META[a.verdict]
            return (
              <Link
                key={t.id}
                to={`/tracker/${t.id}`}
                className="block bg-surface border border-border rounded-xl p-3 sm:p-4 no-underline text-text hover:border-primary transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {t.retailer && (
                    <span className="text-[11px] font-medium" style={{ color: RETAILER_META[t.retailer].color }}>
                      {RETAILER_META[t.retailer].label}
                    </span>
                  )}
                  <span className="font-medium truncate min-w-0 flex-1">{t.name}</span>
                  <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${meta.tone}`}>
                    {meta.emoji} {meta.label}
                  </span>
                </div>
                <div className="mt-1 text-xs text-text-muted flex flex-wrap gap-x-4 gap-y-1">
                  <span>Şimdi: {t.last_price !== null ? formatMoney(t.last_price) : '—'}</span>
                  <span>30g en düşük: {a.reference30dLow !== null ? formatMoney(a.reference30dLow) : '—'}</span>
                  {a.runupPct !== null && a.runupPct > 0 && <span>Önceden zam: +{pctLabel(a.runupPct)}</span>}
                  {a.claimedDiscountPct !== null && <span>İddia: {pctLabel(a.claimedDiscountPct)}</span>}
                  {a.realDiscountPct !== null && (
                    <span>Gerçek: {a.realDiscountPct < 0 ? `-${pctLabel(a.realDiscountPct)}` : pctLabel(a.realDiscountPct)}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Summary({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  )
}
