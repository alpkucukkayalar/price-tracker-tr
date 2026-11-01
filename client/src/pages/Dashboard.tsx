import GroupedBoard from '../components/GroupedBoard'
import { TrackerTile, TrackerRow } from '../components/TrackerCompact'
import { LayoutGrid, Grid3x3, List } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Package, RefreshCw } from 'lucide-react'
import { getTrackers, getTrackerStats, getSettings, getOverlapCounts, checkTracker } from '../api'
import type { TrackerStat } from '../api'
import type { Tracker } from '../types'
import TrackerCard from '../components/TrackerCard'
import CategoryCard from '../components/CategoryCard'
import StatCards from '../components/StatCards'
import WelcomeModal from '../components/WelcomeModal'
import DashboardToolbar from '../components/DashboardToolbar'
import useTitle from '../useTitle'
import { buildDashboardLayout, isErrored, isBelowTarget } from '../lib/dashboard-sort'
import { parseFilter, parseSort, filterTrackers, filterCounts, sortTrackers, FILTER_LABELS } from '../lib/dashboard-filter'
import { t, pl, tl } from '../lib/i18n'

type DashboardView = 'cards' | 'tiles' | 'list'
const VIEW_OPTIONS: { id: DashboardView; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'cards', label: tl('Cards', 'Kart'), icon: LayoutGrid },
  { id: 'tiles', label: tl('Icons', 'Küçük simge'), icon: Grid3x3 },
  { id: 'list', label: tl('List', 'Liste'), icon: List },
]

