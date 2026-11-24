import type { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import {
  type ConversationStreamHandlers,
  startConversationStream,
  startTeamStream,
} from '../src/api/sse.js';

export class FakeEventSource {
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

let helloCount = 0;
const greeted = new WeakSet<FakeEventSource>();

export function stubTabFollow(): void {
  const fetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if (!String(path).startsWith('/api/streams/')) return fetch(path, init);
    const { revision } = JSON.parse(String(init?.body)) as { revision: number };
    return Promise.resolve(Response.json({ revision }));
  });
}

const teamStops: (() => void)[] = [];
const convStops: (() => void)[] = [];

export function stopAllTabStreams(): void {
  for (const stop of convStops.splice(0)) stop();
  for (const stop of teamStops.splice(0)) stop();
  FakeEventSource.instances = [];
}

export interface ConvHandle {
  stop: () => void;
  fireOpen: () => void;
  push: (ev: Record<string, unknown>) => void;
}

export function startConv(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers = {},
): ConvHandle {
  if (FakeEventSource.instances.length === 0) {
    teamStops.push(startTeamStream('team-1', qc));
  }
  const stop = startConversationStream(conversationId, qc, handlers);
  convStops.push(stop);
  return {
    stop,
    fireOpen() {
      const es = FakeEventSource.instances.at(-1) as FakeEventSource;
      if (greeted.has(es)) return;
      greeted.add(es);
      es.fireOpen();
      es.push({ type: 'hello', connectionId: `conn-${++helloCount}`, followRevision: true });
      es.push({ type: 'ping' });
    },
    push(ev) {
      const es = FakeEventSource.instances.at(-1) as FakeEventSource;
      if (ev.type === 'ping') es.push(ev);
      else es.push({ type: 'conversation', conversationId, event: ev });
    },
  };
}
