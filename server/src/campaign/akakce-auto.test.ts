import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const fetchMock = vi.fn();
vi.mock('../scraper/browser.js', () => ({ fetchPageContent: (...a: unknown[]) => fetchMock(...a) }));
vi.mock('../scheduler/cron.js', () => ({ checkTrackerUrl: vi.fn(async () => undefined) }));

import { _setDbForTesting, getDb } from '../db/connection.js';
import { initializeSchema } from '../db/schema.js';
import { initSettingsCrypto, _resetForTests as resetCrypto } from '../crypto/settings-crypto.js';
import { createTracker, getTrackerUrlsForTracker } from '../db/queries.js';
import { autoAddAkakce } from './akakce-auto.js';

const SEARCH = `<ul><li><a href="/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html" title="Aqara FP300 Matter Akıllı Sensör"></a>
  <span>3.266<i>,01 TL</i></span></li></ul>`;

function seedTracker(name: string, url = 'https://www.hepsiburada.com/aqara-fp300-p-HBC1'): number {
  const userId = Number(getDb().prepare(
    `INSERT INTO users (email, password_hash, display_name, role, is_active) VALUES ('t@x.com','h','T','user',1)`,
  ).run().lastInsertRowid);
  return createTracker({ name, url, user_id: userId }).id;
}

beforeEach(() => {
  resetCrypto();
  initSettingsCrypto(randomBytes(32).toString('base64'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  _setDbForTesting(db);
  initializeSchema();
  fetchMock.mockReset();
});

describe('autoAddAkakce', () => {
  it('adds a confident Akakçe match once', async () => {
    fetchMock.mockResolvedValue({ html: SEARCH, finalUrl: 'x' });
    const id = seedTracker('Aqara FP300 Sensör');
    expect(await autoAddAkakce(id)).toBe('added');
    expect(fetchMock).toHaveBeenCalledWith('https://www.akakce.com/arama/?q=Aqara%20FP300%20Sens%C3%B6r');
    expect(getTrackerUrlsForTracker(id).map(u => u.url)).toContain(
      'https://www.akakce.com/akilli-sensor/en-ucuz-aqara-fp300-matter-fiyati,1735200190.html',
    );
    expect(await autoAddAkakce(id)).toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds nothing for a weak match', async () => {
    fetchMock.mockResolvedValue({ html: SEARCH, finalUrl: 'x' });
    const id = seedTracker('Logitech MX Master 3S Mouse');
    expect(await autoAddAkakce(id)).toBe('no_match');
    expect(getTrackerUrlsForTracker(id)).toHaveLength(1);
  });

  it('does not stamp on fetch errors, so it retries later', async () => {
    fetchMock.mockRejectedValueOnce(new Error('blocked'));
    const id = seedTracker('Aqara FP300 Sensör');
    expect(await autoAddAkakce(id)).toBe('error');
    fetchMock.mockResolvedValue({ html: SEARCH, finalUrl: 'x' });
    expect(await autoAddAkakce(id)).toBe('added');
  });

  it('skips trackers that already have an Akakçe seller', async () => {
    const id = seedTracker('Aqara FP300', 'https://www.akakce.com/x/en-ucuz-aqara-fiyati,1.html');
    expect(await autoAddAkakce(id)).toBe('present');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