export default function Dashboard() {
  const [trackers, setTrackers] = useState<Tracker[]>([])
  const [stats, setStats] = useState<Record<string, TrackerStat>>({})
  const [notificationsConfigured, setNotificationsConfigured] = useState(true)
  const [view, setView] = useState<DashboardView>(() => {
    try {
      const v = localStorage.getItem('dashboard-view')
      return v === 'tiles' || v === 'list' ? v : 'cards'
    } catch {
      return 'cards'
    }
  })
  const changeView = (v: DashboardView) => {
    setView(v)
    try { localStorage.setItem('dashboard-view', v) } catch { /* private mode */ }
  }
  const [overlapCounts, setOverlapCounts] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [checkingAll, setCheckingAll] = useState(false)
  const [checkAllError, setCheckAllError] = useState<string | null>(null)

  // Filter/sort mode are URL-driven so a filtered view is shareable/
  // bookmarkable and survives a page refresh. Search text stays local
  // component state — it's transient, not something you'd want to link to.
  const filter = parseFilter(searchParams.get('filter'))
  const sort = searchParams.get('sort') !== null
    ? parseSort(searchParams.get('sort'))
    : (() => { try { return localStorage.getItem('dashboard-sort') === 'manual' ? 'manual' as const : 'smart' as const } catch { return 'smart' as const } })()
  useTitle(filter === 'all' ? t('Dashboard') : `Dashboard — ${FILTER_LABELS[filter]}`)

  const setParam = (key: 'filter' | 'sort', value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const load = async () => {
    try {
      const [data, trackerStats, settings, counts] = await Promise.all([getTrackers(), getTrackerStats(), getSettings(), getOverlapCounts()])
      setTrackers(data)
      setStats(trackerStats)
      setNotificationsConfigured(
        !!(settings.discord_webhook_url || settings.ntfy_url || settings.generic_webhook_url),
      )
      setOverlapCounts(counts)
    } catch (err) {
      console.error(t('Failed to load trackers'), err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Restores the "Check All Now" bulk re-check that lived on the standalone
  // /errors page before Task 3 folded it into the dashboard filter. Fans
  // out checkTracker() over every currently-errored tracker in parallel —
  // the server's PQueue caps real scrape concurrency, so firing them all at
  // once is safe. allSettled (not all()) so one failed re-check doesn't
  // abort the rest; every errored tracker gets a fresh attempt regardless.
  const handleCheckAll = async () => {
    const erroredTrackers = trackers.filter(isErrored)
    if (erroredTrackers.length === 0 || checkingAll) return
    setCheckingAll(true)
    setCheckAllError(null)
    try {
      const results = await Promise.allSettled(erroredTrackers.map(t => checkTracker(t.id)))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        setCheckAllError(tl(`${failed} tracker${pl(failed)} failed to refresh. Reloading anyway.`, `${failed} ürün yenilenemedi. Yine de sayfa yenileniyor.`))
      }
      await load()
    } finally {
      setCheckingAll(false)
    }
  }

  // Hooks must run on every render in the same order — keep these above
  // the loading/empty early returns. Both derivations are cheap (single
  // pass over the trackers array) so the wasted work on the loading
  // render is negligible compared with the bug a hooks-order mismatch
  // causes: React unmounts the whole tree and you get a blank page.
  const counts = useMemo(() => filterCounts(trackers), [trackers])
  const visibleTrackers = useMemo(
    () => sortTrackers(filterTrackers(trackers, filter, query), sort),
    [trackers, filter, query, sort],
  )

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted">{t('Loading...')}</div>
  }

  if (trackers.length === 0) {
    return (
      <>
        <WelcomeModal hasNoTrackers={true} />
        <div className="flex flex-col items-center justify-center h-80 gap-4">
          <Package className="w-16 h-16 text-text-muted/50" />
          <h2 className="text-xl font-semibold text-text">{t('No trackers yet')}</h2>
          <p className="text-text-muted">{t('Add a product URL to start tracking prices.')}</p>
          <Link
            to="/add"
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors no-underline"
          >
            <Plus className="w-4 h-4" />
            {t('Add Tracker')}
          </Link>
        </div>
      </>
    )
  }

  // Header counts describe the whole (non-purchased) collection, not the
  // currently narrowed view — a chip that filters the grid down to "Errors"
  // shouldn't also make the "X active" summary above it read as 0.
  const { totalErrored, totalActive } = buildDashboardLayout(trackers.filter(t => t.status !== 'purchased'))

  // "Smart" sort keeps the categorized/bucketed layout (errors first, then
  // below-target, then active, then paused, with same-domain overflow
  // collapsed into CategoryCards). Any explicit sort (price/recent/alpha)
  // overrides that grouping — the user asked for one specific order, so we
  // render a flat list instead of re-bucketing on top of it.
  const items = sort === 'smart'
    ? buildDashboardLayout(visibleTrackers).items
    : visibleTrackers.map(tracker => ({ kind: 'tracker' as const, tracker }))

  const flatTrackers = items.flatMap(item => (item.kind === 'tracker' ? [item.tracker] : item.trackers))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('Dashboard')}</h1>
          <p className="text-text-muted text-sm mt-1">
            {trackers.length} {t('tracker')}{pl(trackers.length)} &middot;{' '}
            {totalActive} {t('active')}
            {totalErrored > 0 && <span className="text-danger"> &middot; {totalErrored} {t('error')}{pl(totalErrored)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/add"
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium transition-colors no-underline"
          >
            <Plus className="w-4 h-4" />
            {t('Add Tracker')}
          </Link>
        </div>
      </div>

      <DashboardToolbar
        filter={filter}
        counts={counts}
        sort={sort}
        query={query}
        onQueryChange={setQuery}
        onFilterChange={f => setParam('filter', f, 'all')}
        onSortChange={s => { try { localStorage.setItem('dashboard-sort', s) } catch { /* private mode */ } setParam('sort', s, 'smart') }}
      />

      {filter === 'errors' && counts.errors > 0 && (
        <div className="flex justify-end mb-4">
          <button
            type="button"
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary hover:bg-primary/10 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checkingAll ? 'animate-spin' : ''}`} />
            {checkingAll ? `Checking ${counts.errors}...` : t('Check All Now')}
          </button>
        </div>
      )}

      {checkAllError && (
        <div className="mb-4 text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{checkAllError}</div>
      )}

      <StatCards trackers={trackers} counts={counts} onSelectFilter={f => setParam('filter', f, 'all')} />

      <div className="flex justify-end mb-3">
        <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group">
          {VIEW_OPTIONS.map(v => (
            <button
              key={v.id}
              onClick={() => changeView(v.id)}
              title={v.label}
              aria-pressed={view === v.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${view === v.id ? 'bg-primary text-white' : 'bg-surface text-text-muted hover:text-text'}`}
            >
              <v.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {sort === 'manual' && items.length > 0 ? (
        <GroupedBoard
          trackers={flatTrackers}
          view={view}
          renderItem={tr =>
            view === 'tiles' ? (
              <TrackerTile tracker={tr} minPrice={stats[tr.id]?.min_price ?? null} />
            ) : view === 'list' ? (
              <TrackerRow tracker={tr} minPrice={stats[tr.id]?.min_price ?? null} />
            ) : (
              <TrackerCard
                tracker={tr}
                sparklineData={stats[tr.id]?.sparkline || []}
                minPrice={stats[tr.id]?.min_price ?? null}
                onUpdate={load}
                notificationsConfigured={notificationsConfigured}
                overlapCount={overlapCounts[tr.id] ?? 0}
                isPurchased={tr.status === 'purchased'}
                glow={isBelowTarget(tr)}
              />
            )
          }
        />
      ) : items.length > 0 && view !== 'cards' ? (
        view === 'tiles' ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {flatTrackers.map(tr => (
              <TrackerTile key={tr.id} tracker={tr} minPrice={stats[tr.id]?.min_price ?? null} />
            ))}
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {flatTrackers.map(tr => (
              <TrackerRow key={tr.id} tracker={tr} minPrice={stats[tr.id]?.min_price ?? null} />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-text-muted text-sm">
          {t('No trackers match this filter —')} {FILTER_LABELS[filter]}.
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {items.map(item =>
            item.kind === 'tracker' ? (
              <TrackerCard
                key={`t-${item.tracker.id}`}
                tracker={item.tracker}
                sparklineData={stats[item.tracker.id]?.sparkline || []}
                minPrice={stats[item.tracker.id]?.min_price ?? null}
                onUpdate={load}
                notificationsConfigured={notificationsConfigured}
                overlapCount={overlapCounts[item.tracker.id] ?? 0}
                isPurchased={item.tracker.status === 'purchased'}
                glow={isBelowTarget(item.tracker)}
              />
            ) : (
              <CategoryCard
                key={`c-${item.hostname}`}
                hostname={item.hostname}
                trackers={item.trackers}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}
