import { describe, it, expect } from 'vitest'
import { detectRetailer, pctLabel } from './campaign'

describe('detectRetailer', () => {
  it('maps Turkish retailer hosts', () => {
    expect(detectRetailer('https://www.trendyol.com/x-p-1')).toBe('trendyol')
    expect(detectRetailer('https://www.hepsiburada.com/x')).toBe('hepsiburada')
    expect(detectRetailer('https://www.amazon.com.tr/dp/X')).toBe('amazon_tr')
    expect(detectRetailer('https://urun.n11.com/x')).toBe('n11')
    expect(detectRetailer('https://www.amazon.com/dp/X')).toBeNull()
    expect(detectRetailer('nope')).toBeNull()
  })
  it('pctLabel', () => {
    expect(pctLabel(0.234)).toBe('%23')
    expect(pctLabel(-0.05)).toBe('%5')
    expect(pctLabel(null)).toBe('—')
  })
})
