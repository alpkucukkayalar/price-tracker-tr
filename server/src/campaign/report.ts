/**
 * Kampanya bildirimleri (Efsane Cuma / Black Friday).
 *
 * Three messages, all through the user's digest channel (ntfy → Discord →
 * email → webhook, or the explicit digest_channel setting):
 *   - hike:  BEFORE the campaign, when the set of trackers showing a
 *            pre-campaign price hike changes (checked once a day at 20:00
 *            Istanbul). "Bu ürünlerde kampanya öncesi zam var."
 *   - daily: DURING the campaign, one summary per day at 21:00 Istanbul.
 *   - final: once, on the first tick after the campaign ends (within 7 days).
 *
 * Every send is stamped in per-user settings so restarts never double-send.
 */
import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { getSetting, setSetting, getAllTrackers, getCampaignDailyHistory } from '../db/queries.js';
import { getEnabledChannels } from '../scheduler/cron.js';
import { resolveDigestChannel } from '../digest/cron.js';
import { sendNtfyDigest } from '../notifications/ntfy.js';
import { sendDiscordDigest } from '../notifications/discord.js';
import { sendEmailDigest } from '../notifications/email.js';
import { sendGenericDigest } from '../notifications/webhook.js';
import { analyzeCampaign, addDays, formatTry, type CampaignAnalysis, type CampaignConfig } from './analysis.js';
import { getCampaign, istanbulToday } from './config.js';
import { logger } from '../logger.js';

export type ReportKind = 'hike' | 'daily' | 'final';

export interface ReportItem {
  id: number;
  name: string;
  lastPrice: number | null;
  analysis: CampaignAnalysis;
}

const pct = (x: number | null) => (x === null ? '—' : `%${Math.round(Math.abs(x) * 100)}`);

function line(item: ReportItem): string {
  const a = item.analysis;
  const now = item.lastPrice !== null ? formatTry(item.lastPrice) : '—';
  const ref = a.reference30dLow !== null ? formatTry(a.reference30dLow) : '—';
  const parts = [`• ${item.name}: ${a.headline}`];
  const nums = [`şimdi ${now}`, `30g en düşük ${ref}`];
  if (a.runupPct !== null && a.runupPct > 0) nums.push(`önceden zam +${pct(a.runupPct)}`);
  if (a.claimedDiscountPct !== null) nums.push(`iddia ${pct(a.claimedDiscountPct)}`);
  if (a.realDiscountPct !== null) nums.push(`gerçek ${a.realDiscountPct < 0 ? '-' : ''}${pct(a.realDiscountPct)}`);
  parts.push(`  (${nums.join(' · ')})`);
  return parts.join('\n');
}

const SECTIONS: Array<{ title: string; verdicts: CampaignAnalysis['verdict'][] }> = [
  { title: '🚩 Sahte indirim', verdicts: ['fake_discount'] },
  { title: '📈 Fiyatı artan', verdicts: ['price_increased'] },
  { title: '⚠️ Abartılı indirim', verdicts: ['inflated_discount'] },
  { title: '✅ Gerçek indirim', verdicts: ['real_discount'] },
  { title: '➖ İndirim yok', verdicts: ['no_discount'] },
  { title: '❔ Yetersiz veri', verdicts: ['insufficient_data'] },
];

/** Pure renderer. Returns null when there is nothing worth sending. */
export function buildCampaignReport(
  campaign: CampaignConfig,
  items: ReportItem[],
  kind: ReportKind,
  publicUrl = '',
): { title: string; body: string } | null {
  const link = publicUrl ? `\n\nDetaylar: ${publicUrl.replace(/\/$/, '')}/efsane-cuma` : '';
  if (kind === 'hike') {
    const hikes = items.filter(i => i.analysis.preCampaignHikeWarning);
    if (hikes.length === 0) return null;
    const days = hikes[0].analysis.daysUntilStart;
    return {
      title: `⚠️ ${campaign.name}: ${hikes.length} üründe kampanya öncesi zam`,
      body:
        `Kampanyaya ${days} gün var. Şu ürünlerin fiyatı normal seviyesinin üstüne çıktı — ` +
        `kampanyada "indirim" görürsen önce buraya bak:\n\n` +
        hikes.map(line).join('\n') +
        link,
    };
  }
  const analyzed = items.filter(i => i.analysis.verdict !== 'collecting');
  if (analyzed.length === 0) return null;
  const count = (v: CampaignAnalysis['verdict']) => analyzed.filter(i => i.analysis.verdict === v).length;
  const summary =
    `Gerçek: ${count('real_discount')} · Abartılı: ${count('inflated_discount')} · ` +
    `Sahte: ${count('fake_discount')} · Yok/zam: ${count('no_discount') + count('price_increased')}`;
  const blocks = SECTIONS.map(s => {
    const rows = analyzed.filter(i => s.verdicts.includes(i.analysis.verdict));
    return rows.length ? `${s.title} (${rows.length})\n${rows.map(line).join('\n')}` : '';
  }).filter(Boolean);
  return {
    title: kind === 'final' ? `${campaign.name} bitti — indirim karnesi` : `${campaign.name} günlük özet`,
    body: `${summary}\n\n${blocks.join('\n\n')}${link}`,
  };
}

