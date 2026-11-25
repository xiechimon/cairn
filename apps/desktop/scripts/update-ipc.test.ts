import type { DesktopUpdateState } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { resolveWindowLocale } from '../src/locale.js';
import { registerOwnComputerIpc } from '../src/own-computer.js';
import { installDesktopUpdate, type UpdateInstallMessages } from '../src/update-ipc.js';

const MESSAGES: UpdateInstallMessages = {
  notMainWindow: 'Update installation can only be started from the main Cairn window.',
  noPendingUpdate: 'no update is pending to install',
  offline: 'offline',
  current: (version) => `already at ${version}`,
  unsupported: (blocker) => `unsupported:${blocker}`,
};

describe('desktop update install IPC', () => {
  test('installs and applies a ready or available update from the main page regardless of host mode', async () => {
    let state: DesktopUpdateState = { status: 'ready', version: '0.1.728' };
    const apply = vi.fn(async () => {
      state = { status: 'restarting', version: '0.1.728' };
    });
    const install = vi.fn(async () => {});

    const readyOutcome = await installDesktopUpdate({
      fromMainPage: true,
      updater: { state: () => state, install, apply },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(readyOutcome).toEqual({ ok: true });
    expect(apply).toHaveBeenCalledWith('foreground');

    state = { status: 'available', version: '0.1.729' };
    const calls: string[] = [];
    const availableOutcome = await installDesktopUpdate({
      fromMainPage: true,
      updater: {
        state: () => state,
        install: async () => {
          calls.push('install');
          state = { status: 'ready', version: '0.1.729' };
        },
        apply: async (when) => {
          calls.push(`apply:${when}`);
          state = { status: 'restarting', version: '0.1.729' };
        },
      },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(availableOutcome).toEqual({ ok: true });
    expect(calls).toEqual(['install', 'apply:foreground']);
  });

  test('never returns undefined when refused and reports the exact refusal reason', async () => {
    const idleResult = await installDesktopUpdate({
      fromMainPage: true,
      updater: {
        state: () => ({ status: 'idle' }),
        install: async () => {},
        apply: async () => {},
      },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(idleResult).toEqual({ ok: false, reason: MESSAGES.noPendingUpdate });

    const unsupportedResult = await installDesktopUpdate({
      fromMainPage: true,
      updater: {
        state: () => ({ status: 'unsupported', blocker: 'read-only' }),
        install: async () => {},
        apply: async () => {},
      },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(unsupportedResult).toEqual({ ok: false, reason: 'unsupported:read-only' });

    const wrongOriginResult = await installDesktopUpdate({
      fromMainPage: false,
      updater: {
        state: () => ({ status: 'ready', version: '0.1.728' }),
        install: async () => {},
        apply: async () => {},
      },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(wrongOriginResult).toEqual({ ok: false, reason: MESSAGES.notMainWindow });

    const signatureRefused = await installDesktopUpdate({
      fromMainPage: true,
      updater: {
        state: () => ({ status: 'ready', version: '0.1.728' }),
        install: async () => {},
        apply: async () => {
          throw new Error('the staged update is not signed by the Cairn certificate');
        },
      },
      messages: MESSAGES,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    });
    expect(signatureRefused).toEqual({
      ok: false,
      reason: 'the staged update is not signed by the Cairn certificate',
    });
  });

  test('own-computer IPC stays registered in remote mode and returns null cleanly', async () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    registerOwnComputerIpc(
      {
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
      },
      () => true,
      null,
    );
    expect(await handlers.get('own-computer:permissions')?.({})).toBeNull();
    expect(await handlers.get('own-computer:guide')?.({})).toBeNull();
  });

  test('resolveWindowLocale skips unloaded hidden tray windows and caps stalled renderers', async () => {
    const neverSettles = () => new Promise<unknown>(() => {});
    const locale = await resolveWindowLocale(
      [
        { destroyed: false, loading: false, url: '', readLang: neverSettles },
        {
          destroyed: false,
          loading: true,
          url: 'http://127.0.0.1:4310/app',
          readLang: neverSettles,
        },
        {
          destroyed: true,
          loading: false,
          url: 'http://127.0.0.1:4310/app',
          readLang: neverSettles,
        },
        {
          destroyed: false,
          loading: false,
          url: 'http://127.0.0.1:4310/app',
          readLang: async () => 'zh-CN',
        },
      ],
      'en-US',
      20,
    );
    expect(locale).toBe('zh');

    const fallback = await resolveWindowLocale(
      [
        {
          destroyed: false,
          loading: false,
          url: 'http://127.0.0.1:4310/app',
          readLang: neverSettles,
        },
      ],
      'zh-TW',
      20,
    );
    expect(fallback).toBe('zh');
  });
});
