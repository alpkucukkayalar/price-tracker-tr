import { fetchPageContent } from './browser.js';
import { extractFromJsonLd } from './strategies/jsonld.js';
import { extractFromMicrodata } from './strategies/microdata.js';
import { extractFromOpenGraph } from './strategies/opengraph.js';
import { extractFromCssPatterns, isAmazonCurrentlyUnavailable } from './strategies/css-patterns.js';
import { extractFromRegex } from './strategies/regex.js';
import { extractWithCssSelector } from './strategies/css-selector.js';
import { extractProductTitle } from './strategies/product-title.js';
import { extractAvailability } from './strategies/availability.js';
import { withRetry, ScrapeError } from './retry.js';
import { config } from '../config.js';
import {
  detectTurkishRetailer,
  extractTurkishRetailerPrice,
  extractTurkishListPrice,
  isTurkishHost,
} from './turkish-retailers.js';
import { logger } from '../logger.js';

export interface ExtractionResult {
  price: number;
  currency: string;
  strategy: string;
  finalUrl: string;
  /**
   * Product name from the page's structured data (JSON-LD name → og:title →
   * <title>), boilerplate-stripped. Null when nothing trustworthy was found
   * and on the user-CSS-selector fast path (which never fetches raw HTML).
   * Consumed by the share-flow name autofill via POST /test-scrape.
   */
  title: string | null;
  /**
   * Retailer's struck-through "original" price when the page shows one
   * (Turkish retailers only for now). Recorded alongside the price so the
   * campaign analysis can compare the CLAIMED discount with the real one.
   */
  listPrice?: number | null;
}

/**
 * A successful scrape of a page that is affirmatively OUT OF STOCK (phase 4):
 * Amazon's "Currently unavailable" block, or JSON-LD offers all reporting
 * OutOfStock/SoldOut/Discontinued. Distinct from a scrape FAILURE — the page
 * loaded and told us the product state; there is just no purchasable price.
 * Any parsed price on such a page (cached list price) is deliberately
 * discarded rather than recorded.
 */
export interface OutOfStockResult {
  outOfStock: true;
  finalUrl: string;
  title: string | null;
}

export type ScrapeOutcome = ExtractionResult | OutOfStockResult;

export function isOutOfStock(r: ScrapeOutcome): r is OutOfStockResult {
  return 'outOfStock' in r && r.outOfStock === true;
}

/**
 * Hosts where the page-wide regex fallback in strategies/regex.ts is unsafe.
 *
 * Amazon coupon, financing, and rewards copy ("Save $10 with coupon",
 * "as low as $10/mo with Affirm", "$10 off your first order", "earn up to
 * $10/month") reliably resolves to "$10" via the regex strategy's
 * frequency-mode tiebreaker. When all structured strategies fail (bot
 * challenge, sparse short-link preview, layout drift), the page-wide
 * regex returns $10 and the system reports a phantom price drop. Five
 * false Discord alerts fired this way on 2026-04-27 before this guard
 * was added.
 *
 * Same philosophy as isAmazonCurrentlyUnavailable above — fail loud, do
 * not guess. Non-Amazon retailers without structured data still depend
 * on the regex fallback (Newegg has its own scoping in regex.ts), so the
 * bypass is intentionally narrow.
 *
 * Matches:
 *   - amazon.com / amazon.co.uk / amazon.de / smile.amazon.com / etc.
 *   - a.co (short-link host before redirect resolves)
 *   - amzn.to (short-link host before redirect resolves)
 */
export function isPageWideRegexUnsafeHost(host: string): boolean {
  return /(?:^|\.)amazon\.[a-z.]+$|^a\.co$|^amzn\.to$/i.test(host);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * True when a price string carries a Turkish-lira marker (₺, "TL", "TRY").
 * Turkish retailers format prices as "1.299,99 TL": dot = thousands,
 * comma = decimal — the opposite of the US default below.
 */
export function hasTurkishLiraMarker(text: string): boolean {
  return /₺|(?:^|[\s\d])(?:TL|TRY)(?:$|[\s.,;)])/i.test(text);
}

