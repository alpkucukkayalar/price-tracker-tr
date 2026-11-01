/**
 * Product image URL from a product page, for the dashboard thumbnail.
 * Order: og:image → JSON-LD Product.image → Amazon #landingImage.
 * Returns an absolute http(s) URL or null.
 */
export function extractProductImage(html: string, pageUrl: string): string | null {
  const candidates: string[] = [];

  const og = /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i.exec(html);
  if (og) {
    const c = /content=["']([^"']+)["']/i.exec(og[0]);
    if (c) candidates.push(c[1]);
  }

  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const img = findImage(JSON.parse(m[1]));
      if (img) candidates.push(img);
    } catch {
      /* malformed JSON-LD — ignore */
    }
  }

  const amz = /<img[^>]*id=["']landingImage["'][^>]*>/i.exec(html);
  if (amz) {
    const hi = /data-old-hires=["']([^"']+)["']/i.exec(amz[0]) ?? /\bsrc=["'](https?:[^"']+)["']/i.exec(amz[0]);
    if (hi) candidates.push(hi[1]);
  }

  for (const raw of candidates) {
    const abs = absolute(raw.replace(/&amp;/g, '&').trim(), pageUrl);
    if (abs) return abs;
  }
  return null;
}

function findImage(node: unknown, depth = 0): string | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findImage(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  if (o['@graph']) return findImage(o['@graph'], depth + 1);
  const type = String(o['@type'] ?? '');
  if (/Product/i.test(type) && o.image) {
    const img = o.image;
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) {
      const first = img[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && typeof (first as { url?: unknown }).url === 'string') return (first as { url: string }).url;
    }
    if (typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') return (img as { url: string }).url;
  }
  return null;
}

function absolute(raw: string, base: string): string | null {
  if (!raw || raw.startsWith('data:')) return null;
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
