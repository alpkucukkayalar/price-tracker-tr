import { describe, it, expect } from 'vitest';
import { PRODUCT_PATTERN_SOURCES, importPageUrl } from './product-links.js';

describe('product-links', () => {
  const match = (u: string) => PRODUCT_PATTERN_SOURCES.some(s => new RegExp(s, 'i').test(u));
  it('matches product pages only', () => {
    expect(match('https://www.hepsiburada.com/dyson-hushjet-pm-HBC0000C5HBII')).toBe(true);
    expect(match('https://www.akakce.com/x/en-ucuz-aqara-fiyati,1735200190.html')).toBe(true);
    expect(match('https://www.hepsiburada.com/kampanyalar')).toBe(false);
  });
  it('builds the import URL', () => {
    const u = importPageUrl('http://localhost:3100', [['https://www.trendyol.com/a-p-1', 'A']]);
    expect(u.startsWith('http://localhost:3100/ice-aktar#links=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split('#links=')[1]))).toEqual([['https://www.trendyol.com/a-p-1', 'A']]);
  });
});
