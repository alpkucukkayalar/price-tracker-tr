import { describe, it, expect, afterEach } from 'vitest';
import { formatMoney } from './money.js';

const orig = process.env.DISPLAY_CURRENCY;
afterEach(() => { process.env.DISPLAY_CURRENCY = orig; });

describe('formatMoney', () => {
  it('TRY (fork default) uses Turkish separators', () => {
    delete process.env.DISPLAY_CURRENCY;
    expect(formatMoney(1299.99)).toBe('1.299,99 TL');
    expect(formatMoney(12499)).toBe('12.499,00 TL');
  });
  it('USD keeps the upstream format', () => {
    process.env.DISPLAY_CURRENCY = 'USD';
    expect(formatMoney(1299.99)).toBe('$1299.99');
  });
});
