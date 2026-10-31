import { useEffect, useState } from 'react';
import { Plug, Copy, X } from 'lucide-react';
import { listApiTokens, createApiToken, revokeApiToken, type ApiTokenSummary, type CreatedApiToken } from '../api';
import { t, ago } from '../lib/i18n'

export function ConnectedAppsCard() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setTokens(await listApiTokens()); }
    catch (e) { setError(String(e)); }
  }

  useEffect(() => { refresh(); }, []);

  async function handleGenerate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tok = await createApiToken(name.trim());
      setCreated(tok);
      setName('');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: number) {
    if (!confirm(t('Revoke this token? Anything using it will stop working.'))) return;
    try {
      await revokeApiToken(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function closeDialog() {
    setShowDialog(false);
    setCreated(null);
    setName('');
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function fmtLastUsed(ms: number | null): string {
    if (!ms) return 'never';
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    if (days === 0) return 'today';
    if (days === 1) return ago(1, 'd');
    return ago(days, 'd');
  }

  return (
    <section className="bg-surface border border-border rounded-lg p-4">
      <header className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Plug className="w-5 h-5" /> {t('Connected Apps')}
        </h2>
        <button
          onClick={() => setShowDialog(true)}
          className="text-sm bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded"
        >
          {t('Generate new token')}
        </button>
      </header>

      {error && <div className="text-danger text-sm mb-2">{error}</div>}

      {tokens.length === 0 ? (
        <p className="text-text-muted text-sm">
          {t('No tokens yet. Generate one to connect the browser extension or other API clients.')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {tokens.map(tok => (
            <li key={tok.id} className="py-2 flex items-center gap-3 flex-wrap">
              <span className="font-medium">{tok.name}</span>
              <code className="text-text-muted text-xs">{tok.prefix}…</code>
              <span className="text-text-muted text-xs">{t('created')} {fmtDate(tok.created_at)}</span>
              <span className="text-text-muted text-xs">{t('last used')} {fmtLastUsed(tok.last_used_at)}</span>
              {tok.revoked_at && <span className="text-danger text-xs">{t('revoked')}</span>}
              <span className="flex-1" />
              {!tok.revoked_at && (
                <button
                  onClick={() => handleRevoke(tok.id)}
                  className="text-text-muted hover:text-danger text-sm"
                >
                  {t('Revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg p-6 max-w-md w-full">
            <header className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">{created ? t('Token created') : t('Generate token')}</h3>
              <button onClick={closeDialog} className="text-text-muted hover:text-text"><X className="w-4 h-4" /></button>
            </header>

            {!created ? (
              <>
                <label className="block text-xs uppercase text-text-muted mb-1">{t('Name')}</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('e.g. Browser Extension')}
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 mb-3"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={closeDialog} className="text-sm px-3 py-1.5">{t('Cancel')}</button>
                  <button
                    onClick={handleGenerate}
                    disabled={busy || !name.trim()}
                    className="text-sm bg-primary text-white px-3 py-1.5 rounded disabled:opacity-50"
                  >
                    {t('Generate')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-warning mb-2">
                  {t('Copy this now — you won\'t see it again.')}
                </p>
                <code className="block bg-bg border border-border rounded p-2 text-xs break-all mb-3">
                  {created.token}
                </code>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(created.token)}
                    className="text-sm bg-primary text-white px-3 py-1.5 rounded flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> {t('Copy')}
                  </button>
                  <button onClick={closeDialog} className="text-sm px-3 py-1.5">{t('Done')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
