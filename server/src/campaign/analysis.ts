/**
 * Kampanya (Efsane Cuma / Black Friday) sahte indirim analizi.
 *
 * Question answered per tracker: "When the campaign came, did the price
 * really drop — or was it raised in the weeks before and then 'discounted'
 * back to where it was?"
 *
 * Reference price = the LOWEST daily price in the 30 days before the
 * campaign starts. This mirrors Turkey's discount rule (Haksız Ticari
 * Uygulamalar Yönetmeliği, Ticaret Bakanlığı 2022): an advertised discount
 * must be measured against the lowest price of the previous 30 days. A
 * discount that only beats a recently inflated price is not a discount.
 *
 * Pure functions only (no DB, no clock) — callers pass `today`.
 */

export interface CampaignConfig {
  name: string;
  /** First campaign day, 'YYYY-MM-DD' (Europe/Istanbul calendar). */
  start: string;
  /** Last campaign day, inclusive, 'YYYY-MM-DD'. */
  end: string;
}

export interface CampaignDay {
  date: string; // 'YYYY-MM-DD'
  /** Lowest observed price that day (new-condition sellers). */
  price: number;
  /** Highest struck-through "original" price the retailer showed that day. */
  listPrice: number | null;
}

export type CampaignVerdict =
  | 'collecting' // campaign hasn't started; still gathering the baseline
  | 'insufficient_data' // campaign running/over but too little pre-campaign history
  | 'real_discount' // clearly below the 30-day reference, no run-up
  | 'inflated_discount' // real drop exists, but the price was hiked first so the banner % is exaggerated
  | 'fake_discount' // no real drop vs the 30-day reference; banner % comes from a hike or an inflated list price
  | 'no_discount' // price ~unchanged, and nobody claimed otherwise
  | 'price_increased'; // campaign price is above the 30-day reference

export type CampaignPhase = 'before' | 'during' | 'after';

export interface CampaignAnalysis {
  campaign: CampaignConfig;
  phase: CampaignPhase;
  verdict: CampaignVerdict;
  /** One-line Turkish summary. */
  headline: string;
  /** Supporting Turkish detail lines. */
  details: string[];
  /** Lowest daily price in the 30 days before the campaign (legal reference). */
  reference30dLow: number | null;
  /** Median price in the early window [start-30, start-10) — the "normal" price. */
  baselineMedian: number | null;
  /** Highest daily price in the run-up window [start-10, start). */
  runupPeak: number | null;
  /** runupPeak vs baselineMedian, as a fraction (0.12 = +12%). */
  runupPct: number | null;
  /** Lowest daily price during the campaign so far. */
  campaignLow: number | null;
  campaignLowDate: string | null;
  /** (reference30dLow - campaignLow) / reference30dLow. Negative = got pricier. */
  realDiscountPct: number | null;
  /** Discount the retailer CLAIMS on the campaign-low day, from its struck-through price. */
  claimedDiscountPct: number | null;
  /** Discount measured from the run-up peak (what a "was X, now Y" banner implies). */
  apparentDiscountPct: number | null;
  /** Distinct days with data in the 30-day reference window. */
  coverageDays: number;
  /** Before the campaign: current price is already ≥ RUNUP_PCT above the baseline. */
  preCampaignHikeWarning: boolean;
  /** Days until the campaign starts (before phase), else 0. */
  daysUntilStart: number;
}

/** Real discount must be at least this deep to count (penny/rounding noise guard). */
export const REAL_DISCOUNT_MIN = 0.03;
/** A run-up of this much over the normal price counts as a pre-campaign hike. */
export const RUNUP_PCT = 0.05;
/** A retailer claim at least this large with no real drop = fake discount. */
export const CLAIM_MIN = 0.1;
/** Campaign price this far above the reference = price increased. */
export const INCREASE_TOLERANCE = 0.01;
/** Minimum distinct days of data in the 30-day reference window. */
export const MIN_COVERAGE_DAYS = 7;

