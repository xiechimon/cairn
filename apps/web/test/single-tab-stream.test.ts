import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveTextStore } from '../src/api/live-text.js';
import { startConversationStream, startTeamStream } from '../src/api/sse.js';

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
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const subscriptionBodies: string[][] = [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  if (String(input).startsWith('/api/streams/')) {
    subscriptionBodies.push((JSON.parse(String(init?.body)) as { conversationIds: string[] }).conversationIds);
    return new Response(null, { status: 204 });
  }
  return new Response('{}', { status: 200 });
});

const open = () => FakeEventSource.instances.filter((es) => es.readyState !== FakeEventSource.CLOSED);

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  subscriptionBodies.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 16));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  liveTextStore.clear('conv-a');
});

describe('one stream per browser tab', () => {
  it('a team stream plus two followed conversations hold one EventSource', async () => {
    const qc = new QueryClient();
    const stopTeam = startTeamStream('team-1', qc);
    const stopA = startConversationStream('conv-a', qc, {});
    const stopB = startConversationStream('conv-b', qc, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(open().every((es) => es.url.includes('/api/teams/team-1/stream'))).toBe(true);
    stopA();
    stopB();
    stopTeam();
  });

  it('the followed set is sent once the connection announces itself, and routes envelopes to the right conversation', async () => {
    const qc = new QueryClient();
    const stopTeam = startTeamStream('team-1', qc);
    const stopA = startConversationStream('conv-a', qc, {});
    const es = FakeEventSource.instances[0] as FakeEventSource;
    es.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies).toEqual([]);
    es.push({ type: 'hello', connectionId: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies).toEqual([['conv-a']]);
    es.push({
      type: 'conversation',
      conversationId: 'conv-a',
      event: { type: 'text_delta', text: 'hi' },
    });
    es.push({
      type: 'conversation',
      conversationId: 'conv-z',
      event: { type: 'text_delta', text: 'other' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(liveTextStore.get('conv-a')).toBe('hi');
    stopA();
    stopTeam();
  });

  it('a reconnect resubscribes after the new hello and a removed conversation leaves the set', async () => {
    const qc = new QueryClient();
    const stopTeam = startTeamStream('team-1', qc);
    const stopA = startConversationStream('conv-a', qc, {});
    const stopB = startConversationStream('conv-b', qc, {});
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.open();
    first.push({ type: 'hello', connectionId: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies.at(-1)?.sort()).toEqual(['conv-a', 'conv-b']);
    stopB();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies.at(-1)).toEqual(['conv-a']);
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    const second = FakeEventSource.instances[1] as FakeEventSource;
    second.open();
    const before = subscriptionBodies.length;
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies).toHaveLength(before);
    second.push({ type: 'hello', connectionId: 'c2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptionBodies.at(-1)).toEqual(['conv-a']);
    stopA();
    stopTeam();
  });
});
