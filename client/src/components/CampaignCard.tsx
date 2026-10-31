import { lazy, Suspense, useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { getTrackerCampaign } from '../api'
import type { Tracker, TrackerCampaign } from '../types'
import { formatMoney } from '../lib/money'
import { VERDICT_META, RETAILER_META, pctLabel } from '../lib/campaign'

const CampaignChart = lazy(() => import('./CampaignChart'))

interface Props {
  tracker: Tracker
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={`font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

/**
 * Efsane Cuma / Black Friday analysis: did the campaign price really drop
 * below the lowest price of the previous 30 days, or was the price hiked in
 * the run-up and then "discounted" back?
 */
export function CampaignCard({ tracker }: Props) {
  const [data, setData] = useState<TrackerCampaign | null>(null)

  useEffect(() => {
    let cancelled = false
    getTrackerCampaign(tracker.id)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { /* optional card */ })
    return () => { cancelled = true }
  }, [tracker.id, tracker.last_price])

  if (!data || data.history.length === 0) return null
  const a = data.analysis
  const meta = VERDICT_META[a.verdict]
  const showHike = a.preCampaignHikeWarning
  const tone = showHike ? VERDICT_META.inflated_discount.tone : meta.tone

  return (
    <div className="bg-surface border border-border rounded-xl p-4 sm:p-6 mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">{a.campaign.name} analizi</h2>
        {data.retailer && (
          <span
            className="text-xs font-medium rounded-full px-2 py-0.5"
            style={{ background: `${RETAILER_META[data.retailer].color}22`, color: RETAILER_META[data.retailer].color }}
          >
            {RETAILER_META[data.retailer].label}
          </span>
        )}
        <span className={`ml-auto text-xs font-semibold rounded-full px-2.5 py-1 ${tone}`}>
          {showHike ? '⚠️ Zam tespit edildi' : `${meta.emoji} ${meta.label}`}
        </span>
      </div>

      <p className="text-sm mb-4">{a.headline}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
        <Stat label="30 gün en düşük (referans)" value={a.reference30dLow !== null ? formatMoney(a.reference30dLow) : '—'} />
        <Stat
          label="Kampanya öncesi zam"
          value={a.runupPct !== null && a.runupPct > 0 ? `+${pctLabel(a.runupPct)}` : '—'}
          tone={a.runupPct !== null && a.runupPct >= 0.05 ? 'text-danger' : ''}
        />
        <Stat
          label="Sitenin iddia ettiği"
          value={a.claimedDiscountPct !== null ? pctLabel(a.claimedDiscountPct) : '—'}
        />
        <Stat
          label="Gerçek indirim"
          value={
            a.realDiscountPct === null ? '—' : a.realDiscountPct < 0 ? `-${pctLabel(a.realDiscountPct)} (zam)` : pctLabel(a.realDiscountPct)
          }
          tone={a.realDiscountPct === null ? '' : a.realDiscountPct >= 0.03 ? 'text-success' : 'text-danger'}
        />
      </div>

      <Suspense fallback={<div className="h-60" />}>
        <CampaignChart history={data.history} analysis={a} />
      </Suspense>

      {a.details.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-text-muted list-disc pl-4">
          {a.details.map(d => <li key={d}>{d}</li>)}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-text-muted">
        Referans: kampanyadan önceki 30 günün en düşük fiyatı (Ticaret Bakanlığı indirim kuralı). Kampanya:{' '}
        {a.campaign.start} – {a.campaign.end}.
      </p>
    </div>
  )
}
