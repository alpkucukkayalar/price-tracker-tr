/**
 * "Diğer sitelerde bul": search Turkish retailers' public search pages for
 * the same product and return candidates. The user picks the right one
 * (variants, colours and bundles share names), and it is added as a seller.
 *
 * Parsing is deliberately layout-tolerant: product links are found by URL
 * shape (Trendyol "-p-<id>", Amazon "/dp/<ASIN>", N11 "/urun/"), and the
 * price is the first TL-marked number after the link.
 */
import { parsePrice } from './extractor.js';
import { detectTurkishRetailer, type TurkishRetailer } from './turkish-retailers.js';

export type SearchRetailer = Exclude<TurkishRetailer, 'hepsiburada'>;

export const SEARCHABLE_RETAILERS: SearchRetailer[] = ['trendyol', 'amazon_tr', 'n11'];

export interface SearchCandidate {
  retailer: SearchRetailer;
  title: string;
  url: string;
  price: number | null;
  /** 0..1 word overlap with the query. */
  score: number;
}

export function buildSearchUrl(retailer: SearchRetailer, query: string): string {
  const q = encodeURIComponent(query);
  switch (retailer) {
    case 'trendyol':
      return `https://www.trendyol.com/sr?q=${q}`;
    case 'amazon_tr':
      return `https://www.amazon.com.tr/s?k=${q}`;
    case 'n11':
      return `https://www.n11.com/arama?q=${q}`;
  }
}

/** Shorten a stored tracker name into a search query (first 8 words, no noise). */
export function searchQueryFromName(name: string): string {
  return name
    .replace(/[(),|\-–—/:;"'“”]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ');
}

function stripTags(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Share of query words found in the title (0..1). */
export function matchScore(query: string, title: string): number {
  const q = new Set(norm(query).split(' ').filter(w => w.length > 1));
  if (q.size === 0) return 0;
  const t = new Set(norm(title).split(' '));
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return Math.round((hit / q.size) * 100) / 100;
}

interface LinkRule {
  re: RegExp;
  canonical: (m: RegExpExecArray) => string;
}

const LINK_RULES: Record<SearchRetailer, LinkRule> = {
  trendyol: {
    re: /<a\b[^>]*href=["'](?:https?:\/\/www\.trendyol\.com)?(\/[^"'?#]+-p-\d+)[^"']*["'][^>]*>/gi,
    canonical: m => `https://www.trendyol.com${m[1]}`,
  },
  amazon_tr: {
    re: /<a\b[^>]*href=["'](?:https?:\/\/www\.amazon\.com\.tr)?\/(?:[^"'?#]*\/)?dp\/([A-Z0-9]{10})[^"']*["'][^>]*>/g,
    canonical: m => `https://www.amazon.com.tr/dp/${m[1]}`,
  },
  n11: {
    re: /<a\b[^>]*href=["'](?:https?:\/\/www\.n11\.com)?(\/urun\/[^"'?#]+)[^"']*["'][^>]*>/gi,
    canonical: m => `https://www.n11.com${m[1]}`,
  },
};

function titleNear(openTag: string, chunk: string): string {
  const attr = /\btitle=["']([^"']{6,})["']/i.exec(openTag);
  if (attr) return decode(attr[1]).trim();
  // Amazon: <h2 ...><span>Title</span></h2>; others: the link's own text.
  const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(chunk);
  if (h2) {
    const t = stripTags(h2[1]);
    if (t.length >= 6) return t;
  }
  const close = chunk.search(/<\/a>/i);
  const own = stripTags(close >= 0 ? chunk.slice(0, close) : chunk.slice(0, 600));
  if (own.length >= 6) return own.slice(0, 200);
  const alt = /\balt=["']([^"']{6,})["']/i.exec(chunk);
  return alt ? decode(alt[1]).trim() : '';
}

function priceNear(chunk: string): number | null {
  // Amazon: the a-offscreen span is the clean buy price.
  const off = /<span[^>]*class=["']a-offscreen["'][^>]*>([^<]+)<\/span>/i.exec(chunk);
  if (off) return parsePrice(off[1], { locale: 'tr' });
  const text = stripTags(chunk);
  const m = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s?(?:TL|₺)/i.exec(text);
  return m ? parsePrice(`${m[1]} TL`) : null;
}

/** Parse a retailer search page into up to `limit` candidates, best match first. */
export function parseSearchResults(
  retailer: SearchRetailer,
  html: string,
  query: string,
  limit = 5,
): SearchCandidate[] {
  const rule = LINK_RULES[retailer];
  const matches: RegExpExecArray[] = [];
  const re = new RegExp(rule.re.source, rule.re.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) matches.push(m);

  const byUrl = new Map<string, SearchCandidate>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const url = rule.canonical(cur);
    const start = cur.index + cur[0].length;
    // A product card ends where a link to a DIFFERENT product starts.
    let end = Math.min(html.length, start + 4000);
    for (let j = i + 1; j < matches.length; j++) {
      if (rule.canonical(matches[j]) !== url) {
        end = Math.min(end, matches[j].index);
        break;
      }
    }
    const chunk = html.slice(start, end);
    const existing = byUrl.get(url);
    const title = titleNear(cur[0], chunk);
    const price = priceNear(chunk);
    if (existing) {
      if (!existing.title && title) existing.title = title;
      if (existing.price === null && price !== null) existing.price = price;
      continue;
    }
    byUrl.set(url, { retailer, title, url, price, score: 0 });
  }

  return [...byUrl.values()]
    .filter(c => c.title.length > 0)
    .map(c => ({ ...c, score: matchScore(query, c.title) }))
    .filter(c => c.score >= 0.3)
    .sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, limit);
}

/** Retailers worth searching for a tracker: searchable ones it doesn't already have. */
export function retailersToSearch(existingUrls: string[]): SearchRetailer[] {
  const have = new Set(existingUrls.map(u => detectTurkishRetailer(u)).filter(Boolean));
  return SEARCHABLE_RETAILERS.filter(r => !have.has(r));
}
