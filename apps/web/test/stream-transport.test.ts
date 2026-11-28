import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StreamAttachment, type StreamTarget, webSocketTransport } from '../src/api/sse-connection.js';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState: number = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  fireOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  push(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId: string }) => void) | null = null;
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

  push(payload: unknown, frameId?: number): void {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId: frameId?.toString() ?? '' });
  }
}

const guards = { inFlight: () => false, reconcile: () => {} };

const noop = (): void => {};

const settled = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

async function loadModule() {
  return import('../src/api/sse-connection.js');
}

const target = async (url: string): Promise<StreamTarget> => ({
  url,
  transport: webSocketTransport,
});

beforeEach(() => {
  FakeSocket.instances = [];
  FakeEventSource.instances = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:8787' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('stream ticket reply', () => {
  it('chooses the socket transport only when the server says so', async () => {
    const { streamTargetOf } = await import('../src/api/stream-target.js');
    const { webSocketTransport } = await loadModule();
    expect(streamTargetOf('/api/teams/team-1/stream', null)).toBe('/api/teams/team-1/stream');
    expect(streamTargetOf('/api/teams/team-1/stream', {})).toBe('/api/teams/team-1/stream');
    expect(streamTargetOf('/api/teams/team-1/stream', { ticket: '' })).toBe(
      '/api/teams/team-1/stream',
    );
    expect(streamTargetOf('/api/teams/team-1/stream', { ticket: 't-1' })).toBe(
      '/api/teams/team-1/stream?ticket=t-1',
    );
    const target = streamTargetOf('/api/teams/team-1/stream', {
      ticket: 't-1',
      transport: 'websocket',
    });
    expect(target).not.toBe('/api/teams/team-1/stream?ticket=t-1');
    expect(target).toMatchObject({ url: '/api/teams/team-1/stream?ticket=t-1' });
    expect((target as { transport?: unknown }).transport).toBe(webSocketTransport);
  });
});

