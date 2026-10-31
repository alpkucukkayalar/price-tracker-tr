import { config } from '../config.js';
import { addDays, type CampaignConfig } from './analysis.js';

/** The configured campaign (env CAMPAIGN_NAME / CAMPAIGN_START / CAMPAIGN_END). */
export function getCampaign(): CampaignConfig {
  return { name: config.campaignName, start: config.campaignStart, end: config.campaignEnd };
}

/**
 * Today's calendar date in Europe/Istanbul. Turkey has been fixed UTC+3
 * (no DST) since 2016, so a constant offset is exact.
 */
export function istanbulToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Campaign check-interval cap in minutes while the campaign (plus
 * CAMPAIGN_BOOST_LEAD_DAYS before it) is running, else null. The scheduler
 * checks every seller at least this often during the window so a short
 * flash price isn't missed between 6-hourly checks.
 */
export function campaignBoostIntervalMinutes(
  now: Date = new Date(),
  campaign: CampaignConfig = getCampaign(),
  intervalMinutes: number = config.campaignCheckIntervalMinutes,
  leadDays: number = config.campaignBoostLeadDays,
): number | null {
  if (!intervalMinutes || intervalMinutes < 1) return null;
  const today = istanbulToday(now);
  if (today >= addDays(campaign.start, -Math.max(0, leadDays)) && today <= campaign.end) return intervalMinutes;
  return null;
}
