/**
 * Auto-attach an Akakçe product page to every tracker.
 *
 * One Akakçe page carries the lowest price across all Turkish stores
 * (including ones that block us directly, like Hepsiburada), so each tracker
 * gets its Akakçe page as an extra seller when a confident match exists.
 * Conservative: the best search hit must contain ≥ AKAKCE_AUTO_MIN_SCORE of
 * the tracker name's words; otherwise nothing is added (the user can still
 * use "Diğer sitelerde bul"). Each tracker is attempted once (settings stamp);
 * fetch errors are not stamped, so they are retried on the next startup.
 */
import { getDb } from '../db/connection.js';
import {
  addTrackerUrl, getSetting, getTrackerById, getTrackerUrlsForTracker, refreshTrackerAggregates, setSetting,
} from '../db/queries.js';
import { checkTrackerUrl } from '../scheduler/cron.js';
import { fetchPageContent } from '../scraper/browser.js';
import { buildSearchUrl, parseSearchResults, searchQueryFromName } from '../scraper/product-search.js';
import { isTurkishAggregator } from '../scraper/turkish-retailers.js';
import { logger } from '../logger.js';

export const AKAKCE_AUTO_MIN_SCORE = 0.75;
const stamp = (trackerId: number) => `akakce_auto:${trackerId}`;

export type AkakceAutoResult = 'added' | 'present' | 'no_match' | 'skipped' | 'error';

export async function autoAddAkakce(trackerId: number): Promise<AkakceAutoResult> {
  const tracker = getTrackerById(trackerId);
  if (!tracker || tracker.status === 'purchased') return 'skipped';
  if (getSetting(stamp(trackerId), tracker.user_id)) return 'skipped';
  if (getTrackerUrlsForTracker(trackerId).some(u => isTurkishAggregator(u.url))) {
    setSetting(stamp(trackerId), 'present', tracker.user_id);
    return 'present';
  }
  const query = searchQueryFromName(tracker.name);
  try {
    const { html } = await fetchPageContent(buildSearchUrl('akakce', query));
    const best = parseSearchResults('akakce', html, query, 1)[0];
    if (!best || best.score < AKAKCE_AUTO_MIN_SCORE) {
      setSetting(stamp(trackerId), `no_match:${best?.url ?? ''}`, tracker.user_id);
      logger.info({ trackerId, query, best }, 'Akakçe auto-match: no confident match');
      return 'no_match';
    }
    const seller = addTrackerUrl(trackerId, best.url, 'new');
    refreshTrackerAggregates(trackerId);
    setSetting(stamp(trackerId), `added:${best.url}`, tracker.user_id);
    logger.info({ trackerId, url: best.url, score: best.score }, 'Akakçe auto-match: seller added');
    await checkTrackerUrl(seller.id, true).catch(() => undefined);
    return 'added';
  } catch (err) {
    logger.warn({ trackerId, err: err instanceof Error ? err.message : String(err) }, 'Akakçe auto-match failed');
    return 'error';
  }
}

/** Attempt every not-yet-attempted tracker, one at a time with a pause between. */
export async function backfillAkakce(pauseMs = 20_000): Promise<void> {
  const ids = (getDb().prepare(
    "SELECT id FROM trackers WHERE status != 'purchased' ORDER BY id",
  ).all() as { id: number }[]).map(r => r.id);
  for (const id of ids) {
    const r = await autoAddAkakce(id);
    if (r === 'added' || r === 'no_match' || r === 'error') {
      await new Promise(res => setTimeout(res, pauseMs));
    }
  }
}

let backfillTimer: NodeJS.Timeout | null = null;

/** Run the backfill once, a few minutes after startup (AKAKCE_AUTO=0 disables). */
export function startAkakceBackfill(delayMs = 3 * 60_000): void {
  if (process.env.AKAKCE_AUTO === '0') return;
  backfillTimer = setTimeout(() => {
    backfillAkakce().catch(err => logger.warn({ err }, 'Akakçe backfill failed'));
  }, delayMs);
  backfillTimer.unref?.();
}

export function stopAkakceBackfill(): void {
  if (backfillTimer) clearTimeout(backfillTimer);
  backfillTimer = null;
}
