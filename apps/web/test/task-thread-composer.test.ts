import type { KeyboardEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type DependencyList } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ThreadChat, useThreadChat } from '../src/board/use-thread-chat.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { type ComposerWire, useComposerWire } from '../src/overlay/composer-wire.js';

const { sendKeyState, sendingRef } = vi.hoisted(() => ({
  sendKeyState: { current: null as unknown },
  sendingRef: { current: false },
}));

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useEffect: (_effect: () => void | (() => void), _deps?: DependencyList) => {},
    useLayoutEffect: () => {},
    useRef: <T>(initial: T) => {
      if (initial === false) return sendingRef as unknown as { current: T };
      return { current: initial };
    },
    useSyncExternalStore: <T>(
      subscribe: (onChange: () => void) => () => void,
      snapshot: () => T,
      serverSnapshot = snapshot,
    ) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot),
    useState: <T>(initial: T | (() => T)) => {
      if (typeof initial === 'function') {
        if (sendKeyState.current === null) sendKeyState.current = (initial as () => T)();
        return [sendKeyState.current as T, vi.fn()];
      }
      return [initial, vi.fn()];
    },
  };
});

vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 't1', userName: 'Owner' }),
}));
vi.mock('../src/board/use-mark-thread-read.js', () => ({ useMarkThreadRead: () => {} }));
vi.mock('../src/pwa/thread-presence.js', () => ({ useThreadPresence: () => {} }));

function keyboard(key: string) {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

const clients: QueryClient[] = [];

function seedChat(qc: QueryClient, todoId = 'todo-1', buildId = 'build-1') {
  qc.setQueryData(['todo', todoId], {
    id: todoId,
    teamId: 't1',
    projectId: 'p1',
    title: 'Task',
    spec: '',
    phase: 'building',
    phaseAt: 1,
    seqNum: 1,
    orderIndex: 0,
    latestBuildId: buildId,
    lastRunAt: 1,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  });
  qc.setQueryData(['build', buildId], {
    id: buildId,
    todoId,
    withPlan: false,
    prevPhase: null,
    triggerSource: 'user',
    planDocId: null,
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: 1,
  });
  qc.setQueryData(['steps', buildId], [
    {
      id: 'step-1',
      buildId,
      kind: 'session',
      machineId: 'm1',
      createdAt: 1,
      status: 'claimed',
      checkpointCommit: null,
      skillInjection: null,
    },
  ]);
  qc.setQueryData(['messages', buildId, 'pages'], {
    pages: [
      {
        messages: [],
        chips: null,
        historyEpoch: 0,
        steerPending: [],
        activeRun: null,
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
}

function renderHarness(
  qc: QueryClient,
  draft: string,
  onDraftChange: (next: string) => void,
  todoId = 'todo-1',
): { chat: ThreadChat; wire: ComposerWire } {
  let chat: ThreadChat | undefined;
  let wire: ComposerWire | undefined;
  function Probe() {
    chat = useThreadChat(todoId, undefined);
    wire = useComposerWire({
      editable: true,
      draft,
      onDraftChange,
      onSend: chat.send,
    });
    return null;
  }
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(
        MemoryRouter,
        { initialEntries: ['/app?thread=todo-1'] },
        createElement(I18nProvider, { initialLocale: 'en', children: createElement(Probe) }),
      ),
    ),
  );
  if (chat === undefined || wire === undefined) throw new Error('Harness did not run');
  return { chat, wire };
}

afterEach(() => {
  sendKeyState.current = null;
  sendingRef.current = false;
  vi.restoreAllMocks();
  for (const qc of clients.splice(0)) qc.clear();
});

describe('task thread composer send', () => {
  test('rapid sends show optimistic bubbles immediately, never drop the second press, and post in order', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    clients.push(qc);
    seedChat(qc);

    const posted: { content: string; resolve: () => void }[] = [];
    vi.spyOn(api, 'post').mockImplementation((_path, body) => {
      const content = (body as { content: string }).content;
      return new Promise((resolve) => {
        posted.push({
          content,
          resolve: () => resolve({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'steer' }),
        });
      });
    });

    let draft = '第一句';
    const setDraft = (next: string) => {
      draft = next;
    };
    const r1 = renderHarness(qc, draft, setDraft);
    r1.wire.handleKeyDown(keyboard('Enter'));
    expect(draft).toBe('');

    const r2 = renderHarness(qc, '第二句', setDraft);
    expect(
      r2.chat.transcript.filter((item) => item.kind === 'user').map((item) => item.text),
    ).toEqual(['第一句']);

    draft = '第二句';
    r2.wire.handleKeyDown(keyboard('Enter'));
    expect(draft).toBe('');

    const r3 = renderHarness(qc, draft, setDraft);
    expect(
      r3.chat.transcript.filter((item) => item.kind === 'user').map((item) => item.text),
    ).toEqual(['第一句', '第二句']);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted.map((p) => p.content)).toEqual(['第一句']);
    posted[0]!.resolve();
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((p) => p.content)).toEqual(['第一句', '第二句']);
    posted[1]!.resolve();
  });

  test('a failed send rolls back the optimistic bubble, sets sendError, and yields failed text to restore', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    clients.push(qc);
    seedChat(qc, 'todo-2', 'build-2');

    let rejectPost!: (err: Error) => void;
    vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }),
    );

    let draft = '失败消息';
    const r1 = renderHarness(
      qc,
      draft,
      (next) => {
        draft = next;
      },
      'todo-2',
    );
    r1.wire.handleKeyDown(keyboard('Enter'));
    expect(draft).toBe('');

    const r2 = renderHarness(
      qc,
      draft,
      (next) => {
        draft = next;
      },
      'todo-2',
    );
    expect(
      r2.chat.transcript.filter((item) => item.kind === 'user').map((item) => item.text),
    ).toEqual(['失败消息']);

    await vi.waitFor(() => expect(rejectPost).toBeDefined());
    rejectPost(new Error('Network failure'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const r3 = renderHarness(
      qc,
      draft,
      (next) => {
        draft = next;
      },
      'todo-2',
    );
    expect(r3.chat.transcript.filter((item) => item.kind === 'user')).toEqual([]);
    expect(r3.chat.sendError).not.toBeNull();
    expect(r3.chat.unsent?.failed.map((entry) => entry.text)).toEqual(['失败消息']);
    const restored = r3.chat.unsent?.failed[0]
      ? r3.chat.unsent.discard(r3.chat.unsent.failed[0].key)
      : null;
    expect(restored).toBe('失败消息');
  });
});
