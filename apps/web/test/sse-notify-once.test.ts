import { notificationRecordSchema, SILENT_NOTIFICATION_TYPES } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { startTeamStream } from '../src/api/sse.js';
import { useMarkThreadRead } from '../src/board/use-mark-thread-read.js';
import { useClientPresence } from '../src/pwa/thread-presence.js';

vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 'team', userName: 'Owner' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let receive: ((event: { data: string }) => void) | null = null;
let disconnect: (() => void) | undefined;
const mountedRoots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    while (mountedRoots.length > 0) {
      mountedRoots.pop()?.unmount();
    }
  });
  disconnect?.();
  disconnect = undefined;
  receive = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setupDesktopEnv(opts: {
  pathname?: string;
  clientId?: string;
  hasFocus?: boolean;
  hidden?: boolean;
}) {
  const show = vi.fn();
  const dismiss = vi.fn();
  const subscribe = vi.fn(() => () => {});
  const state = vi.fn(async () => ({
    clientId: opts.clientId ?? 'desktop-macbook',
    isMainWindow: (opts.pathname ?? '/app') !== '/tray',
    mainWindowOpen: (opts.pathname ?? '/app') !== '/tray',
    focused: opts.hasFocus ?? false,
    screenLocked: false,
    systemIdleSec: 1,
    canNotify: true,
  }));
  class Source {
    static OPEN = 1;
    readyState = 1;
    set onmessage(handler: (event: { data: string }) => void) {
      receive = handler;
    }
    close() {}
  }
  const map = new Map<string, string>([['cairn.locale', 'zh']]);
  vi.stubGlobal('EventSource', Source);
  vi.stubGlobal('document', {
    hidden: opts.hidden ?? false,
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    hasFocus: () => opts.hasFocus ?? false,
  });
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    },
    location: { pathname: opts.pathname ?? '/app' },
    cairnDesktop: {
      notify: { show, dismiss },
      presence: { state, subscribe },
    },
  });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  return { show, dismiss };
}

test('schedule_run is alertable and routes chief schedule_run to ?chief=<id>', async () => {
  expect(SILENT_NOTIFICATION_TYPES).not.toContain('schedule_run');
  const { show } = setupDesktopEnv({ clientId: 'desktop-macbook' });
  const record = {
    id: 'user:chief-123',
    teamId: 'team',
    userId: 'user',
    type: 'schedule_run',
    entityId: 'chief-123',
    entityRef: { title: 'Morning digest', projectId: null, seqNum: null },
    agent: { name: 'Coordinator', avatarUrl: null },
    snippet: 'All checks passed',
    readAt: null,
    createdAt: Date.now(),
    channels: ['in_app'],
  };
  expect(notificationRecordSchema.safeParse(record).success).toBe(true);
  disconnect = startTeamStream('team', new QueryClient());
  await new Promise((resolve) => setTimeout(resolve, 0));
  receive?.({
    data: JSON.stringify({
      type: 'notification',
      notification: record,
      delivery: { id: 'deliv-1', targetClientId: 'desktop-macbook' },
    }),
  });
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
  expect(show.mock.calls[0]?.[0]).toMatchObject({
    title: 'Morning digest',
    body: 'All checks passed',
    href: '/app?chief=chief-123',
    tag: 'user:chief-123',
    deliveryId: 'deliv-1',
  });
});

