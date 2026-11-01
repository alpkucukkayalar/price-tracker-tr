import {
  getStoredToken, setStoredToken, clearStoredToken, getServerUrl, setServerUrl, normalizeServerUrl,
} from '../lib/api.js';
import type { ExtensionResponse } from '../lib/messages.js';

const tokenInput = document.getElementById('token') as HTMLInputElement;
const serverInput = document.getElementById('server') as HTMLInputElement;
const settingsLink = document.getElementById('settings-link') as HTMLAnchorElement;
const status = document.getElementById('status')!;

const showServer = (origin: string) => {
  serverInput.value = origin;
  settingsLink.href = `${origin}/settings`;
};

(async () => {
  showServer(await getServerUrl());
  const existing = await getStoredToken();
  if (existing) {
    tokenInput.value = existing;
    setStatus(`Anahtar yüklü (${existing.slice(0, 8)}…).`, 'ok');
  }
})();

/** localhost is allowed by the manifest; any other address needs the user's OK once. */
async function ensureHostPermission(origin: string): Promise<boolean> {
  const host = new URL(origin).hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const origins = [`${origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

document.getElementById('save')!.addEventListener('click', async () => {
  const origin = normalizeServerUrl(serverInput.value);
  if (!origin) { setStatus('Adres geçersiz. Örnek: http://localhost:3100', 'err'); return; }
  if (!(await ensureHostPermission(origin))) {
    setStatus('Bu adrese erişim izni verilmedi.', 'err');
    return;
  }
  await setServerUrl(origin);
  showServer(origin);
  const v = tokenInput.value.trim();
  if (v) await setStoredToken(v);
  setStatus(v ? 'Kaydedildi.' : 'Adres kaydedildi. Şimdi API anahtarını yapıştır.', v ? 'ok' : null);
});

document.getElementById('clear')!.addEventListener('click', async () => {
  await clearStoredToken();
  tokenInput.value = '';
  setStatus('Anahtar silindi.', 'ok');
});

document.getElementById('test')!.addEventListener('click', async () => {
  setStatus('Deneniyor…', null);
  const resp = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }) as ExtensionResponse;
  if (resp.ok) setStatus('Bağlantı çalışıyor ✓', 'ok');
  else setStatus(`Olmadı: ${resp.error}${resp.detail ? ' — ' + resp.detail : ''}`, 'err');
});

function setStatus(text: string, cls: 'ok' | 'err' | null) {
  status.textContent = text;
  status.className = 'status' + (cls ? ' ' + cls : '');
}
