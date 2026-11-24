import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ChiefConversation, ChiefScrollProvider } from '../src/chief/chief-conversation.js';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import { questionDockState } from '../src/chief/question-dock-state.js';
import { VirtualStream } from '../src/chief/virtual-stream.js';
import { JumpToLatestButton } from '../src/components/chat/jump-to-latest.js';
import type { ChiefContent, ChiefStreamItem } from '../src/fixtures/records.js';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => unknown>,
  scrollToMessage: vi.fn(() => true),
  pauseFollow: vi.fn(),
  follow: vi.fn(),
  viewport: { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 },
  nodes: [] as HTMLElement[],
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useContext: () => ({ setReaderLeft: vi.fn() }),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useLayoutEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof value === 'function' ? value() : value;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next;
    }];
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-router', () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock('../src/api/connection-state.js', () => ({ useConnected: () => true }));
vi.mock('../src/api/hooks.js', () => ({ useTodos: () => ({}), useArchivedTodos: () => ({}) }));
vi.mock('../src/api/provider.js', () => ({ useLiveData: () => ({ live: false, teamId: 'team' }) }));
vi.mock('../src/board/thread-link.js', () => ({ useOpenThread: () => vi.fn() }));
vi.mock('../src/board/use-narrow.js', () => ({ useNarrow: () => false }));
vi.mock('../src/hooks/use-minute-clock.js', () => ({ useMinuteClock: () => 1000 }));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text, locale: 'en' }) }));
vi.mock('../src/overlay/file-drop.js', () => ({ useFileDrop: () => ({ bind: {} }) }));
vi.mock('../src/overlay/use-server-draft.js', () => ({ useServerDraft: () => ['', vi.fn()] }));
vi.mock('../src/components/ui/message-scroller.js', () => ({
  MessageScroller: 'div',
  MessageScrollerContent: 'div',
  MessageScrollerItem: 'div',
  MessageScrollerProvider: 'div',
  useMessageScroller: () => ({ scrollToEnd: vi.fn(), scrollToMessage: hooks.scrollToMessage }),
  useMessageScrollerScrollable: () => ({ end: false }),
}));
vi.mock('../src/chief/chief-question.js', () => ({
  ChiefQuestion: () => null,
  ChiefQuestionDock: () => null,
  QuestionRestoreButton: () => null,
  useAnswerKey: () => null,
  useDockedQuestion: () => null,
  useQuestionPending: () => false,
}));
vi.mock('../src/chief/reader-follow.js', () => ({
  ReaderFollowContext: { Provider: 'reader-provider' },
  useReaderFollow: () => ({ follow: hooks.follow, pause: hooks.pauseFollow, viewportProps: {} }),
  useReaderLeft: () => true,
}));

function findElement(tree: ReactNode, matches: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> {
  const queue: unknown[] = [tree];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) queue.push(...node);
    else if (isValidElement<Record<string, unknown>>(node)) {
      if (matches(node)) return node;
      queue.push(node.props.children);
    }
  }
  throw new Error('Missing conversation element');
}

const question: ChiefStreamItem = {
  kind: 'question', id: 'message-parked', requestId: 'request-parked', status: 'pending', parkedAt: 1000,
  questions: [{ header: 'Scope', question: 'Which pages?', options: [{ label: 'All pages' }] }], answers: null,
};
const stream: ChiefStreamItem[] = [
  { kind: 'robot', id: 'intro', markdown: 'Choose the scope.', seconds: '0s' },
  question,
  ...Array.from({ length: 100 }, (_, index): ChiefStreamItem => ({ kind: 'user', id: `later-${index}`, text: `Later message ${index}` })),
];

function render(threadId = 'conversation', day?: { earlier: number; today: ReactNode }, conversation = stream) {
  hooks.cursor = 0;
  const tree = ChiefConversation({
    chief: { threadId, bound: true, stream: conversation } as ChiefContent,
    mentionGroups: { todo: [], agent: [], project: [], skill: [], machine: [] },
    day,
  });
  const viewport = findElement(tree, (node) => node.props['data-testid'] === 'chief-body');
  (viewport.props.ref as { current: unknown }).current = {
    ...hooks.viewport,
    querySelectorAll: () => hooks.nodes,
  };
  const virtual = day === undefined ? findElement(tree, (node) => node.type === VirtualStream) : null;
  const jumpToLatest = findElement(tree, (node) => node.type === JumpToLatestButton);
  for (const effect of hooks.effects.splice(0)) effect();
  return {
    scrollTarget: (virtual?.props ?? {}).scrollTarget as
      | { index: number; onMounted: (node: HTMLDivElement) => boolean }
      | undefined,
    followAfterClick: jumpToLatest.props.followAfterClick,
    keys: virtual?.props.keys,
    renderRow: virtual?.props.renderRow as ((index: number) => ReactNode) | undefined,
  };
}

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => name === '--scroll-fade-size-top' ? '128px' : '32px',
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  hooks.states.length = 0;
  hooks.effects.length = 0;
  hooks.nodes.length = 0;
  hooks.viewport.scrollTop = 500;
  questionDockState.takeScrollTo();
  vi.clearAllMocks();
});

test('explicitly resuming follow clears the stale away-from-bottom state before scrolling', () => {
  const provider = () => {
    hooks.cursor = 0;
    return ChiefScrollProvider({ children: null });
  };
  const initial = provider();
  const armed = findElement(initial, (node) => typeof node.props.onAtBottom === 'function');
  (armed.props.onAtBottom as (atBottom: boolean) => void)(false);
  const away = provider();
  expect(away.props.autoScroll).toBe(false);
  const context = findElement(away, (node) => node.type === 'reader-provider');
  const value = context.props.value as { setReaderLeft: (left: boolean) => void };
  value.setReaderLeft(true);
  expect(provider().props.autoScroll).toBe(false);
  value.setReaderLeft(false);
  expect(provider().props.autoScroll).toBe(true);
});

