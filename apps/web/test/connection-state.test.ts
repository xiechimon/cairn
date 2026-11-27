import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChiefConnectionBanner } from '../src/chief/chief-outage-banner.js';
import { I18nProvider } from '../src/i18n/provider.js';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  fireOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  fireError(): void {
    this.onerror?.();
  }
}

function fakeWindow(onLine: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    navigator: { onLine },
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    fire(type: string, next: boolean) {
      this.navigator.onLine = next;
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
}

let connectionState: typeof import('../src/api/connection-state.js');
let sse: typeof import('../src/api/sse.js');
let win: ReturnType<typeof fakeWindow>;

async function loadModules(onLine: boolean) {
  vi.resetModules();
  win = fakeWindow(onLine);
  vi.stubGlobal('window', win);
  vi.stubGlobal('EventSource', FakeEventSource);
  connectionState = await import('../src/api/connection-state.js');
  sse = await import('../src/api/sse.js');
}

function renderBanner(): string {
  function Gate() {
    return connectionState.useConnected() ? null : createElement(ChiefConnectionBanner);
  }
  return renderToStaticMarkup(
    createElement(I18nProvider, { initialLocale: 'zh', children: createElement(Gate) }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connection state from server stream reachability', () => {
  it('shows no disconnected banner when navigator.onLine is false and the stream is connected', async () => {
    await loadModules(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = sse.startTeamStream('team-1', qc);
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();

    expect(connectionState.useConnected()).toBe(true);
    expect(renderBanner()).toBe('');

    win.fire('offline', false);
    expect(connectionState.useConnected()).toBe(true);
    expect(renderBanner()).toBe('');

    stop();
    qc.clear();
  });

  it('shows the disconnected banner when the stream drops and clears it when the stream reconnects', async () => {
    await loadModules(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = sse.startTeamStream('team-1', qc);
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.fireOpen();
    expect(renderBanner()).toBe('');

    first.fireError();
    expect(connectionState.useConnected()).toBe(false);
    expect(renderBanner()).toContain('data-testid="connection-lost"');
    expect(renderBanner()).toContain('连接断开，正在重连…');

    const second = FakeEventSource.instances[1] as FakeEventSource;
    second.fireOpen();
    expect(connectionState.useConnected()).toBe(true);
    expect(renderBanner()).toBe('');

    stop();
    qc.clear();
  });

  it('uses window online only as a hint to retry sooner without faking connected', async () => {
    await loadModules(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let attempts = 0;
    const stop = sse.startTeamStream('team-1', qc, 0, null, () => {
      attempts += 1;
      if (attempts <= 2) return Promise.reject(new Error('server down'));
      return Promise.resolve('/api/teams/team-1/stream');
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(connectionState.useConnected()).toBe(false);
    expect(renderBanner()).toContain('data-testid="connection-lost"');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    expect(connectionState.useConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);

    win.fire('online', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);
    expect(connectionState.useConnected()).toBe(false);

    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.fireOpen();
    expect(connectionState.useConnected()).toBe(true);
    expect(renderBanner()).toBe('');

    stop();
    qc.clear();
  });

  it('marks disconnected when the silence watchdog rebuilds a dead stream and clears on reopen', async () => {
    await loadModules(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = sse.startTeamStream('team-1', qc);
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.fireOpen();
    expect(connectionState.useConnected()).toBe(true);

    vi.advanceTimersByTime(20_000);
    expect(connectionState.useConnected()).toBe(false);
    expect(renderBanner()).toContain('data-testid="connection-lost"');

    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    rebuilt.fireOpen();
    expect(connectionState.useConnected()).toBe(true);

    stop();
    qc.clear();
  });

  it('clears a disconnected state when the stream is disposed and defaults connected without a stream', async () => {
    await loadModules(false);
    expect(connectionState.useConnected()).toBe(true);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = sse.startTeamStream('team-1', qc);
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.fireError();
    expect(connectionState.useConnected()).toBe(false);

    stop();
    expect(connectionState.useConnected()).toBe(true);
    qc.clear();
  });

  it('assumes connected when there is no window', () => {
    const store = connectionState.createConnectionStore(undefined);
    expect(store.getSnapshot()).toBe(true);
    const cb = vi.fn();
    store.subscribe(cb)();
    expect(cb).not.toHaveBeenCalled();
  });

  it('tracks outage grace (2s), reconnecting, long-outage (60s), and triggers immediate manual retryNow', async () => {
    await loadModules(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let failTicket = false;
    let ticketAttempts = 0;
    const stop = sse.startTeamStream('team-1', qc, 0, null, async () => {
      ticketAttempts += 1;
      if (failTicket) throw new Error('server down');
      return '/api/teams/team-1/stream';
    });

    await vi.advanceTimersByTimeAsync(0);
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.fireOpen();
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('connected');

    failTicket = true;
    first.fireError();
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('grace');

    await vi.advanceTimersByTimeAsync(1_999);
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('grace');

    await vi.advanceTimersByTimeAsync(1);
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(58_000);
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('long-outage');

    const beforeRetry = ticketAttempts;
    failTicket = false;
    connectionState.connectionStore.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(ticketAttempts).toBeGreaterThan(beforeRetry);

    const recovered = FakeEventSource.instances.at(-1) as FakeEventSource;
    recovered.fireOpen();
    expect(connectionState.connectionStore.getOutagePhase(Date.now())).toBe('connected');

    stop();
    qc.clear();
  });
});
