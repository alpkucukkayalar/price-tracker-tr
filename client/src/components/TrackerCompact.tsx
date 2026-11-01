import { Link } from 'react-router-dom'
import type { Tracker } from '../types'
import ProductThumb from './ProductThumb'
import { formatMoney } from '../lib/money'
import { detectRetailer, RETAILER_META } from '../lib/campaign'
import { t } from '../lib/i18n'

const statusDot = (s: string) =>
  s === 'active' ? 'bg-success' : s === 'paused' ? 'bg-text-muted' : s === 'purchased' ? 'bg-primary' : 'bg-danger'

function storeLabel(tr: Tracker) {
  const r = detectRetailer(tr.best_seller_url || tr.url)
  return r ? RETAILER_META[r] : null
}

/** "Küçük simgeler": image tile with name + price, many per row. */
export function TrackerTile({ tracker, minPrice }: { tracker: Tracker; minPrice: number | null }) {
  const atLow = minPrice != null && tracker.last_price != null && Math.abs(tracker.last_price - minPrice) < 0.01
  return (
    <Link
      to={`/tracker/${tracker.id}`}
      className="group relative flex flex-col items-center text-center bg-surface border border-border rounded-xl p-3 hover:border-primary/50 transition-all no-underline"
      title={tracker.name}
    >
      <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${statusDot(tracker.status)}`} />
      <ProductThumb url={tracker.image_url} size={88} />
      <div className="mt-2 text-xs text-text line-clamp-2 min-h-[2rem] w-full">{tracker.name}</div>
      <div className={`mt-1 text-sm font-bold ${atLow ? 'text-success' : 'text-text'}`}>
        {tracker.last_price != null ? formatMoney(tracker.last_price) : '--'}
      </div>
    </Link>
  )
}

/** "Liste": one dense row per product. */
export function TrackerRow({ tracker, minPrice }: { tracker: Tracker; minPrice: number | null }) {
  const store = storeLabel(tracker)
  const atLow = minPrice != null && tracker.last_price != null && Math.abs(tracker.last_price - minPrice) < 0.01
  return (
    <Link
      to={`/tracker/${tracker.id}`}
      className="flex items-center gap-3 px-3 py-2 hover:bg-surface-hover no-underline"
    >
      <ProductThumb url={tracker.image_url} size={36} />
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(tracker.status)}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text truncate">{tracker.name}</div>
        {store && <div className="text-[11px] truncate" style={{ color: store.color }}>{store.label}</div>}
      </div>
      {minPrice != null && (
        <div className="hidden sm:block text-xs text-text-muted whitespace-nowrap">
          {t('Low:')} <span className={atLow ? 'text-success' : 'text-text'}>{formatMoney(minPrice)}</span>
        </div>
      )}
      <div className={`text-sm font-bold whitespace-nowrap ${atLow ? 'text-success' : 'text-text'}`}>
        {tracker.last_price != null ? formatMoney(tracker.last_price) : '--'}
      </div>
    </Link>
  )
}