test('non-target client ignores SSE delivery so a second Mac never pops a duplicate banner', async () => {
  const { show } = setupDesktopEnv({ clientId: 'desktop-mac-mini' });
  const record = {
    id: 'user:todo-1',
    teamId: 'team',
    userId: 'user',
    type: 'build_review',
    entityId: 'todo-1',
    entityRef: { title: 'Task 1', projectId: 'proj', seqNum: 1 },
    agent: { name: 'Owner', avatarUrl: null },
    snippet: null,
    readAt: null,
    createdAt: Date.now(),
    channels: ['in_app'],
  };
  disconnect = startTeamStream('team', new QueryClient());
  await new Promise((resolve) => setTimeout(resolve, 0));
  receive?.({
    data: JSON.stringify({
      type: 'notification',
      notification: record,
      delivery: { id: 'deliv-2', targetClientId: 'desktop-macbook' },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(show).not.toHaveBeenCalled();
});

test('readAt !== null over SSE dismisses delivered desktop banner', async () => {
  const { dismiss } = setupDesktopEnv({ clientId: 'desktop-macbook' });
  const record = {
    id: 'user:todo-2',
    teamId: 'team',
    userId: 'user',
    type: 'build_review',
    entityId: 'todo-2',
    entityRef: { title: 'Task 2', projectId: 'proj', seqNum: 2 },
    agent: { name: 'Owner', avatarUrl: null },
    snippet: null,
    readAt: Date.now(),
    createdAt: Date.now() - 1000,
    channels: ['in_app'],
  };
  disconnect = startTeamStream('team', new QueryClient());
  await new Promise((resolve) => setTimeout(resolve, 0));
  receive?.({
    data: JSON.stringify({
      type: 'notification',
      notification: record,
      delivery: { id: 'deliv-3', targetClientId: null },
    }),
  });
  await vi.waitFor(() => expect(dismiss).toHaveBeenCalledWith('user:todo-2'));
});

test('tray window still forwards targeted delivery when desktop main window is closed', async () => {
  const { show } = setupDesktopEnv({ pathname: '/tray', clientId: 'desktop-macbook' });
  const record = {
    id: 'user:todo-tray',
    teamId: 'team',
    userId: 'user',
    type: 'plan_ready',
    entityId: 'todo-tray',
    entityRef: { title: 'Tray task', projectId: 'proj', seqNum: 3 },
    agent: { name: 'Owner', avatarUrl: null },
    snippet: null,
    readAt: null,
    createdAt: Date.now(),
    channels: ['in_app'],
  };
  disconnect = startTeamStream('team', new QueryClient());
  await new Promise((resolve) => setTimeout(resolve, 0));
  receive?.({
    data: JSON.stringify({
      type: 'notification',
      notification: record,
      delivery: { id: 'deliv-tray', targetClientId: 'desktop-macbook' },
    }),
  });
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1));
});

function installHookTestDom(opts: { visibilityState: string; hasFocus: () => boolean }) {
  class MiniEl {
    nodeType = 1;
    childNodes: MiniEl[] = [];
    attributes = new Map<string, string>();
    parentNode: MiniEl | null = null;
    ownerDocument: MiniDoc | null = null;
    protected listeners = new Map<string, Set<() => void>>();
    constructor(readonly tagName: string) {}
    get nodeName() {
      return this.tagName;
    }
    appendChild(child: MiniEl) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    removeChild(child: MiniEl) {
      this.childNodes = this.childNodes.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    }
    setAttribute(k: string, v: string) {
      this.attributes.set(k, v);
    }
    addEventListener(type: string, fn: () => void) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(fn);
      this.listeners.set(type, set);
    }
    removeEventListener(type: string, fn: () => void) {
      this.listeners.get(type)?.delete(fn);
    }
  }
  class MiniDoc extends MiniEl {
    documentElement: MiniEl;
    body: MiniEl;
    defaultView = globalThis;
    activeElement: MiniEl | null = null;
    constructor() {
      super('#document');
      this.nodeType = 9;
      this.documentElement = new MiniEl('HTML');
      this.body = new MiniEl('BODY');
    }
    get visibilityState() {
      return opts.visibilityState;
    }
    hasFocus() {
      return opts.hasFocus();
    }
    createElement(tag: string) {
      const el = new MiniEl(tag.toUpperCase());
      el.ownerDocument = this;
      return el;
    }
    createElementNS(_ns: string, tag: string) {
      return this.createElement(tag);
    }
    createTextNode(_text: string) {
      const el = new MiniEl('#text');
      el.ownerDocument = this;
      return el;
    }
  }
  const winListeners = new Map<string, Set<() => void>>();
  const doc = new MiniDoc();
  const host = doc.createElement('div');
  const win = {
    location: { pathname: '/app', href: 'https://cairn.local/app' },
    document: doc,
    addEventListener: (type: string, fn: () => void) => {
      const set = winListeners.get(type) ?? new Set();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent: (event: { type: string }) => {
      for (const fn of [...(winListeners.get(event.type) ?? [])]) fn();
    },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('HTMLElement', MiniEl);
  vi.stubGlobal('Element', MiniEl);
  vi.stubGlobal('Node', class Node {});
  vi.stubGlobal('Text', MiniEl);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('SVGElement', class SVGElement {});
  return { doc, win, host };
}

test('unfocused window behind another app does not mark unread thread read until focus returns', async () => {
  let focused = false;
  const { win, host } = installHookTestDom({
    visibilityState: 'visible',
    hasFocus: () => focused,
  });
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchSpy);

  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  qc.setQueryData(['notifications', 'team'], { unreadThreadIds: ['todo-unfocus'] });

  function Probe() {
    useMarkThreadRead('todo-unfocus');
    return null;
  }

  const root = createRoot(host as unknown as HTMLElement);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(MemoryRouter, null, createElement(Probe)),
      ),
    );
  });

  const readCalls = () =>
    fetchSpy.mock.calls.filter(([url]) => String(url).includes('/notifications/todo-unfocus/read'));
  expect(readCalls()).toHaveLength(0);

  focused = true;
  await act(async () => {
    win.dispatchEvent(new Event('focus'));
  });
  await vi.waitFor(() => {
    expect(readCalls()).toHaveLength(1);
  });
});

