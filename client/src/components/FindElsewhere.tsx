import { useState } from 'react'
import { Search, Plus, Check, ExternalLink } from 'lucide-react'
import { findElsewhere, addTrackerUrl, type FindElsewhereResult } from '../api'
import type { TrackerUrl } from '../types'
import { RETAILER_META } from '../lib/campaign'
import { formatMoney } from '../lib/money'
import { tl } from '../lib/i18n'

interface Props {
  trackerId: number
  trackerName: string
  /** Called with the refreshed seller list after a candidate is added. */
  onAdded: (sellers: TrackerUrl[]) => void
}

/**
 * "Diğer sitelerde bul": searches Trendyol / Amazon.com.tr / N11 for the same
 * product and lets the user add the right match as a seller in one click.
 * Nothing is added automatically — variants and bundles share names.
 */
export default function FindElsewhere({ trackerId, trackerName, onAdded }: Props) {
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<FindElsewhereResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await findElsewhere(trackerId, query.trim() || undefined)
      setData(res)
      if (!query.trim()) setQuery(res.query)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = async (url: string) => {
    setAdding(url)
    setError(null)
    try {
      const sellers = await addTrackerUrl(trackerId, url, 'new')
      setAdded(prev => new Set(prev).add(url))
      onAdded(sellers)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tl(`Search other stores (default: ${trackerName})`, `Diğer sitelerde ara (boş bırakırsan: ürün adı)`)}
          className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted/50 focus:outline-none focus:border-primary"
          onKeyDown={e => { if (e.key === 'Enter') run() }}
        />
        <button
          onClick={run}
          disabled={busy}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-surface border border-primary text-primary hover:bg-primary hover:text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {busy ? tl('Searching (≈30 s)...', 'Aranıyor (≈30 sn)...') : tl('Find on other stores', 'Diğer sitelerde bul')}
        </button>
      </div>

      {error && <div className="mt-2 text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</div>}

      {data && (
        <div className="mt-3 space-y-3">
          {data.results.length === 0 && (
            <p className="text-sm text-text-muted">{tl('This product is already tracked on every searchable store.', 'Bu ürün aranabilen tüm sitelerde zaten takipte.')}</p>
          )}
          {data.results.map(r => (
            <div key={r.retailer}>
              <div className="text-xs font-semibold mb-1" style={{ color: RETAILER_META[r.retailer].color }}>
                {RETAILER_META[r.retailer].label}
              </div>
              {r.error ? (
                <p className="text-xs text-text-muted">{tl('Could not search this store', 'Bu sitede arama yapılamadı')}: {r.error.slice(0, 120)}</p>
              ) : r.candidates.length === 0 ? (
                <p className="text-xs text-text-muted">{tl('No similar product found.', 'Benzer ürün bulunamadı.')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {r.candidates.map(c => (
                    <li key={c.url} className="py-2 flex items-center gap-3">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm hover:text-primary">
                        <span className="line-clamp-2">{c.title}</span>
                        <ExternalLink className="inline w-3 h-3 ml-1 opacity-60" />
                      </a>
                      <span className="text-sm font-semibold whitespace-nowrap">{c.price !== null ? formatMoney(c.price) : '—'}</span>
                      <button
                        onClick={() => add(c.url)}
                        disabled={adding !== null || added.has(c.url)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-xs font-medium disabled:opacity-50"
                      >
                        {added.has(c.url) ? <><Check className="w-3 h-3" /> {tl('Added', 'Eklendi')}</> : <><Plus className="w-3 h-3" /> {adding === c.url ? '...' : tl('Add', 'Ekle')}</>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
