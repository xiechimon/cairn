import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOfflineRecovery } from '../src/offline-recovery.js';

describe('createOfflineRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('first launch with host down preserves attempted URL, probes in background without flashing offline page, and recovers to the exact URL', async () => {
    let reachable = false;
    const probe = vi.fn(async () => reachable);
    const showOffline = vi.fn();
    const loadUrl = vi.fn();
    const reload = vi.fn();

    const recovery = createOfflineRecovery({
      origin: 'http://mac-mini.tailac09a9.ts.net:8787',
      initialUrl: 'http://mac-mini.tailac09a9.ts.net:8787/app/settings',
      isRemote: true,
      probe,
      showOffline,
      loadUrl,
      reload,
    });

    recovery.handleMainFrameFailure('http://mac-mini.tailac09a9.ts.net:8787/app/settings');
    expect(recovery.isShowingOfflinePage()).toBe(true);
    expect(showOffline).toHaveBeenCalledTimes(1);

    const firstManual = await recovery.retryNow();
    expect(firstManual).toBe(false);
    expect(showOffline).toHaveBeenCalledTimes(1);
    expect(loadUrl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(loadUrl).not.toHaveBeenCalled();

    reachable = true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loadUrl).toHaveBeenCalledTimes(1);
    expect(loadUrl).toHaveBeenCalledWith('http://mac-mini.tailac09a9.ts.net:8787/app/settings');
    recovery.dispose();
  });

  test('when the app is already loaded, requestSafeReload keeps the loaded window intact while the remote host is down', async () => {
    let reachable = false;
    const probe = vi.fn(async () => reachable);
    const showOffline = vi.fn();
    const loadUrl = vi.fn();
    const reload = vi.fn();

    const recovery = createOfflineRecovery({
      origin: 'http://mac-mini.tailac09a9.ts.net:8787',
      initialUrl: 'http://mac-mini.tailac09a9.ts.net:8787/app',
      isRemote: true,
      probe,
      showOffline,
      loadUrl,
      reload,
    });

    recovery.markLoaded('http://mac-mini.tailac09a9.ts.net:8787/app?project=p1&chat=1');
    const reloadedOffline = await recovery.requestSafeReload();
    expect(reloadedOffline).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(showOffline).not.toHaveBeenCalled();

    reachable = true;
    const reloadedOnline = await recovery.requestSafeReload();
    expect(reloadedOnline).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    recovery.dispose();
  });

  test('wake-from-sleep nudge probes immediately when offline page is shown', async () => {
    let reachable = false;
    const probe = vi.fn(async () => reachable);
    const showOffline = vi.fn();
    const loadUrl = vi.fn();

    const recovery = createOfflineRecovery({
      origin: 'http://mac-mini.tailac09a9.ts.net:8787',
      initialUrl: 'http://mac-mini.tailac09a9.ts.net:8787/app',
      isRemote: true,
      probe,
      showOffline,
      loadUrl,
      reload: vi.fn(),
    });

    recovery.handleMainFrameFailure('http://mac-mini.tailac09a9.ts.net:8787/app');
    reachable = true;
    await recovery.nudge();
    expect(loadUrl).toHaveBeenCalledWith('http://mac-mini.tailac09a9.ts.net:8787/app');
    recovery.dispose();
  });

  test('runs onBeforeRecover before loadUrl across automatic, manual, and wake recovery', async () => {
    let reachable = false;
    let shouldFailHook = false;
    const events: string[] = [];
    const probe = vi.fn(async () => reachable);
    const onBeforeRecover = vi.fn(async () => {
      events.push('hook');
      if (shouldFailHook) throw new Error('issuer unavailable');
    });
    const loadUrl = vi.fn((url: string) => {
      events.push(`load:${url}`);
    });

    const recovery = createOfflineRecovery({
      origin: 'https://cloud.example.com',
      initialUrl: 'https://cloud.example.com/app',
      isRemote: true,
      probe,
      onBeforeRecover,
      showOffline: vi.fn(),
      loadUrl,
      reload: vi.fn(),
    });

    recovery.handleMainFrameFailure('https://cloud.example.com/app');
    reachable = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(events).toEqual(['hook', 'load:https://cloud.example.com/app']);

    events.length = 0;
    reachable = false;
    shouldFailHook = true;
    recovery.handleMainFrameFailure('https://cloud.example.com/app/tasks');
    reachable = true;
    await expect(recovery.retryNow()).resolves.toBe(true);
    expect(events).toEqual(['hook', 'load:https://cloud.example.com/app/tasks']);

    events.length = 0;
    reachable = false;
    shouldFailHook = false;
    recovery.handleMainFrameFailure('https://cloud.example.com/app');
    reachable = true;
    await expect(recovery.nudge()).resolves.toBe(true);
    expect(events).toEqual(['hook', 'load:https://cloud.example.com/app']);

    let resolveSlow!: () => void;
    const slowRecovery = createOfflineRecovery({
      origin: 'https://cloud.example.com',
      initialUrl: 'https://cloud.example.com/app',
      isRemote: true,
      probe: vi.fn(async () => true),
      onBeforeRecover: () =>
        new Promise<void>((resolve) => {
          resolveSlow = resolve;
        }),
      showOffline: vi.fn(),
      loadUrl,
      reload: vi.fn(),
    });
    slowRecovery.handleMainFrameFailure('https://cloud.example.com/app');
    const pendingRetry = slowRecovery.retryNow();
    await Promise.resolve();
    slowRecovery.dispose();
    resolveSlow();
    await expect(pendingRetry).resolves.toBe(false);
    expect(loadUrl).toHaveBeenCalledTimes(3);
  });
});