/** Which report (if any) is due for this user right now. Pure. */
export function dueReportKind(
  campaign: CampaignConfig,
  today: string,
  istanbulHour: number,
  stamps: { final?: string; daily?: string; hikeDay?: string },
): ReportKind | null {
  if (today > campaign.end) {
    if (stamps.final) return null;
    return today <= addDays(campaign.end, 7) ? 'final' : null;
  }
  if (today >= campaign.start) {
    return istanbulHour >= 21 && stamps.daily !== today ? 'daily' : null;
  }
  return istanbulHour >= 20 && stamps.hikeDay !== today ? 'hike' : null;
}

function stampKey(campaign: CampaignConfig, suffix: string): string {
  return `campaign_report:${campaign.start}:${suffix}`;
}

export async function runCampaignReportForUser(
  userId: number,
  now: Date = new Date(),
  opts: { force?: ReportKind } = {},
): Promise<'sent' | 'not_due' | 'nothing' | 'no_channel' | 'send_failed'> {
  const campaign = getCampaign();
  const today = istanbulToday(now);
  const hour = (now.getUTCHours() + 3) % 24;
  const stamps = {
    final: getSetting(stampKey(campaign, 'final'), userId),
    daily: getSetting(stampKey(campaign, 'daily'), userId),
    hikeDay: getSetting(stampKey(campaign, 'hike_day'), userId),
  };
  const kind = opts.force ?? dueReportKind(campaign, today, hour, stamps);
  if (!kind) return 'not_due';

  const items: ReportItem[] = getAllTrackers(userId)
    .filter(t => t.status !== 'purchased')
    .map(t => ({
      id: t.id,
      name: t.name,
      lastPrice: t.last_price,
      analysis: analyzeCampaign(getCampaignDailyHistory(t.id), campaign, today),
    }));

  const stamp = (): void => {
    if (kind === 'final') setSetting(stampKey(campaign, 'final'), now.toISOString(), userId);
    if (kind === 'daily') setSetting(stampKey(campaign, 'daily'), today, userId);
    if (kind === 'hike') setSetting(stampKey(campaign, 'hike_day'), today, userId);
  };

  // Hike alerts only when the set of hiked trackers changed since last time.
  if (kind === 'hike' && !opts.force) {
    const ids = items.filter(i => i.analysis.preCampaignHikeWarning).map(i => i.id).sort((a, b) => a - b).join(',');
    const prev = getSetting(stampKey(campaign, 'hike_ids'), userId) ?? '';
    if (ids === prev) {
      stamp();
      return 'nothing';
    }
    setSetting(stampKey(campaign, 'hike_ids'), ids, userId);
  }

  const report = buildCampaignReport(campaign, items, kind, process.env.PUBLIC_URL || '');
  if (!report) {
    stamp();
    return 'nothing';
  }

  const channels = getEnabledChannels(userId);
  const channel = resolveDigestChannel(getSetting('digest_channel', userId), channels);
  if (!channel) return 'no_channel';

  let ok = false;
  switch (channel) {
    case 'ntfy':
      ok = await sendNtfyDigest(report.title, report.body, channels.ntfy!, channels.ntfyToken, process.env.PUBLIC_URL || undefined);
      break;
    case 'discord':
      ok = await sendDiscordDigest(report.title, report.body, channels.discord!);
      break;
    case 'email': {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      ok = await sendEmailDigest(channels.email!, report.title, report.body, `<pre style="font-family:inherit;white-space:pre-wrap">${esc(report.body)}</pre>`);
      break;
    }
    case 'webhook':
      ok = await sendGenericDigest(channels.webhook!, { title: report.title, body: report.body, campaign, kind, items });
      break;
  }
  if (!ok) return 'send_failed';
  stamp();
  logger.info({ userId, kind, channel }, 'campaign report sent');
  return 'sent';
}

async function tick(): Promise<void> {
  const users = getDb().prepare('SELECT id FROM users WHERE is_active = 1').all() as Array<{ id: number }>;
  for (const { id } of users) {
    try {
      await runCampaignReportForUser(id);
    } catch (err) {
      logger.error({ userId: id, err }, 'campaign report: tick failed for user');
    }
  }
}

let task: cron.ScheduledTask | null = null;

export function startCampaignReportCron(): void {
  if (task) return;
  // Minute 12 — clear of the scraper burst and the digest at minute 7.
  task = cron.schedule('12 * * * *', () => { void tick(); });
  logger.info('Campaign report cron started (hourly check, minute 12)');
}

export function stopCampaignReportCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
