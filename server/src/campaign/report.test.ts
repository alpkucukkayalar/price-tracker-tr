import { describe, it, expect } from 'vitest';
import { buildCampaignReport, dueReportKind, type ReportItem } from './report.js';
import type { CampaignAnalysis } from './analysis.js';

const campaign = { name: 'Efsane Cuma', start: '2026-11-27', end: '2026-11-30' };

function item(id: number, partial: Partial<CampaignAnalysis>): ReportItem {
  return {
    id,
    name: `Ürün ${id}`,
    lastPrice: 1000,
    analysis: {
      campaign, phase: 'after', verdict: 'no_discount', headline: 'h', details: [],
      reference30dLow: 1000, baselineMedian: 1000, runupPeak: null, runupPct: null, campaignLow: 1000,
      campaignLowDate: '2026-11-27', realDiscountPct: 0, claimedDiscountPct: null, apparentDiscountPct: null,
      coverageDays: 30, preCampaignHikeWarning: false, daysUntilStart: 0, ...partial,
    },
  };
}

describe('dueReportKind', () => {
  it('hike check once a day at/after 20:00 before the campaign', () => {
    expect(dueReportKind(campaign, '2026-11-10', 19, {})).toBeNull();
    expect(dueReportKind(campaign, '2026-11-10', 20, {})).toBe('hike');
    expect(dueReportKind(campaign, '2026-11-10', 22, { hikeDay: '2026-11-10' })).toBeNull();
  });
  it('daily during the campaign at/after 21:00', () => {
    expect(dueReportKind(campaign, '2026-11-28', 21, { daily: '2026-11-27' })).toBe('daily');
    expect(dueReportKind(campaign, '2026-11-28', 21, { daily: '2026-11-28' })).toBeNull();
  });
  it('final once within 7 days after the end', () => {
    expect(dueReportKind(campaign, '2026-12-01', 3, {})).toBe('final');
    expect(dueReportKind(campaign, '2026-12-01', 3, { final: 'x' })).toBeNull();
    expect(dueReportKind(campaign, '2026-12-09', 3, {})).toBeNull();
  });
});

describe('buildCampaignReport', () => {
  it('hike report lists only hiked trackers', () => {
    const r = buildCampaignReport(campaign, [
      item(1, { phase: 'before', verdict: 'collecting', preCampaignHikeWarning: true, runupPct: 0.2, daysUntilStart: 5 }),
      item(2, { phase: 'before', verdict: 'collecting' }),
    ], 'hike');
    expect(r?.title).toMatch(/1 üründe/);
    expect(r?.body).toContain('Ürün 1');
    expect(r?.body).not.toContain('Ürün 2');
  });
  it('no hikes → nothing to send', () => {
    expect(buildCampaignReport(campaign, [item(1, { verdict: 'collecting', phase: 'before' })], 'hike')).toBeNull();
  });
  it('final report groups by verdict, fakes first', () => {
    const r = buildCampaignReport(campaign, [
      item(1, { verdict: 'real_discount', realDiscountPct: 0.2 }),
      item(2, { verdict: 'fake_discount', runupPct: 0.3, claimedDiscountPct: 0.4 }),
    ], 'final', 'https://fiyat.example.com/');
    expect(r?.title).toMatch(/karnesi/);
    expect(r!.body.indexOf('Sahte indirim (1)')).toBeLessThan(r!.body.indexOf('Gerçek indirim (1)'));
    expect(r?.body).toContain('https://fiyat.example.com/efsane-cuma');
    expect(r?.body).toContain('önceden zam +%30');
  });
});
