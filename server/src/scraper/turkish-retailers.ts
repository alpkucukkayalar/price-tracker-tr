/**
 * Turkish e-commerce support (Trendyol, Hepsiburada, Amazon.com.tr, N11).
 *
 * Two jobs:
 *  1. Recognize Turkish retailer hosts so the scraper uses Turkish number
 *     format ("1.299,99 TL"), a tr-TR browser locale and TRY as currency.
 *  2. Pull the CURRENT price and the retailer's CLAIMED "original" price
 *     (the struck-through "list" price) from each site's markup. The claimed
 *     price is what campaign banners compute their "%40 indirim" from, so we
 *     record it next to the real price to expose inflated discount claims.
 *
 * Every extractor is a pure function over HTML so it is unit-testable with
 * fixtures. Each site gets several independent signals (embedded state JSON,
 * data-test-id hooks, class names) in priority order: retailers redesign
 * often, and one surviving signal is enough. When none match we return null
 * and the generic pipeline (JSON-LD → microdata → OpenGraph → CSS) runs.
 */
import { parsePrice } from './extractor.js';

export type TurkishRetailer = 'trendyol' | 'hepsiburada' | 'amazon_tr' | 'n11';

export interface TurkishPriceResult {
  /** What the shopper pays now (basket/discounted price when shown). */
  price: number;
  /** The retailer's struck-through "original" price, or null when none is shown. */
  listPrice: number | null;
  /** Which signal matched — logged and stored as the scrape strategy. */
  source: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectTurkishRetailer(url: string): TurkishRetailer | null {
  const host = hostOf(url);
  if (!host) return null;
  if (hostIs(host, 'trendyol.com') || host === 'ty.gl') return 'trendyol';
  if (hostIs(host, 'hepsiburada.com') || host === 'hb.biz') return 'hepsiburada';
  if (hostIs(host, 'amazon.com.tr')) return 'amazon_tr';
  if (hostIs(host, 'n11.com')) return 'n11';
  return null;
}

/** Known Turkish retailer, or any `.tr` host — both get Turkish parsing and TRY. */
export function isTurkishHost(url: string): boolean {
  if (detectTurkishRetailer(url) !== null) return true;
  return /\.tr$/.test(hostOf(url));
}

export const RETAILER_LABEL: Record<TurkishRetailer, string> = {
  trendyol: 'Trendyol',
  hepsiburada: 'Hepsiburada',
  amazon_tr: 'Amazon.com.tr',
  n11: 'N11',
};

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function trPrice(text: string | undefined | null): number | null {
  if (!text) return null;
  return parsePrice(text, { locale: 'tr' });
}

/** Machine-readable number ("1299.99", 1299.99) — never Turkish-formatted. */
function machineNumber(text: string | undefined | null): number | null {
  if (text == null) return null;
  const n = parseFloat(String(text).trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Price inside the first element whose opening tag matches `attrRe`
 * (e.g. /class="[^"]*\bprc-dsc\b/). Prefers a `content="1299.99"` attribute
 * on that tag; otherwise parses the element's text in Turkish format. The
 * element body is taken up to its first matching closing tag, capped so a
 * missing close tag can't swallow the page.
 */
export function priceFromElement(html: string, attrRe: RegExp): number | null {
  const openRe = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*${attrRe.source}[^>]*>`, 'i');
  const open = openRe.exec(html);
  if (!open) return null;
  const content = /\bcontent=["']([^"']+)["']/i.exec(open[0]);
  if (content) {
    const n = machineNumber(content[1]);
    if (n !== null) return n;
  }
  const tag = open[1];
  const rest = html.slice(open.index + open[0].length, open.index + open[0].length + 1500);
  const close = rest.search(new RegExp(`</${tag}\\s*>`, 'i'));
  const body = close >= 0 ? rest.slice(0, close) : rest.slice(0, 300);
  const text = stripTags(body);
  if (!/\d/.test(text)) return null;
  return trPrice(text);
}

function firstElementPrice(html: string, patterns: RegExp[]): { price: number; index: number } | null {
  for (let i = 0; i < patterns.length; i++) {
    const p = priceFromElement(html, patterns[i]);
    if (p !== null) return { price: p, index: i };
  }
  return null;
}

/**
 * `"key":{ ... "value": 1299.99 ...}` or `"key": 1299.99` in embedded state
 * JSON. Only the first occurrence is used — product state precedes
 * recommendation carousels in every layout we've seen.
 */
export function jsonPrice(html: string, key: string): number | null {
  const objRe = new RegExp(`"${key}"\\s*:\\s*\\{[^{}]*?"value"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)`, 'i');
  const obj = objRe.exec(html);
  if (obj) return machineNumber(obj[1]);
  const numRe = new RegExp(`"${key}"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)"?\\s*[,}]`, 'i');
  const num = numRe.exec(html);
  return num ? machineNumber(num[1]) : null;
}

const cls = (name: string) => new RegExp(`class=["'][^"']*\\b${name}\\b[^"']*["']`);
const testId = (name: string) => new RegExp(`data-test-?id=["']${name}["']`);

/** A list price only counts when it is actually above the current price. */
function sanitizeList(price: number, list: number | null): number | null {
  return list !== null && list > price * 1.001 ? list : null;
}

// ---------------------------------------------------------------------------
// Site extractors
// ---------------------------------------------------------------------------

export function extractTrendyol(html: string): TurkishPriceResult | null {
  // 1. Embedded app state (window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ etc.).
  //    discountedPrice = what you pay (incl. "sepette" discount),
  //    sellingPrice = shelf price, originalPrice = struck-through price.
  const discounted = jsonPrice(html, 'discountedPrice');
  const selling = jsonPrice(html, 'sellingPrice');
  const original = jsonPrice(html, 'originalPrice');
  const stateCurrent = discounted ?? selling;
  if (stateCurrent !== null) {
    const listCandidate = original ?? (selling !== null && selling > stateCurrent ? selling : null);
    return { price: stateCurrent, listPrice: sanitizeList(stateCurrent, listCandidate), source: 'trendyol-state' };
  }

  // 2. Rendered price box.
  const current = firstElementPrice(html, [
    testId('price-current-price'),
    cls('prc-dsc'),
    cls('discounted'),
    cls('product-price'),
    cls('prc-slg'),
  ]);
  if (current === null) return null;
  const list = firstElementPrice(html, [cls('prc-org'), cls('original'), cls('old-price')]);
  return { price: current.price, listPrice: sanitizeList(current.price, list?.price ?? null), source: 'trendyol-dom' };
}

export function extractHepsiburada(html: string): TurkishPriceResult | null {
  const current = firstElementPrice(html, [
    /id=["']offering-price["']/,
    testId('checkout-price'),
    testId('price-current-price'),
    testId('default-price'),
    cls('product-price'),
  ]);
  const state = jsonPrice(html, 'currentPrice') ?? jsonPrice(html, 'finalPrice');
  const price = current?.price ?? state;
  if (price === null) return null;
  const list =
    firstElementPrice(html, [testId('prev-price'), testId('price-prev-price'), /id=["']originalPrice["']/, cls('old-price')])
      ?.price ?? jsonPrice(html, 'originalPrice');
  return { price, listPrice: sanitizeList(price, list), source: current ? 'hepsiburada-dom' : 'hepsiburada-state' };
}

/**
 * Amazon.com.tr. The current price comes from the shared Amazon pipeline in
 * css-patterns.ts (now Turkish-aware via the "TL" marker); this adapter adds
 * the struck-through list price ("Önerilen Perakende Fiyatı" / "Liste
 * fiyatı") and, when Amazon shows it, the legally required "son 30 günün en
 * düşük fiyatı" reference.
 */
export function extractAmazonTrListPrice(html: string): number | null {
  const scope =
    /<div[^>]*id=["'](?:corePriceDisplay_desktop_feature_div|corePrice_feature_div|apex_desktop)["'][\s\S]{0,8000}/i.exec(html)?.[0] ??
    html;
  const strike = /<span[^>]*class=["'][^"']*a-text-price[^"']*["'][^>]*data-a-strike=["']true["'][^>]*>[\s\S]{0,300}?<span[^>]*class=["']a-offscreen["'][^>]*>([^<]+)<\/span>/i.exec(scope)
    ?? /<span[^>]*class=["'][^"']*basisPrice[^"']*["'][^>]*>[\s\S]{0,400}?<span[^>]*class=["']a-offscreen["'][^>]*>([^<]+)<\/span>/i.exec(scope);
  return strike ? trPrice(strike[1]) : null;
}

export function extractN11(html: string): TurkishPriceResult | null {
  const current = firstElementPrice(html, [
    /itemprop=["']price["']/,
    cls('newPrice'),
    cls('unf-p-summary-price'),
    cls('price-current'),
    cls('priceContainer'),
  ]);
  if (current === null) return null;
  const list = firstElementPrice(html, [cls('oldPrice'), cls('unf-p-summary-old-price'), cls('price-old')]);
  return { price: current.price, listPrice: sanitizeList(current.price, list?.price ?? null), source: 'n11-dom' };
}

/**
 * Site-specific extraction. Returns null when the site's own signals are
 * absent; Amazon.com.tr always returns null here (its current price comes
 * from the shared Amazon logic — use extractTurkishListPrice for the list).
 */
export function extractTurkishRetailerPrice(html: string, retailer: TurkishRetailer): TurkishPriceResult | null {
  switch (retailer) {
    case 'trendyol':
      return extractTrendyol(html);
    case 'hepsiburada':
      return extractHepsiburada(html);
    case 'n11':
      return extractN11(html);
    case 'amazon_tr':
      return null;
  }
}

/** Claimed "original" price for any Turkish retailer, used after a generic-pipeline hit. */
export function extractTurkishListPrice(html: string, retailer: TurkishRetailer, price: number): number | null {
  const list =
    retailer === 'amazon_tr'
      ? extractAmazonTrListPrice(html)
      : extractTurkishRetailerPrice(html, retailer)?.listPrice ?? null;
  return sanitizeList(price, list);
}
