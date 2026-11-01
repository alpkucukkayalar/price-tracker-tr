import { describe, it, expect } from 'vitest';
import { parsePrice } from './extractor.js';
import {
  cleanProductUrl,
  extractAmazonTr,
  detectTurkishRetailer,
  isTurkishHost,
  extractTrendyol,
  extractHepsiburada,
  extractN11,
  extractAmazonTrListPrice,
  extractTurkishListPrice,
} from './turkish-retailers.js';
import { extractFromCssPatterns } from './strategies/css-patterns.js';

describe('parsePrice — Turkish format', () => {
  it.each([
    ['1.299,99 TL', 1299.99],
    ['₺1.299', 1299],
    ['12.499 TL', 12499],
    ['899,90 TL', 899.9],
    ['1.299.999,00 TL', 1299999],
    ['24.999,00TL', 24999],
    ['TRY 3.450,50', 3450.5],
  ])('%s → %d', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it('locale: tr parses unmarked page fragments', () => {
    expect(parsePrice('1.299,99', { locale: 'tr' })).toBe(1299.99);
    expect(parsePrice('12.499', { locale: 'tr' })).toBe(12499);
    expect(parsePrice('1299.99', { locale: 'tr' })).toBe(1299.99);
    expect(parsePrice('1.299,', { locale: 'tr' })).toBe(1299);
  });

  it('untagged EU format with both separators uses the last one as decimal', () => {
    expect(parsePrice('1.234,56')).toBe(1234.56);
    expect(parsePrice('$1,234.56')).toBe(1234.56);
  });

  it('does not treat words containing "tl" as a lira marker', () => {
    // "title" must not flip "12.345" into Turkish thousands
    expect(parsePrice('title 12.345')).toBe(12.35);
  });
});

describe('detectTurkishRetailer / isTurkishHost', () => {
  it.each([
    ['https://www.trendyol.com/apple/iphone-p-123', 'trendyol'],
    ['https://ty.gl/abc', 'trendyol'],
    ['https://www.hepsiburada.com/x-p-HBC0000', 'hepsiburada'],
    ['https://www.amazon.com.tr/dp/B0ABC', 'amazon_tr'],
    ['https://urun.n11.com/x/y', 'n11'],
    ['https://www.amazon.com/dp/B0ABC', null],
    ['not a url', null],
  ])('%s → %s', (url, expected) => {
    expect(detectTurkishRetailer(url)).toBe(expected);
  });

  it('any .tr host is Turkish', () => {
    expect(isTurkishHost('https://www.vatanbilgisayar.com.tr/x')).toBe(true);
    expect(isTurkishHost('https://www.newegg.com/x')).toBe(false);
  });
});

describe('Trendyol', () => {
  it('reads discounted + original price from embedded state', () => {
    const html = `<script>window.__PRODUCT_DETAIL_APP_INITIAL_STATE__={"product":{"price":{
      "originalPrice":{"text":"1.999 TL","value":1999},
      "sellingPrice":{"text":"1.499 TL","value":1499},
      "discountedPrice":{"text":"1.399 TL","value":1399}}}}</script>
      <div class="recommendation">"sellingPrice":{"value":10}</div>`;
    expect(extractTrendyol(html)).toEqual({ price: 1399, listPrice: 1999, source: 'trendyol-state' });
  });

  it('uses selling price as the list price when no original is shown', () => {
    const html = `"sellingPrice":{"value":1499},"discountedPrice":{"value":1299}`;
    expect(extractTrendyol(html)?.listPrice).toBe(1499);
  });

  it('falls back to the rendered price box', () => {
    const html = `<div class="product-price-container">
      <span class="prc-org">2.499,00 TL</span><span class="prc-dsc">1.899,90 TL</span></div>`;
    expect(extractTrendyol(html)).toEqual({ price: 1899.9, listPrice: 2499, source: 'trendyol-dom' });
  });

  it('returns null when nothing matches', () => {
    expect(extractTrendyol('<html><body>yok</body></html>')).toBeNull();
  });

  it('ignores a "list" price that is not above the current price', () => {
    const html = `"sellingPrice":{"value":1499},"originalPrice":{"value":1499}`;
    expect(extractTrendyol(html)).toEqual({ price: 1499, listPrice: null, source: 'trendyol-state' });
  });
});

describe('Hepsiburada', () => {
  it('reads offering-price content attribute and previous price', () => {
    const html = `<span id="offering-price" content="12999.00"><span>12.999,00</span> TL</span>
      <del data-test-id="prev-price">15.499,00 TL</del>`;
    expect(extractHepsiburada(html)).toEqual({ price: 12999, listPrice: 15499, source: 'hepsiburada-dom' });
  });

  it('reads data-test-id price blocks', () => {
    const html = `<div data-test-id="price-current-price">8.749,50 TL</div>`;
    expect(extractHepsiburada(html)).toEqual({ price: 8749.5, listPrice: null, source: 'hepsiburada-dom' });
  });

  it('falls back to state JSON', () => {
    expect(extractHepsiburada(`{"currentPrice":499.9,"originalPrice":699.9}`)).toEqual({
      price: 499.9,
      listPrice: 699.9,
      source: 'hepsiburada-state',
    });
  });
});

describe('N11', () => {
  it('reads newPrice / oldPrice', () => {
    const html = `<div class="oldPrice"><del>3.299,00 TL</del></div>
      <div class="newPrice"><ins>2.749,00 TL</ins></div>`;
    expect(extractN11(html)).toEqual({ price: 2749, listPrice: 3299, source: 'n11-dom' });
  });

  it('prefers itemprop=price content', () => {
    const html = `<ins itemprop="price" content="2749.00">2.749,00 TL</ins>`;
    expect(extractN11(html)?.price).toBe(2749);
  });
});

describe('Amazon.com.tr', () => {
  const html = `<div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price aok-align-center priceToPay"><span class="a-offscreen">1.249,00TL</span>
    <span class="a-price-whole">1.249,</span><span class="a-price-fraction">00</span></span>
    <span class="a-size-small aok-offscreen">Liste fiyatı:</span>
    <span class="a-price a-text-price" data-a-size="s" data-a-strike="true"><span class="a-offscreen">1.799,00TL</span></span>
  </div>`;

  it('shared Amazon pipeline parses the TL price correctly', () => {
    expect(extractFromCssPatterns(html)).toBe(1249);
  });

  it('extracts the struck-through list price', () => {
    expect(extractAmazonTrListPrice(html)).toBe(1799);
    expect(extractTurkishListPrice(html, 'amazon_tr', 1249)).toBe(1799);
  });
});

describe('Amazon.com.tr noisy price text (real-page regressions 2026-11-01)', () => {
  it('ignores a discount percentage glued before the price', () => {
    expect(parsePrice('%10 1.259,00TL')).toBe(1259);
  });
  it('reads a duplicated price once', () => {
    expect(parsePrice('1.259,00TL1.259,00TL')).toBe(1259);
  });
  it('prefers the TL-marked price over a unit price', () => {
    expect(parsePrice('278,69TL278,69TL parça başına 55,74 TL(55,74TL55,74TL / parça)')).toBe(278.69);
  });
  it('keeps plain Turkish and machine formats working', () => {
    expect(parsePrice('12.499 TL')).toBe(12499);
    expect(parsePrice('₺ 1.299,99')).toBe(1299.99);
    expect(parsePrice('1299.99', { locale: 'tr' })).toBe(1299.99);
    expect(parsePrice('Fiyat: 899,90 TL', { locale: 'tr' })).toBe(899.9);
  });
});

describe('extractAmazonTr', () => {
  const page = (inner: string) =>
    `<html><body><div id="apex_desktop">Gülümseten Kasım fırsatı NO_OF_HOURS saat %10</div>` +
    `<div id="corePriceDisplay_desktop_feature_div"><style>.savingPriceOverride { color: var(--deal-savings-color,#CC0C39)!important; }</style>` +
    `<span id="apex-pricetopay-accessibility-label">%10 indirim 1.259,00 TL</span></div>` +
    `<div id="corePrice_feature_div">${inner}</div></body></html>`;
  it('reads the first a-offscreen in the core price box', () => {
    const html = page(
      `<span class="a-price"><span class="a-offscreen">278,69TL</span><span aria-hidden="true"><span class="a-price-whole">278<span class="a-price-decimal">,</span></span><span class="a-price-fraction">69</span>TL</span></span>` +
      ` parça başına <span class="a-price"><span class="a-offscreen">55,74TL</span></span> / parça`,
    );
    expect(extractAmazonTr(html)).toEqual({ price: 278.69, listPrice: null, source: 'amazon-tr-dom' });
  });
  it('returns null without a core price box', () => {
    expect(extractAmazonTr('<html><body><span class="a-offscreen">99,00TL</span></body></html>')).toBeNull();
  });
});

describe('cleanProductUrl', () => {
  it('strips Google Shopping / ad noise from Amazon.com.tr links', () => {
    expect(cleanProductUrl('https://www.amazon.com.tr/Aqara-Sensor/dp/B0G12F8K4D/ref=asc_df_B0G12F8K4D?tag=trshpngglede-21&linkCode=df0&hvadid=1&gad_source=4'))
      .toBe('https://www.amazon.com.tr/dp/B0G12F8K4D');
    expect(cleanProductUrl('https://amazon.com.tr/gp/product/b0fvxm4x4j?psc=1')).toBe('https://www.amazon.com.tr/dp/B0FVXM4X4J');
  });
  it('leaves other URLs alone', () => {
    expect(cleanProductUrl('https://www.trendyol.com/x/y-p-1?boutiqueId=2')).toBe('https://www.trendyol.com/x/y-p-1?boutiqueId=2');
    expect(cleanProductUrl('https://www.amazon.com/dp/B0ABCDEFGH/ref=x')).toBe('https://www.amazon.com/dp/B0ABCDEFGH/ref=x');
    expect(cleanProductUrl('not a url')).toBe('not a url');
  });
});
