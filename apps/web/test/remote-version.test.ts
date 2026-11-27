import type { RemoteVersionState } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatServerVersion,
  RemoteUpdateBar,
  remoteUpdatePresentation,
} from '../src/board/remote-update-bar.js';
import { EN } from '../src/i18n/en.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { translate, type TFunc } from '../src/i18n/translate.js';
import { DraftSync } from '../src/overlay/draft-sync.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('formatServerVersion', () => {
  it('formats build version and short commit consistently in zh and en', () => {
    expect(formatServerVersion('0.1.721', '460fe83e2', zh)).toBe('0.1.721 · 460fe83');
    expect(formatServerVersion('0.1.721', null, zh)).toBe('0.1.721');
    expect(formatServerVersion(null, '606d9c2ef', zh)).toBe('开发版 · 606d9c2');
    expect(formatServerVersion(null, '606d9c2ef', en)).toBe('Dev · 606d9c2');
    expect(formatServerVersion(null, null, zh)).toBe('未知版本');
    expect(formatServerVersion(null, null, en)).toBe('Unknown version');
  });
});

describe('remoteUpdatePresentation', () => {
  const base: RemoteVersionState = {
    phase: 'current',
    serverVersion: '0.1.721',
    serverCommit: '460fe83',
    appVersion: '0.1.721',
    targetVersion: null,
    updaterState: 'idle',
    percent: null,
    reason: null,
  };

  it('hides status bar in local, probing, awaiting-auth and current phases', () => {
    for (const phase of ['local', 'probing', 'awaiting-auth', 'current'] as const) {
      expect(remoteUpdatePresentation({ ...base, phase }, zh)).toBeNull();
    }
  });

  it('shows a quiet status line with no action button while updating, waiting idle, or restarting', () => {
    const downloading = remoteUpdatePresentation(
      {
        ...base,
        phase: 'updating',
        serverVersion: '0.1.720',
        targetVersion: '0.1.721',
        updaterState: 'downloading',
        percent: 42,
      },
      zh,
    );
    expect(downloading).not.toBeNull();
    expect(downloading?.tone).toBe('quiet');
    expect(downloading?.actionLabel).toBeNull();
    expect(downloading?.message).toContain('0.1.721');

    const waitingIdle = remoteUpdatePresentation(
      {
        ...base,
        phase: 'updating',
        serverVersion: '0.1.720',
        targetVersion: '0.1.721',
        updaterState: 'waiting-idle',
      },
      en,
    );
    expect(waitingIdle?.tone).toBe('quiet');
    expect(waitingIdle?.actionLabel).toBeNull();
    expect(waitingIdle?.message).toContain('idle');

    const restarting = remoteUpdatePresentation(
      {
        ...base,
        phase: 'restarting',
        serverVersion: '0.1.720',
        targetVersion: '0.1.721',
        updaterState: 'restarting',
      },
      zh,
    );
    expect(restarting?.tone).toBe('quiet');
    expect(restarting?.actionLabel).toBeNull();
  });

  it('shows one plain sentence and one single action with no jargon on old-server, unsupported, and failed states', () => {
    const oldServer = remoteUpdatePresentation(
      { ...base, phase: 'old-server', serverVersion: null, serverCommit: null },
      zh,
    );
    expect(oldServer?.tone).toBe('error');
    expect(oldServer?.actionLabel).toBe('重新检查');
    expect(oldServer?.message).not.toMatch(/404|endpoint|API|HTTP|server/i);

    const unsupported = remoteUpdatePresentation(
      { ...base, phase: 'unsupported', serverVersion: '0.1.720', reason: 'no-updater' },
      en,
    );
    expect(unsupported?.tone).toBe('error');
    expect(unsupported?.actionLabel).toBe('Check again');
    expect(unsupported?.message).not.toMatch(/launchd|plist|404|endpoint|API/i);

    const failed = remoteUpdatePresentation(
      { ...base, phase: 'failed', serverVersion: '0.1.720', reason: 'offline' },
      zh,
    );
    expect(failed?.tone).toBe('error');
    expect(failed?.actionLabel).toBe('重试');
    expect(failed?.message).not.toMatch(/404|500|HTTP|Error:/i);

    const noRelease = remoteUpdatePresentation(
      { ...base, phase: 'failed', serverVersion: '0.1.720', reason: 'no-release' },
      en,
    );
    expect(noRelease?.tone).toBe('error');
    expect(noRelease?.actionLabel).toBe('Check again');

    const reloading = remoteUpdatePresentation({ ...base, phase: 'reloading' }, en);
    expect(reloading?.tone).toBe('quiet');
    expect(reloading?.actionLabel).toBeNull();

    const rolledBack = remoteUpdatePresentation(
      {
        ...base,
        phase: 'failed',
        serverVersion: '0.1.720',
        reason: 'blocked',
        rollbackNotice: {
          failedVersion: '0.1.725',
          restoredVersion: '0.1.720',
          reason: 'health check failed',
          at: 1000,
        },
      },
      en,
    );
    expect(rolledBack?.tone).toBe('error');
    expect(rolledBack?.actionLabel).toBe('Retry');
    expect(rolledBack?.message).toContain('0.1.725');
    expect(rolledBack?.message).toContain('0.1.720');
  });

  it('provides singular Version translation key and preserves DraftSync text on immediate flush', async () => {
    expect(EN['当前版本']).toBe('Version');
    const store = new Map<string, string>();
    const saves: Array<{ text: string; keepalive?: boolean }> = [];
    const sync = new DraftSync({
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => {
          store.set(k, v);
        },
        removeItem: (k) => {
          store.delete(k);
        },
      },
      localKey: 'cairn.draft.test',
      onRemote: () => {},
      debounceMs: 10_000,
      transport: {
        load: async () => ({ content: '', updatedAt: 0 }),
        save: async (content, opts) => {
          saves.push({ text: content, keepalive: opts?.keepalive });
          return { content, updatedAt: Date.now() };
        },
      },
    });
    sync.edit('unsent remote reload draft');
    expect(store.get('cairn.draft.test')).toBe('unsent remote reload draft');
    await sync.flush({ keepalive: true });
    expect(saves).toEqual([{ text: 'unsent remote reload draft', keepalive: true }]);
    sync.dispose();
  });

  it('renders nothing without throwing in an older shell missing remoteState and in a plain browser', () => {
    vi.stubGlobal('window', {
      cairnDesktop: {
        update: {
          state: async () => ({ status: 'available', version: '0.1.730' }),
          check: async () => {},
          install: async () => ({ ok: true }),
          subscribe: () => () => {},
        },
      },
    });
    const oldShellHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(RemoteUpdateBar),
      }),
    );
    expect(oldShellHtml).toBe('');

    vi.stubGlobal('window', {});
    const plainBrowserHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(RemoteUpdateBar),
      }),
    );
    expect(plainBrowserHtml).toBe('');
  });
});
