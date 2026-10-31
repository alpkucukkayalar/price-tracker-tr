import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { _setDbForTesting, getDb } from './connection.js';
import { initializeSchema } from './schema.js';
import { initSettingsCrypto, _resetForTests as resetCrypto } from '../crypto/settings-crypto.js';
import { addPriceRecord, getCampaignDailyHistory } from './queries.js';

beforeEach(() => {
  resetCrypto();
  initSettingsCrypto(randomBytes(32).toString('base64'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  _setDbForTesting(db);
  initializeSchema();
});

function seedTracker(): number {
  const userId = Number(getDb().prepare(
    `INSERT INTO users (email, password_hash, display_name, role, is_active) VALUES ('u@x.com','h','U','user',1)`,
  ).run().lastInsertRowid);
  return Number(getDb().prepare(
    `INSERT INTO trackers (name, url, user_id, status, check_interval_minutes) VALUES ('T','https://www.trendyol.com/x-p-1',?,'active',360)`,
  ).run(userId).lastInsertRowid);
}

describe('migration v23 — price_history.list_price', () => {
  it('adds the nullable list_price column', () => {
    const cols = (getDb().prepare('PRAGMA table_info(price_history)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('list_price');
  });

  it('addPriceRecord stores currency + list price; legacy callers store NULL', () => {
    const t = seedTracker();
    const a = addPriceRecord(t, 1399, 'TRY', null, 1999);
    const b = addPriceRecord(t, 1499, 'TRY');
    expect(a.list_price).toBe(1999);
    expect(a.currency).toBe('TRY');
    expect(b.list_price).toBeNull();
  });

  it('getCampaignDailyHistory groups by Istanbul day and keeps the cheapest offer\'s list price', () => {
    const t = seedTracker();
    const ins = getDb().prepare(
      `INSERT INTO price_history (tracker_id, price, currency, list_price, scraped_at) VALUES (?,?,?,?,?)`,
    );
    ins.run(t, 1500, 'TRY', 2500, '2026-11-26 20:00:00'); // 23:00 Istanbul, 26th
    ins.run(t, 1400, 'TRY', 1600, '2026-11-26 22:00:00'); // 01:00 Istanbul, 27th
    ins.run(t, 1450, 'TRY', 3000, '2026-11-27 10:00:00'); // 27th
    expect(getCampaignDailyHistory(t)).toEqual([
      { date: '2026-11-26', price: 1500, listPrice: 2500 },
      { date: '2026-11-27', price: 1400, listPrice: 1600 },
    ]);
  });
});