test('a Tasks jump pauses following and focuses the landed virtual row without a second scroll', () => {
  questionDockState.requestScrollTo('request-parked');
  const { followAfterClick } = render();
  expect(hooks.pauseFollow).toHaveBeenCalledOnce();
  expect(followAfterClick).toBe(false);
  const target = render().scrollTarget;
  expect(target?.index).toBe(1);
  const focus = vi.fn();
  const querySelector = vi.fn(() => ({ focus }));
  target?.onMounted({ querySelector } as unknown as HTMLDivElement);
  expect(hooks.scrollToMessage).not.toHaveBeenCalled();
  expect(querySelector).toHaveBeenCalledWith('[data-question-row]');
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(hooks.follow).not.toHaveBeenCalled();
  expect(render().scrollTarget).toBeUndefined();
});

test.each([0, 0.5, 2, 30, 40])('a virtual Tasks landing with %s px remaining follows only at the bottom', (gap) => {
  questionDockState.requestScrollTo('request-parked');
  render();
  hooks.viewport.scrollTop = 800 - gap;
  const target = render().scrollTarget;
  const focus = vi.fn();
  target?.onMounted({ querySelector: () => ({ focus }) } as unknown as HTMLDivElement);
  expect(hooks.follow).toHaveBeenCalledTimes(gap <= 1 ? 1 : 0);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(hooks.scrollToMessage).not.toHaveBeenCalled();
});

test('the nonvirtual day view does not focus a row that has not registered', () => {
  const focus = vi.fn();
  hooks.nodes.push({
    dataset: { requestId: 'request-parked' },
    querySelector: () => ({ focus }),
  } as unknown as HTMLElement);
  const day = { earlier: 2, today: null };
  questionDockState.requestScrollTo('request-parked');
  render('conversation', day);
  hooks.scrollToMessage.mockReturnValueOnce(false);
  render('conversation', day);
  expect(focus).not.toHaveBeenCalled();
  render('conversation', day);
  expect(focus).toHaveBeenCalledOnce();
});

test('the nonvirtual day view still scrolls and focuses its mounted question', () => {
  const focus = vi.fn();
  hooks.nodes.push({
    dataset: { requestId: 'request-parked' },
    querySelector: () => ({ focus }),
  } as unknown as HTMLElement);
  questionDockState.requestScrollTo('request-parked');
  const day = { earlier: 2, today: null };
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => name === '--scroll-fade-size' ? '32px' : '',
  }));
  render('conversation', day);
  render('conversation', day);
  expect(hooks.scrollToMessage).toHaveBeenCalledExactlyOnceWith('message-parked', { align: 'start', scrollMargin: 32 });
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});

test.each([0, 30])('a nonvirtual Tasks landing with %s px remaining follows only at the bottom', (gap) => {
  const focus = vi.fn();
  hooks.nodes.push({
    dataset: { requestId: 'request-parked' },
    querySelector: () => ({ focus }),
  } as unknown as HTMLElement);
  hooks.viewport.scrollTop = 800 - gap;
  questionDockState.requestScrollTo('request-parked');
  const day = { earlier: 2, today: null };
  render('conversation', day);
  render('conversation', day);
  expect(hooks.follow).toHaveBeenCalledTimes(gap === 0 ? 1 : 0);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});

test('a missing request does not scroll or focus a different row', () => {
  questionDockState.requestScrollTo('missing-request');
  render();
  expect(render().scrollTarget).toBeUndefined();
  expect(hooks.scrollToMessage).not.toHaveBeenCalled();
});

test('only visible transcript rows get virtual keys, join bubbles, and set divider times', () => {
  const approval = { ...question, id: 'parked-approval', requestId: 'approval-send' };
  const { keys, renderRow } = render('conversation', undefined, [
    { kind: 'robot', id: 'start', markdown: 'The report is ready.', seconds: '', createdAt: 1000 },
    { ...approval, parkedAt: 2000 },
    { kind: 'robot', id: 'continuation', markdown: 'It covers the dashboard.', seconds: '', createdAt: 3000 },
    { ...approval, id: 'newer-approval', requestId: 'approval-newer-send', parkedAt: 800_000 },
    { kind: 'robot', id: 'later', markdown: 'The dashboard changed.', seconds: '', createdAt: 810_000 },
    { ...approval, id: 'receipt', status: 'answered' },
    question,
  ]);
  expect(keys).toEqual(['start', 'continuation', 'later', 'receipt', 'message-parked']);
  expect(findElement(renderRow?.(0), (node) => node.type === ChiefStreamRow).props.joinsNext).toBe(true);
  expect(findElement(renderRow?.(1), (node) => node.type === ChiefStreamRow).props.joinsPrev).toBe(true);
  const divider = findElement(renderRow?.(2), (node) => node.props['data-testid'] === 'chief-time-divider');
  expect(findElement(divider, (node) => node.type === 'time').props.dateTime).toBe(new Date(810_000).toISOString());
});

test('a pending jump cannot focus a different conversation after a channel switch', () => {
  questionDockState.requestScrollTo('request-parked');
  render();
  expect(render('other-conversation').scrollTarget).toBeUndefined();
  expect(hooks.scrollToMessage).not.toHaveBeenCalled();
});
