/**
 * Bulk import: pull product links out of a browser bookmarks export
 * (Netscape bookmark HTML), pasted text, or the "Fiyat Takip'e gönder"
 * bookmarklet payload, keeping only links that look like product pages.
 */

export interface ImportLink {
  url: string
  title: string
}

// Product-page URL shapes for the stores we support. Anything else (store
// home pages, search pages, unrelated bookmarks) is ignored.
const PRODUCT_PATTERNS: RegExp[] = [
  /^https?:\/\/(?:www\.)?trendyol\.com\/.+-p-\d+/i,
  /^https?:\/\/(?:www\.)?hepsiburada\.com\/.+-(?:p|pm)-[A-Z0-9]+/i,
  /^https?:\/\/(?:www\.)?amazon\.com\.tr\/(?:.*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/i,
  /^https?:\/\/(?:www\.)?n11\.com\/urun\//i,
  /^https?:\/\/(?:www\.)?akakce\.com\/.+,\d+\.html/i,
]

export function isProductLink(url: string): boolean {
  return PRODUCT_PATTERNS.some(re => re.test(url))
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

/** Readable name from the URL slug when there is no title. */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    let slug = ''
    if (/akakce\.com$/.test(u.hostname)) {
      slug = (parts[parts.length - 1] || '').replace(/,\d+\.html$/i, '').replace(/^en-ucuz-/, '').replace(/-fiyati$/, '')
    } else if (/amazon\.com\.tr$/.test(u.hostname)) {
      const dp = parts.findIndex(p => p === 'dp' || p === 'product')
      slug = dp > 0 ? parts[dp - 1] : parts[0] || ''
    } else {
      slug = (parts[parts.length - 1] || '').replace(/-(?:p|pm)-[A-Za-z0-9]+$/, '')
    }
    const words = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim()
    return words ? words.charAt(0).toLocaleUpperCase('tr-TR') + words.slice(1) : u.hostname
  } catch {
    return url
  }
}

/** Strip tracking noise so the same product from two sources dedupes. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(u.pathname)
    if (/amazon\.com\.tr$/.test(u.hostname) && asin) return `https://www.amazon.com.tr/dp/${asin[1].toUpperCase()}`
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|tag|boutiqueId|merchantId|sav|magaza|adjust|_gl)/i.test(k)) u.searchParams.delete(k)
    }
    return u.toString()
  } catch {
    return url
  }
}

/** Extract product links from bookmarks HTML or any text. Deduped, in order. */
export function parseLinks(input: string): ImportLink[] {
  const found: ImportLink[] = []
  // Bookmark HTML: <A HREF="url" ...>Title</A>
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(input)) !== null) {
    found.push({ url: decode(m[1]), title: decode(m[2].replace(/<[^>]+>/g, '')) })
  }
  // Bare URLs (pasted lists, or text around the anchors).
  const text = input.replace(anchorRe, ' ')
  const urlRe = /https?:\/\/[^\s"'<>]+/g
  while ((m = urlRe.exec(text)) !== null) found.push({ url: decode(m[0]).replace(/[),.;]+$/, ''), title: '' })

  const seen = new Map<string, ImportLink>()
  for (const l of found) {
    if (!isProductLink(l.url)) continue
    const url = cleanUrl(l.url)
    const prev = seen.get(url)
    if (prev) {
      if (!prev.title && l.title) prev.title = l.title
      continue
    }
    seen.set(url, { url, title: l.title })
  }
  return [...seen.values()].map(l => ({ url: l.url, title: l.title || nameFromUrl(l.url) }))
}

/** Payload the bookmarklet puts in the URL hash: #links=<encoded JSON [[url,title],…]>. */
export function parseHashPayload(hash: string): ImportLink[] {
  const m = /[#&]links=([^&]+)/.exec(hash)
  if (!m) return []
  try {
    const arr = JSON.parse(decodeURIComponent(m[1])) as [string, string][]
    return parseLinks(arr.map(([u, t]) => `<a href="${u.replace(/"/g, '&quot;')}">${(t || '').replace(/</g, '&lt;')}</a>`).join('\n'))
  } catch {
    return []
  }
}

/**
 * Bookmarklet source: collects product links on the current page (e.g. a
 * favourites list in the user's own logged-in browser) and opens the app's
 * import page with them. Runs only when the user clicks it.
 */
export function bookmarkletHref(appOrigin: string): string {
  const pats = PRODUCT_PATTERNS.map(r => r.source)
  const code = `(function(){var P=${JSON.stringify(pats)}.map(function(s){return new RegExp(s,'i')});var s={},o=[];document.querySelectorAll('a[href]').forEach(function(a){var h=a.href;if(s[h])return;if(P.some(function(r){return r.test(h)})){s[h]=1;var t=(a.getAttribute('title')||a.innerText||'').replace(/\\s+/g,' ').trim().slice(0,150);o.push([h,t])}});if(!o.length){alert('Bu sayfada ürün linki bulunamadı.');return}window.open(${JSON.stringify(appOrigin + '/ice-aktar#links=')}+encodeURIComponent(JSON.stringify(o)),'_blank')})()`
  return 'javascript:' + encodeURIComponent(code)
}
