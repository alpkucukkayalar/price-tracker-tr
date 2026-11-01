import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GripVertical, Pencil } from 'lucide-react'
import type { Tracker } from '../types'
import { saveDashboardLayout } from '../api'
import { tl } from '../lib/i18n'

const GROUP_COUNT = 3
const DEFAULT_NAMES = [tl('Priority', 'Öncelikli'), tl('Watching', 'Takipte'), tl('Later', 'Sonra bakarım')]
const NAMES_KEY = 'dashboard-group-names'

function loadNames(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]')
    return DEFAULT_NAMES.map((d, i) => (typeof raw[i] === 'string' && raw[i].trim() ? raw[i] : d))
  } catch {
    return DEFAULT_NAMES
  }
}

type Groups = number[][] // tracker ids per group, in display order

type Placement = Map<number, { group: number; order: number }>

function buildGroups(trackers: Tracker[], saved: Placement): Groups {
  const groups: Groups = Array.from({ length: GROUP_COUNT }, () => [])
  const pos = (tr: Tracker) => saved.get(tr.id) ?? { group: tr.dash_group ?? 0, order: tr.dash_order ?? 0 }
  const sorted = [...trackers].sort((a, b) => pos(a).order - pos(b).order || a.id - b.id)
  for (const tr of sorted) groups[Math.min(Math.max(pos(tr).group, 0), GROUP_COUNT - 1)].push(tr.id)
  return groups
}

interface Props {
  trackers: Tracker[]
  view: 'cards' | 'tiles' | 'list'
  renderItem: (tracker: Tracker) => ReactNode
}

/**
 * "Benim düzenim": three priority groups stacked vertically. Drag a product
 * to reorder it or move it to another group; the layout is saved to the
 * server so it is the same on every device. Inside a group, cards flow into
 * as many columns as the screen width allows (auto-fill).
 */
export default function GroupedBoard({ trackers, view, renderItem }: Props) {
  // Placements saved in this session win over the (possibly stale) tracker
  // props until the dashboard reloads its data.
  const savedRef = useRef<Placement>(new Map())
  const [groups, setGroups] = useState<Groups>(() => buildGroups(trackers, new Map()))
  const [names, setNames] = useState<string[]>(loadNames)
  const [dragId, setDragIdState] = useState<number | null>(null)
  // Ref mirrors the state so dragover/drop see the id before React re-renders.
  const dragRef = useRef<number | null>(null)
  const setDragId = (id: number | null) => { dragRef.current = id; setDragIdState(id) }
  const [over, setOver] = useState<{ group: number; index: number } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const idsKey = trackers.map(tr => `${tr.id}:${tr.dash_group ?? 0}:${tr.dash_order ?? 0}`).join(',')
  useEffect(() => { setGroups(buildGroups(trackers, savedRef.current)) }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(trackers.map(tr => [tr.id, tr]))

  const persist = async (next: Groups) => {
    next.forEach((ids, group) => ids.forEach((id, order) => savedRef.current.set(id, { group, order })))
    setGroups(next)
    try {
      await saveDashboardLayout(next.flatMap((ids, group) => ids.map((id, order) => ({ id, group, order }))))
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const drop = (group: number, index: number) => {
    const dragId = dragRef.current
    if (dragId === null) return
    const next = groups.map(g => g.filter(id => id !== dragId))
    const from = groups.findIndex(g => g.includes(dragId))
    const oldIndex = groups[from]?.indexOf(dragId) ?? -1
    // Dropping later in the same group: removing the card shifted the slots.
    const at = from === group && oldIndex !== -1 && oldIndex < index ? index - 1 : index
    next[group].splice(Math.min(at, next[group].length), 0, dragId)
    setDragId(null)
    setOver(null)
    void persist(next)
  }

  const rename = (i: number) => {
    const name = window.prompt(tl('Group name', 'Grup adı'), names[i])
    if (name === null) return
    const next = names.map((n, j) => (j === i ? name.trim() || DEFAULT_NAMES[i] : n))
    setNames(next)
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const gridStyle =
    view === 'cards'
      ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '1rem' }
      : view === 'tiles'
        ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }
        : { display: 'grid', gridTemplateColumns: '1fr', gap: '0' }

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">
          {tl('Could not save the layout', 'Düzen kaydedilemedi')}: {saveError}
        </div>
      )}
      {groups.map((ids, g) => (
        <section
          key={g}
          onDragOver={e => { if (dragRef.current !== null) { e.preventDefault(); if (!over || over.group !== g) setOver({ group: g, index: ids.length }) } }}
          onDrop={e => { e.preventDefault(); drop(g, over?.group === g ? over.index : ids.length) }}
          className={`rounded-xl border-2 border-dashed p-3 transition-colors ${over?.group === g ? 'border-primary/60 bg-primary/5' : 'border-transparent'}`}
        >
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{names[g]}</h2>
            <span className="text-xs text-text-muted">{ids.length}</span>
            <button onClick={() => rename(g)} className="text-text-muted hover:text-text" title={tl('Rename group', 'Grubu yeniden adlandır')}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
          {ids.length === 0 ? (
            <div className="text-xs text-text-muted py-6 text-center">
              {tl('Drag products here', 'Ürünleri buraya sürükle')}
            </div>
          ) : (
            <div style={gridStyle} className={view === 'list' ? 'bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden' : ''}>
              {ids.map((id, i) => {
                const tr = byId.get(id)
                if (!tr) return null
                const isOver = over?.group === g && over.index === i && dragId !== id
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={e => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)) }}
                    onDragEnd={() => { setDragId(null); setOver(null) }}
                    onDragOver={e => {
                      if (dragRef.current === null) return
                      e.preventDefault()
                      e.stopPropagation()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const after = view === 'list' ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2
                      const index = after ? i + 1 : i
                      if (!over || over.group !== g || over.index !== index) setOver({ group: g, index })
                    }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(g, over?.group === g ? over.index : i) }}
                    className={`relative cursor-grab active:cursor-grabbing ${dragId === id ? 'opacity-40' : ''} ${isOver ? 'ring-2 ring-primary rounded-xl' : ''}`}
                  >
                    <GripVertical className="absolute -left-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/50 pointer-events-none z-10" />
                    {renderItem(tr)}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
