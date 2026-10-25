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

  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function advanceWithPings(
  es: FakeEventSource,
  seconds: number,
  clock: { t: number; seq: number },
): void {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1_000);
    clock.t += 1;
    if (clock.t % (PING_MS / 1_000) === 0) es.push({ type: 'ping', seq: ++clock.seq });
  }
}

const URL = '/api/teams/team-1/stream';

function openStream(
  guards: StreamGuards,
  onEvent: (ev: Record<string, unknown>) => void = () => {},
  onResync: () => void = () => {},
): { es: FakeEventSource; dispose: () => void } {
  const dispose = connect(URL, onEvent, onResync, guards);
  const es = FakeEventSource.instances[0] as FakeEventSource;
  es.fireOpen();
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

describe('seq gaps = proof of dropped frames', () => {
  it('a skipped number range reconciles on sight, and sets no gate (a gap is evidence, not a guess)', () => {
    const reconcile = vi.fn();

    const { es } = openStream({ inFlight: () => false, reconcile });

    es.push({ type: 'ping', seq: 1 });
    es.push({ type: 'todo', seq: 2, v: 1, doc: { id: 'todo-1' } });
    es.push({ type: 'ping', seq: 3 });
    expect(reconcile).not.toHaveBeenCalled();

    es.push({ type: 'ping', seq: 5 });
    expect(reconcile).toHaveBeenCalledTimes(1);

    es.push({ type: 'ping', seq: 6 });
    es.push({ type: 'ping', seq: 7 });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('a gap re-arms the silent window — after a frame-drop history the judgment turns more alert', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    const clock = { t: 0, seq: 0 };

    es.push({ type: 'ping', seq: ++clock.seq });
    es.push({ type: 'todo', seq: ++clock.seq, v: 1, doc: { id: 'todo-1' } });

    advanceWithPings(es, 20, clock);
    expect(reconcile).toHaveBeenCalledTimes(1);

    clock.seq += 2;
    es.push({ type: 'ping', seq: clock.seq });
    expect(reconcile).toHaveBeenCalledTimes(2);

    advanceWithPings(es, 19, clock);
    expect(reconcile).toHaveBeenCalledTimes(2);
    advanceWithPings(es, 1, clock);
    expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it('after reconnect seq restarts from 1, not counted as a gap', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile });

    es.push({ type: 'ping', seq: 1 });
    es.push({ type: 'ping', seq: 2 });
    es.push({ type: 'ping', seq: 3 });

    vi.advanceTimersByTime(20_000);
    const rebuilt = FakeEventSource.instances[1] as FakeEventSource;
    rebuilt.fireOpen();
    rebuilt.push({ type: 'ping', seq: 1 });
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('business-frame silence (pings not counted) = the 150-second shape of XMON-58', () => {
  it('reconciles while there is work in flight, and the interval doubles — does not degrade into fixed-frequency polling', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    const clock = { t: 0, seq: 0 };

    es.push({ type: 'ping', seq: ++clock.seq });
    es.push({ type: 'todo', seq: ++clock.seq, v: 2, doc: { id: 'todo-1' } });

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
    const clock = { t: 0, seq: 0 };

    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(10_000);
      clock.t += 10;
      es.push({ type: 'build', seq: ++clock.seq, v: 1, doc: { id: 'build-1', todoId: 't1' } });
    }

    expect(reconcile).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('pure ping stream with nothing in flight → no false trigger, no connection rebuild', () => {
    const reconcile = vi.fn();
    const onResync = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile }, () => {}, onResync);
    const clock = { t: 0, seq: 0 };

    advanceWithPings(es, 180, clock);

    expect(reconcile).not.toHaveBeenCalled();
    expect(onResync).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('the gate does not swallow business frames while closed (onEvent receives them as usual)', () => {
    const onEvent = vi.fn();
    const { es } = openStream({ inFlight: () => false, reconcile: vi.fn() }, onEvent);

    es.push({ type: 'ping', seq: 1 });
    es.push({ type: 'todo', seq: 2, v: 1, doc: { id: 'todo-1' } });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'todo', seq: 2, doc: { id: 'todo-1' } }),
    );
  });
});

describe('#462 existing faces unchanged', () => {
  it('complete silence (not even pings) → rebuild the connection + resync on reconnect', () => {
    const onResync = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile: vi.fn() }, () => {}, onResync);

    es.push({ type: 'ping', seq: 1 });
    vi.advanceTimersByTime(19_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(es.readyState).toBe(FakeEventSource.CLOSED);

    (FakeEventSource.instances[1] as FakeEventSource).fireOpen();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('not OPEN (browser reconnecting on its own) → the watchdog does not take over', () => {
    const reconcile = vi.fn();
    const { es } = openStream({ inFlight: () => true, reconcile });
    es.readyState = FakeEventSource.CONNECTING;

    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.instances).toHaveLength(1);
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