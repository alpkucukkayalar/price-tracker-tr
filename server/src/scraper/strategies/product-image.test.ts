import { describe, it, expect } from 'vitest';
import { extractProductImage } from './product-image.js';

describe('extractProductImage', () => {
  it('prefers og:image and resolves relative URLs', () => {
    expect(extractProductImage('<meta property="og:image" content="/img/p.jpg">', 'https://www.trendyol.com/a/b-p-1'))
      .toBe('https://www.trendyol.com/img/p.jpg');
  });
  it('reads JSON-LD Product.image (string, array, object)', () => {
    const ld = (img: unknown) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', image: img })}</script>`;
    expect(extractProductImage(ld('https://cdn.akakce.com/x.jpg'), 'https://www.akakce.com/')).toBe('https://cdn.akakce.com/x.jpg');
    expect(extractProductImage(ld(['https://c/1.jpg', 'https://c/2.jpg']), 'https://x/')).toBe('https://c/1.jpg');
    expect(extractProductImage(ld({ url: 'https://c/o.jpg' }), 'https://x/')).toBe('https://c/o.jpg');
  });
  it('falls back to the Amazon landing image', () => {
    expect(extractProductImage('<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/a.jpg" src="data:x">', 'https://www.amazon.com.tr/dp/B0'))
      .toBe('https://m.media-amazon.com/images/I/a.jpg');
  });
  it('returns null when nothing usable', () => {
    expect(extractProductImage('<meta property="og:image" content="data:image/png;base64,AA">', 'https://x/')).toBeNull();
  });
});