test('focused web tab without input ages systemIdleSec past 600s so away routing still triggers', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const { host } = installHookTestDom({
    visibilityState: 'visible',
    hasFocus: () => true,
  });
  const posted: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        posted.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );

  function Probe() {
    useClientPresence('team', true);
    return null;
  }

  const root = createRoot(host as unknown as HTMLElement);
  mountedRoots.push(root);
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(11 * 60_000);
  });

  const latest = posted.at(-1);
  expect(latest?.kind).toBe('web');
  expect(latest?.focused).toBe(true);
  expect(Number(latest?.systemIdleSec)).toBeGreaterThanOrEqual(600);
});

test('desktop presence waits for bridge.state, refreshes systemIdleSec on heartbeat, and avoids DELETE on focus updates', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const { win, host } = installHookTestDom({
    visibilityState: 'visible',
    hasFocus: () => false,
  });
  let currentDesktopState = {
    clientId: 'desktop-1',
    mainWindowOpen: true,
    windowFocused: false,
    screenLocked: false,
    systemIdleSec: 700,
  };
  let seq = 0;
  let resolveInitial!: (value: typeof currentDesktopState) => void;
  let calls = 0;
  let subListener: ((state: typeof currentDesktopState) => void) | null = null;
  (win as Record<string, unknown>).cairnDesktop = {
    presence: {
      state: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<typeof currentDesktopState>((resolve) => {
            resolveInitial = resolve;
          });
        }
        return Promise.resolve(currentDesktopState);
      },
      subscribe: (listener: (state: typeof currentDesktopState) => void) => {
        subListener = listener;
        return () => {
          if (subListener === listener) subListener = null;
        };
      },
      nextSeq: () => {
        seq += 1;
        return seq;
      },
    },
  };

  const posted: Array<Record<string, unknown>> = [];
  let deleteCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        posted.push(JSON.parse(init.body) as Record<string, unknown>);
      } else if (init?.method === 'DELETE') {
        deleteCount += 1;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );

  function Probe() {
    useClientPresence('team', true);
    return null;
  }

  const root = createRoot(host as unknown as HTMLElement);
  mountedRoots.push(root);
  await act(async () => {
    root.render(createElement(Probe));
  });

  expect(posted).toHaveLength(0);

  await act(async () => {
    resolveInitial(currentDesktopState);
  });
  expect(posted).toHaveLength(1);
  expect(posted[0]?.systemIdleSec).toBe(700);

  currentDesktopState = { ...currentDesktopState, systemIdleSec: 5 };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(posted.at(-1)?.systemIdleSec).toBe(5);

  await act(async () => {
    subListener?.({ ...currentDesktopState, windowFocused: true });
  });
  expect(deleteCount).toBe(0);
  expect(posted.at(-1)?.focused).toBe(true);
});
