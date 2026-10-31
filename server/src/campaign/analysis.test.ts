import { describe, it, expect } from 'vitest';
import { analyzeCampaign, addDays, type CampaignDay } from './analysis.js';
import { campaignBoostIntervalMinutes, istanbulToday } from './config.js';

const campaign = { name: 'Efsane Cuma', start: '2026-11-27', end: '2026-11-30' };

/** Daily series from 2026-10-28 (start-30) with price(dayIndex). */
function series(fn: (i: number, date: string) => number | null, from = '2026-10-28', until = '2026-11-30', list?: (i: number) => number | null): CampaignDay[] {
  const out: CampaignDay[] = [];
  for (let i = 0, d = from; d <= until; i++, d = addDays(d, 1)) {
    const p = fn(i, d);
    if (p !== null) out.push({ date: d, price: p, listPrice: list ? list(i) : null });
  }
  return out;
}

describe('analyzeCampaign', () => {
  it('real discount: steady price, campaign 15% below', () => {
    const days = series((_, d) => (d >= campaign.start ? 850 : 1000));
    const a = analyzeCampaign(days, campaign, '2026-12-01');
    expect(a.phase).toBe('after');
    expect(a.verdict).toBe('real_discount');
    expect(a.reference30dLow).toBe(1000);
    expect(a.realDiscountPct).toBeCloseTo(0.15);
  });

  it('fake discount: hiked 30% in the run-up, "discounted" back to normal', () => {
    const days = series((_, d) => (d >= campaign.start ? 1000 : d >= '2026-11-17' ? 1300 : 1000), undefined, undefined);
    const a = analyzeCampaign(days, campaign, '2026-11-28');
    expect(a.phase).toBe('during');
    expect(a.runupPct).toBeCloseTo(0.3);
    expect(a.realDiscountPct).toBe(0);
    expect(a.apparentDiscountPct).toBeCloseTo(0.2308, 3);
    expect(a.verdict).toBe('fake_discount');
    expect(a.headline).toMatch(/önce zam/);
  });

  it('fake discount via inflated list price, no run-up', () => {
    const days = series(() => 1000, undefined, undefined, () => 1800);
    const a = analyzeCampaign(days, campaign, '2026-12-01');
    expect(a.claimedDiscountPct).toBeCloseTo(0.4444, 3);
    expect(a.verdict).toBe('fake_discount');
  });

  it('inflated discount: hike first, but campaign still below the old normal', () => {
    const days = series((_, d) => (d >= campaign.start ? 900 : d >= '2026-11-17' ? 1200 : 1000));
    const a = analyzeCampaign(days, campaign, '2026-12-01');
    expect(a.verdict).toBe('inflated_discount');
    expect(a.realDiscountPct).toBeCloseTo(0.1);
  });

  it('no discount', () => {
    const a = analyzeCampaign(series(() => 1000), campaign, '2026-12-01');
    expect(a.verdict).toBe('no_discount');
  });

  it('price increased during the campaign', () => {
    const a = analyzeCampaign(series((_, d) => (d >= campaign.start ? 1100 : 1000)), campaign, '2026-12-01');
    expect(a.verdict).toBe('price_increased');
  });

  it('reference is the 30-day LOW, not the average (legal rule)', () => {
    // One cheap day at 800 two weeks before: a campaign price of 850 is no discount.
    const days = series((_, d) => (d >= campaign.start ? 850 : d === '2026-11-10' ? 800 : 1000));
    const a = analyzeCampaign(days, campaign, '2026-12-01');
    expect(a.reference30dLow).toBe(800);
    expect(a.verdict).toBe('price_increased');
  });

  it('insufficient data when tracking started days before the campaign', () => {
    const days = series((_, d) => (d >= campaign.start ? 800 : 1000), '2026-11-24');
    const a = analyzeCampaign(days, campaign, '2026-11-28');
    expect(a.coverageDays).toBe(3);
    expect(a.verdict).toBe('insufficient_data');
  });

  it('before the campaign: collecting, with a hike warning', () => {
    const days = series((_, d) => (d >= '2026-11-10' ? 1150 : 1000), '2026-10-31', '2026-11-12');
    const a = analyzeCampaign(days, campaign, '2026-11-12');
    expect(a.phase).toBe('before');
    expect(a.verdict).toBe('collecting');
    expect(a.preCampaignHikeWarning).toBe(true);
    expect(a.daysUntilStart).toBe(15);
    expect(a.headline).toMatch(/zam/);
  });

  it('before the campaign without a hike: no warning', () => {
    const a = analyzeCampaign(series(() => 1000, '2026-10-31', '2026-11-05'), campaign, '2026-11-05');
    expect(a.preCampaignHikeWarning).toBe(false);
  });

  it('uses the first days as baseline when tracking began inside the run-up window', () => {
    // Tracking from 2026-11-18 (inside start-10). Normal 1000, hike to 1300 on 11-22.
    const days = series((_, d) => (d >= campaign.start ? 1000 : d >= '2026-11-22' ? 1300 : 1000), '2026-11-18');
    const a = analyzeCampaign(days, campaign, '2026-12-01');
    expect(a.baselineMedian).toBe(1000);
    expect(a.runupPct).toBeCloseTo(0.3);
    expect(a.verdict).toBe('fake_discount');
  });

  it('ignores invalid rows', () => {
    const a = analyzeCampaign([{ date: 'garbage', price: 5, listPrice: null }, { date: '2026-11-01', price: 0, listPrice: null }], campaign, '2026-11-02');
    expect(a.coverageDays).toBe(0);
  });
});

describe('campaign config helpers', () => {
  it('istanbulToday shifts UTC by +3h', () => {
    expect(istanbulToday(new Date('2026-11-26T21:30:00Z'))).toBe('2026-11-27');
    expect(istanbulToday(new Date('2026-11-26T20:30:00Z'))).toBe('2026-11-26');
  });

  it('boost is active from lead day through campaign end', () => {
    const at = (iso: string) => campaignBoostIntervalMinutes(new Date(iso), campaign, 60, 1);
    expect(at('2026-11-20T12:00:00Z')).toBeNull();
    expect(at('2026-11-26T12:00:00Z')).toBe(60);
    expect(at('2026-11-30T20:00:00Z')).toBe(60);
    expect(at('2026-12-01T12:00:00Z')).toBeNull();
    expect(campaignBoostIntervalMinutes(new Date('2026-11-28T12:00:00Z'), campaign, 0, 1)).toBeNull();
  });
});
