import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SSE_BIZ_SILENCE_BASE_MS,
  type StreamGuards,
  connect,
} from '../src/api/sse-connection.js';

const PING_MS = 15_000;

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
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

function advanceWithPings(
  es: FakeEventSource,
  seconds: number,
  clock: { t: number; frameId: number },
): void {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1_000);
    clock.t += 1;
    if (clock.t % (PING_MS / 1_000) === 0) es.push({ type: 'ping' }, ++clock.frameId);
  }
}

const URL = '/api/teams/team-1/stream';

it('a rejected ticket resolver retries instead of staying disconnected', async () => {
  let attempts = 0;
  const dispose = connect(
    () => {
      attempts += 1;
      return Promise.reject(new Error('offline'));
    },
    () => {},
    { inFlight: () => false, reconcile: () => {} },
  );
  await Promise.resolve();
  expect(attempts).toBe(1);
  expect(FakeEventSource.instances).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(attempts).toBe(2);
  dispose();
});

it('a failed stream backs off instead of retrying every second', async () => {
  const dispose = connect(
    () => Promise.resolve(URL),
    () => {},
    { inFlight: () => false, reconcile: () => {} },
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(FakeEventSource.instances).toHaveLength(1);
  FakeEventSource.instances[0]?.onerror?.();
  await vi.advanceTimersByTimeAsync(999);
  expect(FakeEventSource.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeEventSource.instances).toHaveLength(2);
  FakeEventSource.instances[1]?.onerror?.();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeEventSource.instances).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeEventSource.instances).toHaveLength(3);
  dispose();
});

function openStream(
  guards: StreamGuards,
  onEvent: (ev: Record<string, unknown>) => void = () => {},
): { es: FakeEventSource; dispose: () => void } {
  const dispose = connect(URL, (ev, transport) => {
    if (ev.type === 'hello') {
      transport.establish();
      transport.acknowledge(() => true, async () => {});
    } else onEvent(ev);
  }, guards);
  const es = FakeEventSource.instances[0] as FakeEventSource;
  es.fireOpen();
  es.push({ type: 'hello' });
  return { es, dispose };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('gaps in attachment sequences', () => {
  it('uses the SSE id without a JSON sequence and does not deliver a repeated id', () => {
    const reconcile = vi.fn();
    const onEvent = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile }, onEvent);
    es.push({ type: 'todo' }, 1);
    es.push({ type: 'todo' }, 1);
    es.push({ type: 'ping' }, 3);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('delivers unnumbered legacy frames without reconciling on a payload sequence', () => {
    const reconcile = vi.fn();
    const onEvent = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile }, onEvent);
    es.push({ type: 'ping', seq: 1 });
    es.push({ type: 'ping', seq: 3 });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('a skipped number range reconciles on sight, and sets no gate (a gap is evidence, not a guess)', () => {
    const reconcile = vi.fn();

    const { es } = openStream({ inFlight: () => false, reconcile });

    es.push({ type: 'ping' }, 1);
    es.push({ type: 'todo', v: 1, doc: { id: 'todo-1' } }, 2);
    es.push({ type: 'ping' }, 3);
    expect(reconcile).not.toHaveBeenCalled();

    es.push({ type: 'ping' }, 5);
    expect(reconcile).toHaveBeenCalledTimes(1);

    es.push({ type: 'ping' }, 6);
    es.push({ type: 'ping' }, 7);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('a gap re-arms the silent window — after a frame-drop history the judgment turns more alert', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    const clock = { t: 0, frameId: 0 };

    es.push({ type: 'ping' }, ++clock.frameId);
    es.push({ type: 'todo', v: 1, doc: { id: 'todo-1' } }, ++clock.frameId);

    advanceWithPings(es, 20, clock);
    expect(reconcile).toHaveBeenCalledTimes(1);

    clock.frameId += 2;
    es.push({ type: 'ping' }, clock.frameId);
    expect(reconcile).toHaveBeenCalledTimes(2);

    advanceWithPings(es, 19, clock);
    expect(reconcile).toHaveBeenCalledTimes(2);
    advanceWithPings(es, 1, clock);
    expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it('after reconnect frame ids restart from 1, not counted as duplicates or a gap', () => {
    const reconcile = vi.fn();
    const onEvent = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile }, onEvent);

    es.push({ type: 'ping' }, 1);
    es.push({ type: 'ping' }, 2);
    es.push({ type: 'ping' }, 3);
    onEvent.mockClear();

    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    rebuilt.fireOpen();
    rebuilt.push({ type: 'ping' }, 1);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('business-frame silence (pings not counted) = the 150-second shape of XMON-58', () => {
  it('reconciles while there is work in flight, and the interval doubles — does not degrade into fixed-frequency polling', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    const clock = { t: 0, frameId: 0 };

    es.push({ type: 'ping' }, ++clock.frameId);
    es.push({ type: 'todo', v: 2, doc: { id: 'todo-1' } }, ++clock.frameId);

    advanceWithPings(es, 19, clock);
    expect(reconcile).not.toHaveBeenCalled();

    advanceWithPings(es, 1, clock);
    expect(reconcile).toHaveBeenCalledTimes(1);

    advanceWithPings(es, 39, clock);
    expect(reconcile).toHaveBeenCalledTimes(1);

    advanceWithPings(es, 1, clock);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('a business frame resets the window on arrival: zero extra requests under normal traffic', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(10_000);
      es.push({ type: 'build', v: 1, doc: { id: 'build-1', todoId: 't1' } }, i + 1);
    }

    expect(reconcile).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('pure ping stream with nothing in flight → no false trigger, no connection rebuild', () => {
    const reconcile = vi.fn();
    const onTransportLost = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile, onTransportLost });

    advanceWithPings(es, 180, { t: 0, frameId: 0 });

    expect(reconcile).not.toHaveBeenCalled();
    expect(onTransportLost).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('the gate does not swallow business frames while closed (onEvent receives them as usual)', () => {
    const onEvent = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile: vi.fn() }, onEvent);

    es.push({ type: 'ping' }, 1);
    es.push({ type: 'todo', v: 1, doc: { id: 'todo-1' } }, 2);

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'todo', v: 1, doc: { id: 'todo-1' } });
  });
});

describe('#462 existing faces unchanged', () => {
  it('complete silence closes the old connection and reports reconnecting', () => {
    const onReconnecting = vi.fn();
    const onTransportLost = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile: vi.fn(), onReconnecting, onTransportLost });

    es.push({ type: 'ping' }, 1);
    vi.advanceTimersByTime(19_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(es.readyState).toBe(FakeEventSource.CLOSED);

    (FakeEventSource.instances[1] as FakeEventSource).fireOpen();
    expect(onTransportLost).toHaveBeenCalledOnce();
    expect(onReconnecting).toHaveBeenLastCalledWith(true);
  });

  it('a stalled connecting source is retired rather than waiting for native retry', () => {
    const { es } = openStream({ inFlight: () => true, reconcile: vi.fn() });
    es.readyState = FakeEventSource.CONNECTING;

    vi.advanceTimersByTime(20_000);

    expect(es.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('after dispose the timer does not act again', () => {
    const reconcile = vi.fn();
    const { dispose } = openStream({ inFlight: () => true, reconcile });

    dispose();
    vi.advanceTimersByTime(SSE_BIZ_SILENCE_BASE_MS * 10);

    expect(reconcile).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});