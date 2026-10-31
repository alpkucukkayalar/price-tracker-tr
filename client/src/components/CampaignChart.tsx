import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Legend,
} from 'recharts'
import type { CampaignAnalysis, CampaignDailyRow } from '../types'
import { formatMoney, formatMoneyAxis } from '../lib/money'

interface Props {
  history: CampaignDailyRow[]
  analysis: CampaignAnalysis
}

function shortDate(d: string): string {
  const [, m, day] = d.split('-')
  return `${day}.${m}`
}

/**
 * Daily lowest price vs the retailer's struck-through "original" price, with
 * the campaign window shaded and the 30-day reference low drawn as a line.
 * A fake discount shows up as a hump right before the shaded area.
 */
export default function CampaignChart({ history, analysis }: Props) {
  if (history.length === 0) return null
  const data = history.map(r => ({ ...r, label: shortDate(r.date) }))
  const values = history.flatMap(r => (r.listPrice ? [r.price, r.listPrice] : [r.price]))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min) * 0.1 || Math.max(1, max * 0.05)
  const { campaign } = analysis
  const inData = (d: string) => history.some(r => r.date === d)
  const firstCampaignDay = history.find(r => r.date >= campaign.start && r.date <= campaign.end)?.date
  const lastCampaignDay = [...history].reverse().find(r => r.date >= campaign.start && r.date <= campaign.end)?.date

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis
          domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
          tickFormatter={(v: number) => formatMoneyAxis(v)}
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          width={80}
        />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          formatter={(value: unknown, name: unknown) => [formatMoney(Number(value)), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {firstCampaignDay && lastCampaignDay && inData(firstCampaignDay) && (
          <ReferenceArea
            x1={shortDate(firstCampaignDay)}
            x2={shortDate(lastCampaignDay)}
            fill="#6366f1"
            fillOpacity={0.15}
            label={{ value: campaign.name, fill: '#a5b4fc', fontSize: 11, position: 'insideTop' }}
          />
        )}
        {analysis.reference30dLow !== null && (
          <ReferenceLine
            y={analysis.reference30dLow}
            stroke="#10b981"
            strokeDasharray="4 4"
            label={{ value: '30 gün en düşük', fill: '#10b981', fontSize: 11, position: 'insideBottomLeft' }}
          />
        )}
        <Line type="stepAfter" dataKey="price" name="Günlük en düşük fiyat" stroke="#f1f5f9" strokeWidth={2} dot={false} />
        <Line
          type="stepAfter"
          dataKey="listPrice"
          name="Sitenin üstü çizili fiyatı"
          stroke="#ef4444"
          strokeDasharray="5 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
