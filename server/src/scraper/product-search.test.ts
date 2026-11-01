import { describe, it, expect } from 'vitest';
import {
  buildSearchUrl, matchScore, parseSearchResults, retailersToSearch, searchQueryFromName,
} from './product-search.js';

describe('product search helpers', () => {
  it('builds search URLs', () => {
    expect(buildSearchUrl('trendyol', 'apex pro')).toBe('https://www.trendyol.com/sr?q=apex%20pro');
    expect(buildSearchUrl('amazon_tr', 'apex pro')).toBe('https://www.amazon.com.tr/s?k=apex%20pro');
    expect(buildSearchUrl('n11', 'apex pro')).toBe('https://www.n11.com/arama?q=apex%20pro');
    expect(buildSearchUrl('akakce', 'apex pro')).toBe('https://www.akakce.com/arama/?q=apex%20pro');
  });

  it('shortens a tracker name into a query', () => {
    expect(searchQueryFromName('SteelSeries Apex Pro TKL Wireless (2023) - Mekanik Oyun Klavyesi, OmniPoint 2.0, UK'))
      .toBe('SteelSeries Apex Pro TKL Wireless 2023 Mekanik Oyun');
  });

  it('scores word overlap, Turkish-insensitive', () => {
    expect(matchScore('Ayakkabı Bez Çanta', 'AYAKKABI bez canta 5 adet')).toBe(1);
    expect(matchScore('Apex Pro TKL', 'Logitech MX Keys')).toBe(0);
  });

  it('skips retailers the tracker already has, never searches Hepsiburada', () => {
    expect(retailersToSearch(['https://www.amazon.com.tr/dp/B0ABCDEFGH'])).toEqual(['akakce', 'trendyol', 'n11']);
    expect(retailersToSearch([])).toEqual(['akakce', 'trendyol', 'amazon_tr', 'n11']);
    expect(retailersToSearch(['https://www.akakce.com/x/en-ucuz-y-fiyati,1.html'])).toEqual(['trendyol', 'amazon_tr', 'n11']);
  });
});

describe('parseSearchResults', () => {
  const q = 'SteelSeries Apex Pro TKL Wireless';

  it('Trendyol cards', () => {
    const html = `
      <div class="p-card-wrppr"><a href="/steelseries/apex-pro-tkl-wireless-klavye-p-12345?boutiqueId=1">
        <img alt="x"><span class="prdct-desc-cntnr-name" title="SteelSeries Apex Pro TKL Wireless Klavye">SteelSeries Apex Pro TKL Wireless Klavye</span>
        <div class="prc-box-dscntd">12.999 TL</div></a></div>
      <div class="p-card-wrppr"><a href="/logitech/mx-keys-p-999"><span>Logitech MX Keys</span><div>3.499 TL</div></a></div>`;
    const r = parseSearchResults('trendyol', html, q);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      url: 'https://www.trendyol.com/steelseries/apex-pro-tkl-wireless-klavye-p-12345',
      price: 12999,
      score: 1,
    });
  });

  it('Amazon.com.tr results (duplicate links per card collapse)', () => {
    const html = `
      <div data-component-type="s-search-result" data-asin="B0BXYZ1234">
        <a class="a-link-normal" href="/SteelSeries-Apex-TKL-Wireless/dp/B0BXYZ1234/ref=sr_1_1"><img alt="img"></a>
        <h2><a href="/SteelSeries-Apex-TKL-Wireless/dp/B0BXYZ1234/ref=sr_1_1"><span>SteelSeries Apex Pro TKL Wireless (2023)</span></a></h2>
        <span class="a-price"><span class="a-offscreen">13.499,00TL</span></span>
      </div>`;
    const r = parseSearchResults('amazon_tr', html, q);
    expect(r).toEqual([
      expect.objectContaining({ url: 'https://www.amazon.com.tr/dp/B0BXYZ1234', price: 13499, score: 1 }),
    ]);
  });

  it('N11 results', () => {
    const html = `
      <li class="column"><a href="https://www.n11.com/urun/steelseries-apex-pro-tkl-wireless-123?magaza=x" title="SteelSeries Apex Pro TKL Wireless Mekanik Klavye">
        <img></a><div class="priceContainer"><ins>11.750,50 TL</ins></div></li>`;
    const r = parseSearchResults('n11', html, q);
    expect(r[0]).toMatchObject({ url: 'https://www.n11.com/urun/steelseries-apex-pro-tkl-wireless-123', price: 11750.5 });
  });

  it('Akakçe search results (split decimals)', () => {
    const html = `
      <ul id="APL"><li data-pr="1735200190"><a href="/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html" title="Aqara FP300 Matter Akıllı Sensör">
        <img alt="Aqara FP300"></a><span class="pt_v8">3.266<i>,01 TL</i></span> +8 FİYAT</li>
      <li><a href="/akilli-sensor/en-ucuz-aqara-fp2-fiyati,999.html" title="Aqara FP2 Varlık Sensörü"></a><span class="pt_v8">2.999<i>,00 TL</i></span></li></ul>`;
    const r = parseSearchResults('akakce', html, 'Aqara FP300 Sensör');
    expect(r[0]).toMatchObject({
      url: 'https://www.akakce.com/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html',
      price: 3266.01,
      score: 1,
    });
  });

  it('returns nothing for an unrelated page', () => {
    expect(parseSearchResults('trendyol', '<html><body>Captcha</body></html>', q)).toEqual([]);
  });
});
