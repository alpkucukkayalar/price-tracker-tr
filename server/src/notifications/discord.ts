import { L } from '../lib/i18n.js';
import type { Tracker, TrackerUrlCondition } from '../db/queries.js';
import type { Confidence } from '../ai/confidence.js';
import { logger } from '../logger.js';
import { conditionLabel, formatPriceWithCondition } from './condition-label.js';

function discordTitlePrefix(level: Confidence['level']): string {
  if (level === 'HIGH') return L('🟢 STRONG BUY — ', '🟢 KESİN AL — ');
  if (level === 'MEDIUM') return L('🟡 GOOD DEAL — ', '🟡 İYİ FIRSAT — ');
  return '';
}

/**
 * Pure HTTP sender for Discord. Threshold checks and cooldown are handled
 * upstream in cron.ts so all notification channels share the same logic.
 *
 * `condition` (when non-'new') tags the Current Price field so a user sees
 * "$239.00 (Warehouse)" instead of just "$239.00" — disambiguates a
 * winning warehouse / refurb / open-box listing from a fresh-new one.
 */
export async function sendDiscordPriceAlert(
  tracker: Tracker,
  currentPrice: number,
  webhookUrl: string,
  aiCommentary?: string | null,
  confidence?: Confidence | null,
  condition?: TrackerUrlCondition | null,
  low?: { tier: string; context: string } | null,
): Promise<boolean> {
  // Record-low alerts (phase 1) fire without a threshold; all others need one.
  if (!tracker.threshold_price && !low) return false;

  const titlePrefix = confidence ? discordTitlePrefix(confidence.level) : '';

  const fields: Record<string, unknown>[] = [
    { name: L('Current Price', 'Güncel Fiyat'), value: formatPriceWithCondition(currentPrice, condition), inline: true },
  ];
  if (tracker.threshold_price) {
    fields.push(
      { name: L('Threshold', 'Hedef'), value: `${formatMoney(tracker.threshold_price)}`, inline: true },
      { name: L('Savings', 'Tasarruf'), value: `${formatMoney((tracker.threshold_price - currentPrice))}`, inline: true },
    );
  }
  if (low) {
    fields.push({
      name: low.tier === 'back_in_stock' ? L('Stock', 'Stok') : L('Record', 'Rekor'),
      value: low.context,
      inline: false,
    });
  }

  const embed: Record<string, unknown> = {
    title: low && !tracker.threshold_price
      ? `${titlePrefix}${low.tier === 'back_in_stock' ? L('Back in Stock', 'Tekrar Stokta') : L('Record Low', 'En Düşük Fiyat')}: ${tracker.name}`
      : `${titlePrefix}${L('Price Drop Alert: ', 'Fiyat Düştü: ')}${tracker.name}`,
    color: 0x00c853,
    fields,
    url: tracker.url,
    timestamp: new Date().toISOString(),
    footer: { text: L('Price Tracker', 'Fiyat Takip') },
  };

  // Build description: aiCommentary (when present) above reasons line.
  const descriptionParts: string[] = [];
  if (aiCommentary) descriptionParts.push(aiCommentary);
  if (confidence && confidence.reasons.length > 0) {
    descriptionParts.push(confidence.reasons.join(' · '));
  }
  if (descriptionParts.length > 0) {
    embed.description = descriptionParts.join('\n');
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, body: await response.text(), trackerId: tracker.id },
        'Discord webhook failed',
      );
      return false;
    }

    logger.info({ trackerId: tracker.id, price: currentPrice }, 'Discord price alert sent');
    return true;
  } catch (err) {
    logger.error({ err, trackerId: tracker.id }, 'Discord webhook request failed');
    return false;
  }
}

/** Digest delivery (phase 3): one embed; description capped to Discord's 4096 limit. */
export async function sendDiscordDigest(
  title: string,
  description: string,
  webhookUrl: string,
): Promise<boolean> {
  const embed = {
    title,
    description: description.length > 4000 ? description.slice(0, 4000) + '\u2026' : description,
    color: 0x2563eb,
    timestamp: new Date().toISOString(),
    footer: { text: L('Price Tracker', 'Fiyat Takip') },
  };
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'Discord digest failed');
      return false;
    }
    logger.info('Discord digest sent');
    return true;
  } catch (err) {
    logger.error({ err }, 'Discord digest request failed');
    return false;
  }
}

export async function sendDiscordErrorAlert(
  tracker: Tracker,
  error: string,
  webhookUrl: string,
): Promise<boolean> {
  const embed = {
    title: `${L('Tracker Error: ', 'Takip Hatası: ')}${tracker.name}`,
    color: 0xff1744,
    description: `${L(`Failed to check price after ${tracker.consecutive_failures} consecutive attempts.`, `Fiyat art arda ${tracker.consecutive_failures} kez okunamadı.`)}`,
    fields: [
      { name: L('Error', 'Hata'), value: error.slice(0, 1024) },
      { name: 'URL', value: tracker.url },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: L('Price Tracker', 'Fiyat Takip') },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return response.ok;
  } catch (err) {
    logger.error({ err, trackerId: tracker.id }, 'Discord error alert failed');
    return false;
  }
}

import type { Project, BasketState, BasketMember } from '../projects/types.js';
import { formatMoney } from '../lib/money.js';

export async function sendDiscordBasketAlert(
  project: Project,
  basket: BasketState,
  members: BasketMember[],
  webhookUrl: string,
  aiCommentary?: string | null,
): Promise<boolean> {
  if (basket.total === null) return false;
  const savings = formatMoney(project.target_total - basket.total);
  const memberLines = members
    .map(m => `• ${m.tracker_name} — ${formatMoney((m.last_price ?? 0))}`)
    .join('\n');
  const baseDescription = `${memberLines}`;
  const description = aiCommentary
    ? `${baseDescription}\n\n${aiCommentary}`
    : baseDescription;

  const embed: Record<string, unknown> = {
    title: `${L('Bundle Ready: ', 'Sepet Hazır: ')}${project.name}`,
    color: 0x00c853,
    description,
    fields: [
      { name: L('Total', 'Toplam'), value: `${formatMoney(basket.total)}`, inline: true },
      { name: L('Target', 'Hedef'), value: `${formatMoney(project.target_total)}`, inline: true },
      { name: L('Savings', 'Tasarruf'), value: savings, inline: true },
      { name: L('Items', 'Ürünler'), value: String(basket.item_count), inline: true },
    ],
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return resp.ok;
  } catch (err) {
    logger.error({ err, projectId: project.id }, 'Discord basket alert failed');
    return false;
  }
}

export async function sendDiscordPurchaseArm(
  trackerName: string,
  currentPrice: number,
  threshold: number,
  buyUrl: string,
  webhookUrl: string,
): Promise<boolean> {
  const embed = {
    title: `🛒 ${L('Ready to buy: ', 'Almaya hazır: ')}${trackerName}`,
    color: 0xff9900,
    description: `Hit **${formatMoney(currentPrice)}** (your limit ${formatMoney(threshold)}).`,
    fields: [{ name: L('Approve', 'Onayla'), value: `[Review & buy →](${buyUrl})` }],
  };
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return resp.ok;
  } catch (err) {
    logger.error({ err }, 'Discord purchase-arm failed');
    return false;
  }
}

export async function testDiscordWebhook(webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: L('Price Tracker - Test Notification', 'Fiyat Takip - Test Bildirimi'),
          description: L('Webhook is working correctly!', 'Webhook düzgün çalışıyor!'),
          color: 0x2196f3,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Discord returned ${response.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
