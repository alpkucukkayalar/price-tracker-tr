import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { _setDbForTesting, getDb } from './connection.js';
import { initializeSchema } from './schema.js';
import { initSettingsCrypto, _resetForTests as resetCrypto } from '../crypto/settings-crypto.js';
import { createTracker, getTrackerById, saveDashboardLayout, setTrackerImageIfMissing } from './queries.js';

function user(email: string): number {
  return Number(getDb().prepare(
    `INSERT INTO users (email, password_hash, display_name, role, is_active) VALUES (?, 'h', 'T', 'user', 1)`,
  ).run(email).lastInsertRowid);
}

beforeEach(() => {
  resetCrypto();
  initSettingsCrypto(randomBytes(32).toString('base64'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  _setDbForTesting(db);
  initializeSchema();
});

describe('dashboard layout', () => {
  it('saves group/order only for the owner', () => {
    const a = user('a@x.com');
    const b = user('b@x.com');
    const ta = createTracker({ name: 'A', url: 'https://www.trendyol.com/x-p-1', user_id: a });
    const tb = createTracker({ name: 'B', url: 'https://www.trendyol.com/x-p-2', user_id: b });
    expect(getTrackerById(ta.id)!.dash_group).toBe(0);
    expect(saveDashboardLayout(a, [{ id: ta.id, group: 2, order: 5 }, { id: tb.id, group: 1, order: 1 }])).toBe(1);
    expect(getTrackerById(ta.id)).toMatchObject({ dash_group: 2, dash_order: 5 });
    expect(getTrackerById(tb.id)).toMatchObject({ dash_group: 0, dash_order: 0 });
  });

  it('keeps the first product image', () => {
    const a = user('a@x.com');
    const t = createTracker({ name: 'A', url: 'https://www.trendyol.com/x-p-1', user_id: a });
    setTrackerImageIfMissing(t.id, 'https://cdn.example/1.jpg');
    setTrackerImageIfMissing(t.id, 'https://cdn.example/2.jpg');
    expect(getTrackerById(t.id)!.image_url).toBe('https://cdn.example/1.jpg');
  });
});
