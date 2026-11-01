/**
 * Server-side message language for notifications. Turkish by default
 * (price-tracker-tr); set APP_LANG=en for the original English texts.
 * Tests pin APP_LANG=en (vitest.config.ts) so upstream assertions hold.
 */
export function appLang(): string {
  return (process.env.APP_LANG || 'tr').toLowerCase();
}

/** Pick the English or Turkish variant of a user-facing message. */
export function L(en: string, tr: string): string {
  return appLang() === 'tr' ? tr : en;
}