const REF_DAYS = 30;
const RUNUP_DAYS = 10;
const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export function formatTry(v: number): string {
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function pct(x: number): string {
  return `%${Math.round(Math.abs(x) * 100)}`;
}

export function analyzeCampaign(days: CampaignDay[], campaign: CampaignConfig, today: string): CampaignAnalysis {
  const valid = days
    .filter(d => d.price > 0 && Number.isFinite(toMs(d.date)))
    .sort((a, b) => a.date.localeCompare(b.date));

  const phase: CampaignPhase = today < campaign.start ? 'before' : today <= campaign.end ? 'during' : 'after';
  const refStart = addDays(campaign.start, -REF_DAYS);
  const runupStart = addDays(campaign.start, -RUNUP_DAYS);
  // Before the campaign, the "reference" is measured up to today (so far).
  const refEnd = phase === 'before' ? addDays(today, 1) : campaign.start; // exclusive

  const refDays = valid.filter(d => d.date >= refStart && d.date < refEnd);
  const earlyDays = refDays.filter(d => d.date < runupStart);
  const runupDays = refDays.filter(d => d.date >= runupStart);
  // Tracking began inside the run-up window: use the first few days as the
  // best available "normal" price rather than having no baseline at all.
  const baselineSource = earlyDays.length >= 3 ? earlyDays : refDays.slice(0, Math.min(3, refDays.length));

  const reference30dLow = refDays.length ? Math.min(...refDays.map(d => d.price)) : null;
  const baselineMedian = median(baselineSource.map(d => d.price));
  const runupPeak = runupDays.length ? Math.max(...runupDays.map(d => d.price)) : null;
  const runupPct =
    baselineMedian && runupPeak !== null ? round4(runupPeak / baselineMedian - 1) : null;

  const campaignDays = valid.filter(d => d.date >= campaign.start && d.date <= campaign.end);
  let campaignLowDay: CampaignDay | null = null;
  for (const d of campaignDays) if (!campaignLowDay || d.price < campaignLowDay.price) campaignLowDay = d;
  const campaignLow = campaignLowDay?.price ?? null;

  const realDiscountPct =
    reference30dLow && campaignLow !== null ? round4((reference30dLow - campaignLow) / reference30dLow) : null;
  const claimedDiscountPct =
    campaignLowDay?.listPrice && campaignLowDay.listPrice > campaignLowDay.price
      ? round4((campaignLowDay.listPrice - campaignLowDay.price) / campaignLowDay.listPrice)
      : null;
  const apparentDiscountPct =
    runupPeak && campaignLow !== null && runupPeak > campaignLow ? round4((runupPeak - campaignLow) / runupPeak) : null;

  const coverageDays = refDays.length;
  const latest = valid.length ? valid[valid.length - 1] : null;
  const preCampaignHikeWarning =
    phase === 'before' && !!baselineMedian && !!latest && latest.price >= baselineMedian * (1 + RUNUP_PCT);
  const daysUntilStart = phase === 'before' ? Math.round((toMs(campaign.start) - toMs(today)) / DAY_MS) : 0;
  const hiked = runupPct !== null && runupPct >= RUNUP_PCT;

  const base = {
    campaign, phase, reference30dLow, baselineMedian, runupPeak, runupPct, campaignLow,
    campaignLowDate: campaignLowDay?.date ?? null, realDiscountPct, claimedDiscountPct,
    apparentDiscountPct, coverageDays, preCampaignHikeWarning, daysUntilStart,
  };
  const details: string[] = [];
  if (reference30dLow !== null) {
    details.push(
      `${phase === 'before' ? 'Şimdiye kadarki' : 'Kampanya öncesi 30 günün'} en düşük fiyatı: ${formatTry(reference30dLow)}`,
    );
  }
  if (baselineMedian !== null && runupPeak !== null && hiked) {
    details.push(
      `Kampanyadan önceki 10 günde fiyat ${formatTry(baselineMedian)} → ${formatTry(runupPeak)} yükseldi (+${pct(runupPct!)}).`,
    );
  }

  // ---- Before the campaign -------------------------------------------------
  if (phase === 'before') {
    if (preCampaignHikeWarning && latest && baselineMedian) {
      details.push(
        `Güncel fiyat ${formatTry(latest.price)}, normal fiyatın (${formatTry(baselineMedian)}) ${pct(latest.price / baselineMedian - 1)} üstünde.`,
      );
    }
    details.push(`Veri toplanan gün sayısı: ${coverageDays}. Kampanyaya ${daysUntilStart} gün var.`);
    return {
      ...base,
      verdict: 'collecting',
      headline: preCampaignHikeWarning
        ? `Dikkat: kampanya öncesi zam görünüyor (${daysUntilStart} gün kaldı)`
        : `Veri toplanıyor — ${campaign.name} başlangıcına ${daysUntilStart} gün var`,
      details,
    };
  }

  // ---- During / after ------------------------------------------------------
  if (campaignLow === null) {
    return {
      ...base,
      verdict: 'insufficient_data',
      headline: 'Kampanya döneminde henüz fiyat okunamadı',
      details,
    };
  }
  details.push(`Kampanyadaki en düşük fiyat: ${formatTry(campaignLow)} (${campaignLowDay!.date})`);
  if (claimedDiscountPct !== null) {
    details.push(`Sitenin iddia ettiği indirim: ${pct(claimedDiscountPct)} (üstü çizili ${formatTry(campaignLowDay!.listPrice!)})`);
  }
  if (realDiscountPct !== null) {
    details.push(
      realDiscountPct >= 0
        ? `30 günlük en düşüğe göre gerçek indirim: ${pct(realDiscountPct)}`
        : `30 günlük en düşüğe göre fiyat ${pct(realDiscountPct)} DAHA YÜKSEK`,
    );
  }

  if (coverageDays < MIN_COVERAGE_DAYS || reference30dLow === null || realDiscountPct === null) {
    details.push(`Kampanya öncesi yalnızca ${coverageDays} günlük veri var (en az ${MIN_COVERAGE_DAYS} gerekli).`);
    return { ...base, verdict: 'insufficient_data', headline: 'Karar için yeterli geçmiş veri yok', details };
  }

  if (realDiscountPct >= REAL_DISCOUNT_MIN) {
    if (hiked) {
      return {
        ...base,
        verdict: 'inflated_discount',
        headline: `Gerçek ama abartılı indirim: gerçek ${pct(realDiscountPct)}, görünen ${pct(apparentDiscountPct ?? claimedDiscountPct ?? realDiscountPct)}`,
        details,
      };
    }
    return { ...base, verdict: 'real_discount', headline: `Gerçek indirim: 30 günlük en düşükten ${pct(realDiscountPct)} ucuz`, details };
  }

  const claimed = claimedDiscountPct !== null && claimedDiscountPct >= CLAIM_MIN;
  if (hiked || claimed) {
    return {
      ...base,
      verdict: 'fake_discount',
      headline: hiked
        ? 'Sahte indirim: önce zam yapılmış, sonra eski fiyata "indirilmiş"'
        : `Sahte indirim: site ${pct(claimedDiscountPct!)} indirim diyor, gerçek fark ${pct(Math.max(0, realDiscountPct))}`,
      details,
    };
  }
  if (campaignLow > reference30dLow * (1 + INCREASE_TOLERANCE)) {
    return { ...base, verdict: 'price_increased', headline: 'Kampanyada fiyat yükseldi', details };
  }
  return { ...base, verdict: 'no_discount', headline: 'İndirim yok: fiyat son 30 günle aynı seviyede', details };
}