export interface ParsePriceOptions {
  /**
   * 'tr' forces Turkish number format ("1.299,99" → 1299.99, "12.499" →
   * 12499) even when the text carries no ₺/TL marker. Set by the Turkish
   * retailer adapters, whose page fragments often omit the currency.
   */
  locale?: 'tr';
}

/**
 * Turkish number format: dot is the thousands separator, comma the decimal.
 * A dot-only string is treated as thousands when every dot group has exactly
 * three digits ("12.499" → 12499), otherwise as a decimal point ("1299.99",
 * as found in machine-readable attributes).
 */
function normalizeTurkish(cleaned: string): string {
  if (cleaned.includes(',')) {
    return cleaned.replace(/\./g, '').replace(/,(?=[^,]*$)/, '.').replace(/,/g, '');
  }
  if (cleaned.includes('.')) {
    const groups = cleaned.split('.');
    if (groups.slice(1).every(g => g.length === 3)) return groups.join('');
  }
  return cleaned;
}

const TR_NUMBER_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

/**
 * The price number inside a Turkish price text: the first number written
 * right next to a TL/₺/TRY marker, else the first number. Percentages
 * ("%10", "10%") are ignored.
 */
export function pickTurkishPriceToken(text: string): string | null {
  const t = text
    .replace(/&nbsp;|&#160;|\u00a0|\u202f/gi, ' ')
    .replace(/%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%/g, ' ');
  const tokens = [...t.matchAll(TR_NUMBER_RE)];
  if (tokens.length === 0) return null;
  for (const m of tokens) {
    const end = (m.index ?? 0) + m[0].length;
    const after = t.slice(end, end + 4);
    const before = t.slice(Math.max(0, (m.index ?? 0) - 2), m.index);
    if (/^\s?(?:TL|TRY|₺)/i.test(after) || /₺\s?$/.test(before)) return m[0];
  }
  return tokens[0][0];
}

/**
 * Parse a price string like "$1,234.56", "1234.56" or "1.299,99 TL" into a
 * number. Turkish format is used when the text has a ₺/TL/TRY marker or
 * `opts.locale === 'tr'`.
 */
export function parsePrice(text: string, opts: ParsePriceOptions = {}): number | null {
  if (!text) return null;
  const turkish = opts.locale === 'tr' || hasTurkishLiraMarker(text);
  if (turkish) {
    // Pick ONE number token instead of gluing every digit in the text
    // together: Amazon.com.tr price labels can carry a discount ("%10"),
    // a duplicated price ("1.259,00TL1.259,00TL") or a unit price
    // ("parça başına 55,74 TL"), which turned 1.259,00 into 101259.
    const token = pickTurkishPriceToken(text);
    if (!token) return null;
    const price = parseFloat(normalizeTurkish(token));
    if (isNaN(price) || price <= 0) return null;
    return Math.round(price * 100) / 100;
  }
  // Remove everything except digits, dots, and commas
  const cleaned = text.replace(/[^0-9.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Both present: whichever separator comes LAST is the decimal point.
    // "1,234.56" (US) → 1234.56; "1.234,56" (EU/TR) → 1234.56.
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    // Only comma: could be thousands (1,234) or decimal (12,34)
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 2 && parts.length === 2) {
      // European decimal: 12,34
      normalized = cleaned.replace(',', '.');
    } else {
      // Thousands separator: 1,234
      normalized = cleaned.replace(/,/g, '');
    }
  } else {
    normalized = cleaned;
  }

  const price = parseFloat(normalized);
  if (isNaN(price) || price <= 0) return null;
  return Math.round(price * 100) / 100;
}

/**
 * Extract price from a URL using the pipeline of strategies.
 */
export async function extractPrice(url: string, cssSelector?: string | null): Promise<ScrapeOutcome> {
  // If user provided a CSS selector, try that first with a separate page load
  if (cssSelector) {
    logger.debug({ url, strategy: 'css-selector' }, 'Trying user CSS selector');
    const price = await extractWithCssSelector(url, cssSelector);
    if (price !== null) {
      return {
        price,
        currency: isTurkishHost(url) ? 'TRY' : 'USD',
        strategy: 'css-selector',
        finalUrl: url,
        title: null,
      };
    }
    logger.debug({ url }, 'User CSS selector failed, falling back to pipeline');
  }

  // Fetch page content with retry/backoff on transient failures. The
  // classifier only retries ScrapeErrors marked retryable (network errors,
  // timeouts, 5xx) plus unknown error types (browser context crashes and
  // similar). Deterministic failures like 4xx fail fast.
  const fetched = await withRetry(
    () => fetchPageContent(url),
    {
      maxRetries: config.scrapeMaxRetries,
      baseDelayMs: config.scrapeRetryBaseMs,
      isRetryable: (err) => (err instanceof ScrapeError ? err.retryable : true),
      onRetry: (err, attempt, delayMs) => {
        logger.warn(
          { url, attempt, delayMs, err: err instanceof Error ? err.message : String(err) },
          'Retrying scrape after transient failure',
        );
      },
    },
  );
  const { html, finalUrl } = fetched;

  // Affirmative out-of-stock (phase 4) — a HEALTHY outcome, not an error.
  // Amazon "Currently unavailable" short-circuits before the price pipeline
  // for the same reason it always did (the JetKVM regression: fallbacks grab
  // a sponsored-carousel price on these pages); JSON-LD offers unanimously
  // reporting OutOfStock/SoldOut/Discontinued mean the same thing on
  // structured-data retailers. Previously the Amazon case THREW, which sent
  // OOS products down the consecutive-failures path to auto-pause — killing
  // exactly the tracker you want alive for the restock.
  if (isAmazonCurrentlyUnavailable(html) || extractAvailability(html) === 'out_of_stock') {
    logger.info({ url }, 'Product is out of stock (affirmative page signal)');
    return { outOfStock: true, finalUrl, title: extractProductTitle(html) };
  }

  const onAmazonHost =
    isPageWideRegexUnsafeHost(safeHostname(finalUrl)) ||
    isPageWideRegexUnsafeHost(safeHostname(url));

  // Turkish retailers: site-specific extraction first (it also yields the
  // struck-through list price), then the generic structured-data pipeline.
  const trRetailer = detectTurkishRetailer(finalUrl) ?? detectTurkishRetailer(url);
  const turkish = trRetailer !== null || isTurkishHost(finalUrl) || isTurkishHost(url);
  const currency = turkish ? 'TRY' : 'USD';
  if (trRetailer) {
    const tr = extractTurkishRetailerPrice(html, trRetailer);
    if (tr && tr.price >= 0.01 && tr.price <= 9_999_999) {
      logger.info({ url, strategy: tr.source, price: tr.price, listPrice: tr.listPrice }, 'Price extracted');
      return {
        price: tr.price,
        currency,
        strategy: tr.source,
        finalUrl,
        title: extractProductTitle(html),
        listPrice: tr.listPrice,
      };
    }
  }

  const strategies: { name: string; fn: () => number | null }[] = [
    { name: 'json-ld', fn: () => extractFromJsonLd(html) },
    { name: 'microdata', fn: () => extractFromMicrodata(html) },
    { name: 'opengraph', fn: () => extractFromOpenGraph(html) },
    { name: 'css-patterns', fn: () => extractFromCssPatterns(html) },
  ];
  // Page-wide regex fallback runs only on non-Amazon hosts. See
  // isPageWideRegexUnsafeHost above for the rationale.
  if (!onAmazonHost && !turkish) {
    strategies.push({ name: 'regex', fn: () => extractFromRegex(html) });
  }

  for (const { name, fn } of strategies) {
    logger.debug({ url, strategy: name }, 'Trying extraction strategy');
    const price = fn();
    if (price !== null) {
      logger.info({ url, strategy: name, price }, 'Price extracted');
      // Sanity check: reject obviously wrong prices
      if (price < 0.01 || price > 999999) {
        logger.warn({ url, strategy: name, price }, 'Price outside sanity range, skipping');
        continue;
      }
      return {
        price,
        currency,
        strategy: name,
        finalUrl,
        title: extractProductTitle(html),
        listPrice: trRetailer ? extractTurkishListPrice(html, trRetailer, price) : undefined,
      };
    }
  }

  if (onAmazonHost) {
    throw new ScrapeError(
      `Amazon page rendered without a recognizable price block (${finalUrl}); page-wide regex fallback skipped to avoid coupon/financing copy false positives`,
      false,
    );
  }
  throw new Error(`Could not extract price from ${url}`);
}
