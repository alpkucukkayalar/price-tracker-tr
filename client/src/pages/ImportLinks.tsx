import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Loader2, CheckCircle, XCircle, Bookmark } from 'lucide-react'
import { createTracker, getTrackers } from '../api'
import useTitle from '../useTitle'
import { bookmarkletHref, cleanUrl, parseHashPayload, parseLinks, type ImportLink } from '../lib/import-links'

type RowState = 'idle' | 'adding' | 'added' | 'exists' | 'error'

interface Row extends ImportLink {
  checked: boolean
  state: RowState
  message?: string
}

const PAUSE_MS = 1500 // be gentle: each new product triggers a first price check

/**
 * Toplu içe aktar: bring many product links in at once — from a Chrome
 * bookmarks export, pasted text, or the "Fiyat Takip'e gönder" bookmarklet /
 * extension button run on a favourites page in the user's own browser.
 */
export default function ImportLinks() {
  useTitle('Toplu içe aktar')
  // Links sent by the bookmarklet / extension arrive in the URL hash.
  const [rows, setRows] = useState<Row[]>(() =>
    parseHashPayload(window.location.hash).map(l => ({ ...l, checked: true, state: 'idle' as RowState })))
  const [text, setText] = useState('')
  const [tracked, setTracked] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState(() =>
    rows.length ? `${rows.length} ürün linki geldi. Eklemek istediklerini seç.` : '')
  const bookmarkletRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    getTrackers()
      .then(ts => setTracked(new Set(ts.map(tr => cleanUrl(tr.url)))))
      .catch(() => undefined)
    // Drop the payload from the address bar so a refresh doesn't re-import.
    if (window.location.hash.includes('links=')) history.replaceState(null, '', window.location.pathname)
    // React refuses javascript: hrefs in JSX, so set it on the DOM node.
    bookmarkletRef.current?.setAttribute('href', bookmarkletHref(window.location.origin))
  }, [])

  function addFound(found: ImportLink[]) {
    const have = new Set(rows.map(r => r.url))
    const fresh = found.filter(l => !have.has(l.url))
    setNotice(
      found.length === 0
        ? 'Ürün linki bulunamadı. (Trendyol, Hepsiburada, Amazon, N11 ve Akakçe ürün sayfaları tanınır.)'
        : `${found.length} ürün linki bulundu${fresh.length < found.length ? `, ${found.length - fresh.length} tanesi zaten listede` : ''}.`,
    )
    setRows(prev => [...prev, ...fresh.map(l => ({ ...l, checked: true, state: 'idle' as RowState }))])
  }

  // Already-tracked products start unticked and are marked.
  const view = useMemo(
    () => rows.map(r => (r.state === 'idle' && tracked.has(r.url) ? { ...r, state: 'exists' as RowState, checked: false } : r)),
    [rows, tracked],
  )
  const selected = view.filter(r => r.checked && r.state === 'idle')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    addFound(parseLinks(await file.text()))
  }

  const update = (url: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.url === url ? { ...r, ...patch } : r)))

  const addSelected = async () => {
    setRunning(true)
    const todo = selected
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i]
      update(r.url, { state: 'adding' })
      try {
        await createTracker({ name: r.title, url: r.url })
        update(r.url, { state: 'added', checked: false })
        setTracked(prev => new Set(prev).add(r.url))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/409|already|zaten/i.test(msg)) update(r.url, { state: 'exists', checked: false })
        else update(r.url, { state: 'error', message: msg })
      }
      if (i < todo.length - 1) await new Promise(res => setTimeout(res, PAUSE_MS))
    }
    setRunning(false)
  }

  const addedCount = view.filter(r => r.state === 'added').length

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Toplu içe aktar</h1>
        <p className="text-sm text-text-muted mt-1">
          Linkleri tek tek eklemek yerine bir seferde getir. Aşağıdaki yollardan birini kullan, sonra listeden seçip ekle.
        </p>
      </div>

      <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">1. Chrome yer imlerinden</h2>
        <ol className="text-sm text-text-muted list-decimal pl-5 space-y-1">
          <li>Chrome'da <b>⋮ → Yer işaretleri ve listeler → Yer işareti yöneticisi</b>'ni aç (Ctrl+Shift+O).</li>
          <li>Sağ üstteki <b>⋮ → Yer işaretlerini dışa aktar</b> ile bir <code>.html</code> dosyası kaydet.</li>
          <li>O dosyayı aşağıdan seç. Yalnızca ürün sayfaları alınır, diğer yer imleri atlanır.</li>
        </ol>
        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer hover:opacity-90">
          <Upload className="w-4 h-4" /> Yer imi dosyasını seç
          <input type="file" accept=".html,.htm,text/html" className="hidden" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </section>

      <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">2. Akakçe / Hepsiburada / Trendyol favorilerinden</h2>
        <p className="text-sm text-text-muted">
          Favoriler sayfası senin hesabına özel olduğu için uygulama oraya giremez; ama kendi tarayıcında tek tıkla gönderebilirsin:
        </p>
        <ul className="text-sm text-text-muted list-disc pl-5 space-y-1">
          <li><b>Eklenti kuruluysa:</b> favoriler sayfasını aç, eklenti simgesine tıkla → <b>"Bu sayfadaki tüm ürünleri toplu aktar"</b>.</li>
          <li>
            <b>Eklenti yoksa:</b> şu düğmeyi yer imleri çubuğuna sürükle:{' '}
            <a
              ref={bookmarkletRef}
              onClick={e => { e.preventDefault(); setNotice('Bu düğmeye burada tıklama; yer imleri çubuğuna sürükle, sonra favoriler sayfasındayken oradan tıkla.') }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary text-primary text-xs font-medium cursor-grab"
            >
              <Bookmark className="w-3.5 h-3.5" /> Fiyat Takip'e gönder
            </a>
            . Sonra favoriler sayfandayken o yer imine tıkla.
          </li>
        </ul>
        <p className="text-xs text-text-muted">
          İpucu: Liste uzunsa önce sayfanın en altına kadar kaydır ki bütün ürünler yüklensin. Şifren hiçbir yere gönderilmez.
        </p>
      </section>

      <section className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">3. Linkleri yapıştır</h2>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Her satıra bir link (ya da herhangi bir metin; içindeki ürün linkleri bulunur)"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
        />
        <button
          onClick={() => { addFound(parseLinks(text)); setText('') }}
          disabled={!text.trim()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
        >
          Linkleri bul
        </button>
      </section>

      {notice && <div className="text-sm bg-primary/10 text-text rounded-lg px-3 py-2">{notice}</div>}

      {view.length > 0 && (
        <section className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-3 border-b border-border">
            <span className="text-sm font-medium">{view.length} ürün</span>
            <button className="text-xs underline text-text-muted" disabled={running}
              onClick={() => setRows(prev => prev.map(r => ({ ...r, checked: r.state === 'idle' && !tracked.has(r.url) })))}>
              Hepsini seç
            </button>
            <button className="text-xs underline text-text-muted" disabled={running}
              onClick={() => setRows(prev => prev.map(r => ({ ...r, checked: false })))}>
              Hiçbirini seçme
            </button>
            <div className="flex-1" />
            {addedCount > 0 && !running && <Link to="/" className="text-sm text-primary underline">Panele dön</Link>}
            <button
              onClick={() => void addSelected()}
              disabled={running || selected.length === 0}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
            >
              {running && <Loader2 className="w-4 h-4 animate-spin" />}
              Seçilenleri ekle ({selected.length})
            </button>
          </div>
          <ul className="divide-y divide-border">
            {view.map(r => (
              <li key={r.url} className="flex items-start gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={r.checked}
                  disabled={running || r.state !== 'idle'}
                  onChange={e => update(r.url, { checked: e.target.checked })}
                />
                <div className="flex-1 min-w-0">
                  <input
                    value={r.title}
                    disabled={running || r.state !== 'idle'}
                    onChange={e => update(r.url, { title: e.target.value })}
                    className="w-full bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary rounded px-1"
                  />
                  <a href={r.url} target="_blank" rel="noreferrer" className="block text-xs text-text-muted truncate px-1">{r.url}</a>
                  {r.state === 'error' && <div className="text-xs text-danger px-1">{r.message}</div>}
                </div>
                <span className="text-xs whitespace-nowrap mt-1">
                  {r.state === 'adding' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {r.state === 'added' && <span className="text-success inline-flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Eklendi</span>}
                  {r.state === 'exists' && <span className="text-text-muted">Zaten takipte</span>}
                  {r.state === 'error' && <XCircle className="w-4 h-4 text-danger" />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-text-muted">
        Not: Hepsiburada ürünlerinin fiyatı doğrudan okunamıyor; uygulama bunların Akakçe sayfasını kendisi bulup fiyatı oradan takip eder.
      </p>
    </div>
  )
}
