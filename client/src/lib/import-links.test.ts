import { describe, it, expect } from 'vitest'
import { bookmarkletHref, cleanUrl, isProductLink, nameFromUrl, parseHashPayload, parseLinks } from './import-links'

describe('import-links', () => {
  it('recognizes product pages only', () => {
    expect(isProductLink('https://www.trendyol.com/apple/airpods-pro-p-123456')).toBe(true)
    expect(isProductLink('https://www.hepsiburada.com/aqara-fp300-pm-HBC0000K2PWWX')).toBe(true)
    expect(isProductLink('https://www.amazon.com.tr/Belkin/dp/B0FVXM4X4J/ref=x')).toBe(true)
    expect(isProductLink('https://www.n11.com/urun/steelseries-apex-123')).toBe(true)
    expect(isProductLink('https://www.akakce.com/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html')).toBe(true)
    expect(isProductLink('https://www.trendyol.com/')).toBe(false)
    expect(isProductLink('https://github.com/x')).toBe(false)
  })

  it('parses a Chrome bookmarks export and dedupes', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><A HREF="https://www.trendyol.com/apple/airpods-pro-2-p-123?boutiqueId=9&amp;merchantId=1" ADD_DATE="1">AirPods Pro 2</A>
      <DT><A HREF="https://www.trendyol.com/apple/airpods-pro-2-p-123">dup</A>
      <DT><A HREF="https://news.example.com/">Haber</A>
      <DT><A HREF="https://www.amazon.com.tr/Belkin-Sarj/dp/B0FVXM4X4J/ref=sr_1_1?tag=x">Belkin Şarj</A>
    </DL>`
    expect(parseLinks(html)).toEqual([
      { url: 'https://www.trendyol.com/apple/airpods-pro-2-p-123', title: 'AirPods Pro 2' },
      { url: 'https://www.amazon.com.tr/dp/B0FVXM4X4J', title: 'Belkin Şarj' },
    ])
  })

  it('parses pasted URLs and names them from the slug', () => {
    const r = parseLinks('şunlar:\nhttps://www.akakce.com/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html\nhttps://www.n11.com/urun/steelseries-apex-pro-123, bitti')
    expect(r.map(x => x.title)).toEqual(['Aqara fp300 matter', 'Steelseries apex pro 123'])
  })

  it('names Amazon links from the slug before /dp/', () => {
    expect(nameFromUrl('https://www.amazon.com.tr/Belkin-BoostCharge-Pro/dp/B0FVXM4X4J')).toBe('Belkin BoostCharge Pro')
    expect(cleanUrl('https://www.amazon.com.tr/x/dp/b0fvxm4x4j?psc=1')).toBe('https://www.amazon.com.tr/dp/B0FVXM4X4J')
  })

  it('reads the bookmarklet hash payload', () => {
    const payload = encodeURIComponent(JSON.stringify([
      ['https://www.hepsiburada.com/dyson-hushjet-pm-HBC0000C5HBII', 'Dyson HushJet'],
      ['https://www.hepsiburada.com/kampanyalar', 'Kampanyalar'],
    ]))
    expect(parseHashPayload(`#links=${payload}`)).toEqual([
      { url: 'https://www.hepsiburada.com/dyson-hushjet-pm-HBC0000C5HBII', title: 'Dyson HushJet' },
    ])
    expect(parseHashPayload('#nothing')).toEqual([])
  })

  it('builds a javascript: bookmarklet pointing at the app', () => {
    const href = bookmarkletHref('http://localhost:3100')
    expect(href.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(href)).toContain('http://localhost:3100/ice-aktar#links=')
  })
})
