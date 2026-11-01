/**
 * Product-page URL shapes for the Turkish stores. Mirror of
 * client/src/lib/import-links.ts PRODUCT_PATTERNS (keep in sync).
 */
export const PRODUCT_PATTERN_SOURCES: readonly string[] = [
  '^https?:\\/\\/(?:www\\.)?trendyol\\.com\\/.+-p-\\d+',
  '^https?:\\/\\/(?:www\\.)?hepsiburada\\.com\\/.+-(?:p|pm)-[A-Z0-9]+',
  '^https?:\\/\\/(?:www\\.)?amazon\\.com\\.tr\\/(?:.*\\/)?(?:dp|gp\\/product)\\/[A-Z0-9]{10}',
  '^https?:\\/\\/(?:www\\.)?n11\\.com\\/urun\\/',
  '^https?:\\/\\/(?:www\\.)?akakce\\.com\\/.+,\\d+\\.html',
];

/**
 * Runs inside the page (chrome.scripting.executeScript `func`), so it must be
 * self-contained: no imports or closures. Returns [url, title] pairs.
 */
export function collectProductLinks(patternSources: string[]): [string, string][] {
  const pats = patternSources.map(s => new RegExp(s, 'i'));
  const seen = new Set<string>();
  const out: [string, string][] = [];
  document.querySelectorAll('a[href]').forEach(el => {
    const a = el as HTMLAnchorElement;
    const href = a.href;
    if (seen.has(href) || !pats.some(r => r.test(href))) return;
    seen.add(href);
    const title = (a.getAttribute('title') || a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    out.push([href, title]);
  });
  return out;
}

/** The app's bulk-import URL carrying the links in the hash (never sent to a server). */
export function importPageUrl(serverUrl: string, links: [string, string][]): string {
  return `${serverUrl}/ice-aktar#links=${encodeURIComponent(JSON.stringify(links))}`;
}
