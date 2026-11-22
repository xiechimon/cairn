import type { DesktopNotifyPayload } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { showPendingRollbackNotice } from '../src/desktop-shell.js';
import type { Locale } from '../src/i18n/locale.js';

const CJK = /[一-鿿]/;
const NOTICE = {
  failedVersion: '0.44.0',
  restoredVersion: '0.43.2',
  logPath: '/Users/x/Library/Logs/update.log',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function storedLocale(locale: Locale) {
  const map = new Map<string, string>([
    ['cairn.locale', locale],
    ['cairn-locale', locale],
  ]);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** The renderer sees the notice once: rollbackNotice() resolves it, the
 *  localized payload lands on the real notify bridge. */
async function delivered(locale: Locale): Promise<DesktopNotifyPayload> {
  const shown: DesktopNotifyPayload[] = [];
  vi.stubGlobal('window', {
    localStorage: storedLocale(locale),
    cairnDesktop: {
      update: { rollbackNotice: () => Promise.resolve(NOTICE) },
      notify: { show: (payload: DesktopNotifyPayload) => shown.push(payload) },
    },
  });
  vi.stubGlobal('navigator', { language: locale === 'zh' ? 'zh-CN' : 'en-US' });
  await showPendingRollbackNotice();
  const [payload] = shown;
  if (payload === undefined) throw new Error('nothing was notified');
  return payload;
}

test('a rolled-back update tells a Chinese desktop in Chinese, with a dialog fallback', async () => {
  const payload = await delivered('zh');
  expect(payload.title).toBe('Cairn 回滚了更新');
  expect(payload.body).toBe('0.44.0 没能启动，Cairn 装回了 0.43.2。');
  expect(payload.dialog?.title).toBe(payload.title);
  expect(payload.dialog?.detail).toContain(NOTICE.logPath);
  expect(payload.href).toBe('/app');
});

test('the same notice is English on an English desktop, never Chinese', async () => {
  const payload = await delivered('en');
  expect(CJK.test(payload.title)).toBe(false);
  expect(CJK.test(payload.body)).toBe(false);
  expect(CJK.test(payload.dialog?.title ?? '')).toBe(false);
  expect(CJK.test(payload.dialog?.detail ?? '')).toBe(false);
  expect(payload.body).toContain('0.44.0');
  expect(payload.body).toContain('0.43.2');
});

test('no bridge or no pending notice means nothing is shown', async () => {
  const shown: DesktopNotifyPayload[] = [];
  vi.stubGlobal('window', { localStorage: storedLocale('zh') });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  await showPendingRollbackNotice();
  vi.stubGlobal('window', {
    localStorage: storedLocale('zh'),
    cairnDesktop: {
      update: { rollbackNotice: () => Promise.resolve(null) },
      notify: { show: (payload: DesktopNotifyPayload) => shown.push(payload) },
    },
  });
  await showPendingRollbackNotice();
  expect(shown).toEqual([]);
});