describe('team stream transport', () => {
  it('uses one socket per tab when the server advertises the websocket transport', async () => {
    const { connect, webSocketTransport } = await loadModule();
    const seen: Record<string, unknown>[] = [];
    const dispose = connect(
      async () => ({ url: '/api/teams/team-1/stream?ticket=t-1', transport: webSocketTransport }),
      (ev) => seen.push(ev),
      guards,
    );
    await settled();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(0);
    const socket = FakeSocket.instances[0] as FakeSocket;
    const parsed = new URL(socket.url);
    expect(parsed.protocol).toBe('ws:');
    expect(parsed.pathname).toBe('/api/teams/team-1/stream');
    expect(parsed.searchParams.get('ticket')).toBe('t-1');

    socket.fireOpen();
    socket.push({ id: 7, data: JSON.stringify({ type: 'hello', connectionId: 'conn-1' }) });
    expect(seen).toEqual([{ type: 'hello', connectionId: 'conn-1' }]);

    dispose();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it('ignores frames that are not the socket envelope', async () => {
    const { connect, webSocketTransport } = await loadModule();
    const seen: Record<string, unknown>[] = [];
    connect(
      async () => ({ url: '/api/teams/team-1/stream', transport: webSocketTransport }),
      (ev) => seen.push(ev),
      guards,
    );
    await settled();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.fireOpen();
    socket.push({ data: 12 });
    socket.push(['nope']);
    socket.push({ id: 1, data: 'not json' });
    expect(seen).toEqual([]);
  });

  it('keeps the plain EventSource transport for a plain stream path', async () => {
    const { connect } = await loadModule();
    connect('/api/teams/team-1/stream?ticket=t-1', noop, guards);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('serves one session over two tabs as two independent sockets', async () => {
    const { connect, webSocketTransport } = await loadModule();
    const first: Record<string, unknown>[] = [];
    const second: Record<string, unknown>[] = [];
    connect(
      async () => ({ url: '/api/teams/team-1/stream', transport: webSocketTransport }),
      (ev) => first.push(ev),
      guards,
    );
    connect(
      async () => ({ url: '/api/teams/team-1/stream', transport: webSocketTransport }),
      (ev) => second.push(ev),
      guards,
    );
    await settled();
    expect(FakeSocket.instances).toHaveLength(2);
    for (const socket of FakeSocket.instances) {
      socket.fireOpen();
      socket.push({ id: 1, data: JSON.stringify({ type: 'ping' }) });
    }
    expect(first).toEqual([{ type: 'ping' }]);
    expect(second).toEqual([{ type: 'ping' }]);
  });

  it('reconnects on a dropped socket with a new ticket and resyncs on the new hello', async () => {
    const { connect } = await loadModule();
    const seen: Record<string, unknown>[] = [];
    const recover = vi.fn(async () => {});
    let attachment: StreamAttachment | null = null;
    const readAttachment = () => attachment;
    let tickets = 0;
    connect(
      async () => {
        tickets += 1;
        return target(`/api/teams/team-1/stream?ticket=t-${tickets}`);
      },
      (ev, current) => {
        attachment = current;
        if (ev.type === 'hello') current.establish();
        seen.push(ev);
      },
      guards,
    );
    await settled();
    const first = FakeSocket.instances[0] as FakeSocket;
    expect(new URL(first.url).searchParams.get('ticket')).toBe('t-1');
    first.fireOpen();
    first.push({ id: 1, data: JSON.stringify({ type: 'hello', connectionId: 'conn-1' }) });
    expect(seen).toContainEqual({ type: 'hello', connectionId: 'conn-1' });
    first.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    await settled();

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeEventSource.instances).toHaveLength(0);
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(new URL(second.url).searchParams.get('ticket')).toBe('t-2');
    second.fireOpen();
    second.push({ id: 1, data: JSON.stringify({ type: 'hello', connectionId: 'conn-2' }) });
    expect(seen).toContainEqual({ type: 'hello', connectionId: 'conn-2' });
    const current = readAttachment();
    expect(current).not.toBeNull();
    expect(current?.acknowledge(() => true, recover)).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('retries timed-out handshakes without consuming an HTTP connection', async () => {
    const { connect } = await loadModule();
    const dispose = connect(() => target('/api/teams/team-1/stream'), noop, guards);
    await settled();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(FakeEventSource.instances).toHaveLength(0);
    dispose();
  });

  it('asks for a new ticket and resyncs on the new hello after a failed handshake', async () => {
    const { connect } = await loadModule();
    let tickets = 0;
    const seen: Record<string, unknown>[] = [];
    const resolve = async () => {
      tickets += 1;
      return target(`/api/teams/team-1/stream?ticket=t-${tickets}`);
    };
    connect(resolve, (ev) => seen.push(ev), guards);
    await settled();
    const first = FakeSocket.instances[0] as FakeSocket;
    expect(new URL(first.url).searchParams.get('ticket')).toBe('t-1');
    first.onerror?.();
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    await settled();
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(new URL(second.url).searchParams.get('ticket')).toBe('t-2');
    second.fireOpen();
    second.push({ id: 1, data: JSON.stringify({ type: 'hello', connectionId: 'conn-2' }) });
    expect(seen).toEqual([{ type: 'hello', connectionId: 'conn-2' }]);
  });

  it('reconciles through a frame gap on the socket transport', async () => {
    const { connect } = await loadModule();
    const reconcile = vi.fn();
    const seen: Record<string, unknown>[] = [];
    connect(
      () => target('/api/teams/team-1/stream'),
      (ev, attachment) => {
        if (ev.type === 'hello') attachment.establish();
        seen.push(ev);
      },
      { inFlight: () => false, reconcile },
    );
    await settled();
    const socket = FakeSocket.instances[0] as FakeSocket;
    socket.fireOpen();
    socket.push({ id: 1, data: JSON.stringify({ type: 'hello', connectionId: 'c-1' }) });
    socket.push({ id: 4, data: JSON.stringify({ type: 'ping' }) });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
  });

  it('does not attach a late ticket after the tab disposes its stream', async () => {
    const { connect, webSocketTransport } = await loadModule();
    let resolveTicket!: (target: StreamTarget) => void;
    const pending = new Promise<StreamTarget>((resolve) => {
      resolveTicket = resolve;
    });
    const dispose = connect(() => pending, noop, guards);
    dispose();
    resolveTicket({ url: '/api/teams/team-1/stream?ticket=late', transport: webSocketTransport });
    await settled();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('leaves SSE compatible clients untouched', async () => {
    const { connect } = await loadModule();
    const seen: Record<string, unknown>[] = [];
    connect(
      async () => '/api/teams/team-1/stream',
      (ev) => seen.push(ev),
      guards,
    );
    await settled();
    const source = FakeEventSource.instances[0] as FakeEventSource;
    source.fireOpen();
    source.push({ type: 'ping' }, 1);
    expect(FakeSocket.instances).toHaveLength(0);
    expect(seen).toEqual([{ type: 'ping' }]);
  });
});
