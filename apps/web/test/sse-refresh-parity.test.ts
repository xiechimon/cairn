import { type BuildRecord, type ComputerRecord, todoRecordSchema } from '@cairn/shared';
import { QueryClient, QueryClientProvider, type QueryKey, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { refreshQueriesOnGateClose, STREAM_REFRESH_QUIET_MS } from '../src/api/invalidate.js';
import { cacheUserMessage, moveQueueToReplacement } from '../src/api/message-cache.js';
import { SSE_BIZ_SILENCE_BASE_MS } from '../src/api/sse-connection.js';
import { startConversationStream, startTeamStream } from '../src/api/sse.js';
import { applyTeamStreamEvent, optimisticTodo } from '../src/api/team-stream-cache.js';
import { useComputerControl } from '../src/api/use-computer-control.js';
import { todo } from './helpers.js';
import { FakeEventSource } from './tab-stream-harness.js';

const auth = vi.hoisted(() => ({ open: false, listeners: new Set<() => void>() }));
vi.mock('../src/api/auth.js', () => ({
  authSnapshot: () => ({ gateOpen: auth.open }),
  subscribeAuth: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
  fetchWithSession: (path: string, init?: RequestInit) => fetch(path, init),
}));

const team = 'team-1';
const chief = 'chief-a';
const buildId = 'build-a';
const doc = todoRecordSchema.parse({
  ...todo(1, 'building'), teamId: team, projectId: 'project-a', createdBy: null, ownerId: null,
  latestBuildId: buildId, sourceBuildId: null, sourceKind: null, sourceRef: null,
});
const build: BuildRecord = {
  id: buildId, todoId: doc.id, withPlan: true, prevPhase: null, triggerSource: 'user',
  planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 1,
  reportAttachmentId: 'attachment',
};
const request = { id: 'request', role: 'user', content: 'Check the plan', createdAt: 1 };
const reply = { id: 'reply', role: 'assistant', content: 'The plan is ready', createdAt: 2 };
const pages = (messages: object[], queuedMessages: object[] = []) => ({
  pages: [{ messages, queuedMessages }], pageParams: [null],
});
const keys = {
  session: ['session'], schedules: ['schedules'], board: ['todos', team], archived: ['todos', team, 'archived'],
  tasks: ['tasks', team], otherTasks: ['tasks', 'team-2'], detail: ['todo', doc.id], design: ['design', doc.id],
  build: ['build', buildId], steps: ['steps', buildId], plans: ['plans', buildId], otherPlans: ['plans', 'build-b'],
  changes: ['changes', buildId], usage: ['usage', buildId], transcript: ['messages', buildId, 'pages'],
  target: ['messages', 'build-next', 'pages'], chiefTranscript: ['messages', chief, 'pages'],
  chiefThreads: ['chiefThreads', team], otherChiefThreads: ['chiefThreads', 'team-2'],
  chief: ['chief', team, chief], otherChief: ['chief', team, 'chief-b'], notifications: ['notifications', team],
  machines: ['machines', team], computers: ['computers', team, 1], otherComputers: ['computers', 'team-2', 1],
  routing: ['model-routing', team], project: ['projectBuilds', 'project-a'], search: ['search', doc.title],
} satisfies Record<string, QueryKey>;
type Key = keyof typeof keys;
const all = Object.keys(keys) as Key[];
const lists = ['board', 'archived', 'tasks'] as const;
const plans = ['plans', 'otherPlans'] as const;
const work = ['build', 'steps', 'changes', ...plans] as const;
const oldReconcile = [
  ...lists, 'otherTasks', 'detail', 'schedules', ...work, 'notifications', 'chiefThreads',
  'otherChiefThreads', 'chief', 'otherChief', 'machines', 'transcript', 'target', 'chiefTranscript', 'computers',
] as const;

const cleanup: (() => void)[] = [];
let qc: QueryClient;
let reads: Key[];
let cancelled: Key[];
let responses: Map<Key, unknown>;

function observe(pending = false): void {
  for (const key of all) {
    const value = key === 'tasks' ? { entries: [] }
      : key === 'notifications' ? { unreadThreadIds: [] }
      : key === 'detail' ? doc
      : key === 'chiefTranscript' ? pages([request])
      : key === 'transcript' ? pages([], [{ id: 'queued', createdAt: 1 }])
      : key === 'target' ? pages([])
      : [];
    qc.setQueryData(keys[key], value);
    const observer = new QueryObserver(qc, {
      queryKey: keys[key],
      queryFn: ({ signal }) => {
        reads.push(key);
        if (!pending) return Promise.resolve(responses.get(key) ?? qc.getQueryData(keys[key]));
        return new Promise((_, reject) => signal.addEventListener('abort', () => {
          cancelled.push(key);
          reject(signal.reason);
        }, { once: true }));
      },
    });
    cleanup.push(observer.subscribe(() => {}));
    if (pending) void observer.refetch();
  }
  reads.length = 0;
}

function hello(modern = true): FakeEventSource {
  const stream = FakeEventSource.instances.at(-1);
  if (stream === undefined) throw new Error('Missing stream');
  stream.fireOpen();
  stream.push({ type: 'hello', connectionId: `source-${FakeEventSource.instances.length}`, ...(modern ? { followRevision: true } : {}) });
  return stream;
}

async function conversation(id: string, event: object, modern = true): Promise<void> {
  const stop = startConversationStream(id, qc, { ...(id === buildId ? { todoId: doc.id } : {}) });
  cleanup.push(startTeamStream(team, qc), stop);
  const stream = hello(modern);
  await vi.advanceTimersByTimeAsync(0);
  reads.length = 0;
  stream.push({ type: 'conversation', conversationId: id, event });
}

const matrix: {
  event: string;
  base: readonly Key[];
  now?: readonly Key[];
  better?: string;
  fire: () => unknown;
  effect?: 'cancel';
}[] = [
  { event: 'auth gate closes → active queries', base: all, fire: () => {
    auth.open = true;
    cleanup.push(refreshQueriesOnGateClose(qc));
    auth.open = false;
    for (const listener of auth.listeners) listener();
  } },
  { event: 'new conversation follow → saved reply after prefetch', base: all, now: ['chiefTranscript'],
    better: 'Refresh the newly watched transcript without disturbing unrelated reads on navigation.', fire: async () => {
      const status = vi.fn();
      cleanup.push(startTeamStream(team, qc, 0, null, null, status));
      hello();
      await vi.advanceTimersByTimeAsync(0);
      expect(qc.getQueryData(keys.chiefTranscript)).toEqual(pages([request]));
      responses.set('chiefTranscript', pages([request, reply]));
      cleanup.push(startConversationStream(chief, qc, {}), startConversationStream(chief, qc, {}));
      await vi.advanceTimersByTimeAsync(0);
      expect(status).not.toHaveBeenCalled();
    } },
  { event: 'replacement acknowledges its follow set → all active queries', base: all, fire: async () => {
    cleanup.push(startTeamStream(team, qc));
    const stream = hello();
    await vi.advanceTimersByTimeAsync(0);
    stream.onerror?.();
    hello();
  } },
  { event: 'business silence with work in flight → stream projections and computers', base: oldReconcile,
    now: [...oldReconcile, 'usage', 'design', 'project', 'search', 'routing'],
    better: 'Also recover dependent stream-backed projections without refreshing session data.', fire: async () => {
      cleanup.push(startTeamStream(team, qc));
      const stream = hello();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(SSE_BIZ_SILENCE_BASE_MS - 1);
      stream.push({ type: 'ping' });
      await vi.advanceTimersByTimeAsync(1);
    } },
  { event: 'todo frame → schedules, plans, design, steps, transcript and loaded board lists',
    base: [...lists, ...plans, 'design', 'steps', 'transcript', 'schedules'],
    now: [...lists, ...plans, 'design', 'steps', 'transcript', 'schedules', 'detail', 'project', 'search'],
    better: 'Read back authoritative row, project and search data rather than relying on a partial patch.',
    fire: () => {
      const frame = { type: 'todo', doc: { ...doc, v: doc.v + 1 } };
      applyTeamStreamEvent(qc, team, frame);
      reads.length = 0;
      return applyTeamStreamEvent(qc, team, { ...frame, doc: { ...frame.doc, v: frame.doc.v + 1 } });
    } },
  { event: 'build frame → steps, todo, its plans and design', base: ['steps', 'detail', 'plans', 'design'],
    now: ['steps', 'detail', 'plans', 'design', ...lists, 'build', 'changes', 'transcript', 'project'],
    better: 'Read authoritative build, report and list data instead of displaying an unversioned frame.',
    fire: () => applyTeamStreamEvent(qc, team, { type: 'build', doc: build, projectId: doc.projectId }) },
  { event: 'notification → team Coordinator list and record', base: ['chiefThreads', 'chief', 'otherChief'],
    now: ['chiefThreads', 'chief', 'otherChief', 'notifications'],
    better: 'Also reconcile the patched unread count with the server.', fire: () => applyTeamStreamEvent(qc, team, {
      type: 'notification', notification: {
        teamId: team, userId: 'owner', type: 'plan_ready', entityId: doc.id, id: 'note', readAt: null,
        entityRef: { title: doc.title, projectId: null, seqNum: 1 }, agent: { name: 'Builder', avatarUrl: null },
        snippet: null, createdAt: 1, channels: ['in_app'],
      },
    }) },
  { event: 'machine presence → team machines, computers and routing', base: ['machines', 'computers', 'routing'],
    fire: () => applyTeamStreamEvent(qc, team, { type: 'machine_presence' }) },
  { event: 'computer state → team computers', base: ['computers'],
    fire: () => applyTeamStreamEvent(qc, team, { type: 'computer.state' }) },
  ...[true, false].map((checked) => ({ event: `computer control ${checked ? 'acquired' : 'released'} → team computers`, base: ['computers'] as const,
    fire: () => {
      let setHeld: ((held: boolean) => void) | undefined;
      function Control() {
        setHeld = useComputerControl({ teamId: team, computer: { id: 'desktop' } as ComputerRecord }).setHeld;
        return null;
      }
      renderToStaticMarkup(createElement(QueryClientProvider, { client: qc, children: createElement(Control) }));
      if (setHeld === undefined) throw new Error('Control did not render');
      setHeld(checked);
    } })),
  { event: 'task message with rollover → source and destination transcripts, plans and todo',
    base: ['transcript', 'target', ...plans, 'detail'],
    fire: () => conversation(buildId, { type: 'message', conversationId: 'build-next', message: reply }) },
  { event: 'Coordinator message → transcript, plans and Tasks',
    base: ['chiefTranscript', ...plans, 'tasks', 'otherTasks'],
    fire: () => conversation(chief, { type: 'message', message: reply }, false) },
  { event: 'task step → build, steps, changes, plans, usage and todo', base: [...work, 'usage', 'detail'],
    fire: () => conversation(buildId, { type: 'step', step: { status: 'claimed' } }) },
  ...(['pending', 'claimed', 'done', 'failed', 'stopped'] as const).flatMap((status) => [true, false].map((modern) => {
    const base: Key[] = [...plans, 'chiefThreads', 'otherChiefThreads'];
    if (status !== 'pending') base.push('chiefTranscript');
    if (status !== 'pending' && status !== 'claimed') base.push('chief', 'otherChief');
    return {
      event: `${modern ? 'versioned' : 'legacy'} Coordinator ${status} step → saved projections`, base,
      fire: () => conversation(chief, { type: 'step', step: { status } }, modern),
    };
  })),
  { event: 'optimistic task patch → cancel todo, board and Tasks prefixes', base: ['detail', ...lists],
    effect: 'cancel', fire: async () => (await optimisticTodo(qc, team, doc.id, { title: 'Renamed' })).settle() },
  { event: 'queued message rollover → cancel source and target reads', base: ['transcript', 'target'],
    effect: 'cancel', fire: () => moveQueueToReplacement(qc, buildId, 'build-next') },
  { event: 'saved user message cache patch → cancel its earlier read', base: ['transcript'],
    effect: 'cancel', fire: () => cacheUserMessage(qc, buildId, request) },
];

beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  reads = [];
  cancelled = [];
  responses = new Map();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    if (path.startsWith('/api/streams/')) {
      const { revision } = JSON.parse(String(init.body)) as { revision?: number };
      return revision === undefined ? new Response(null, { status: 204 }) : Response.json({ revision });
    }
    expect(path).toBe(`/api/teams/${team}/computers/desktop/control`);
    return Response.json({ leaseId: 'lease', released: true });
  });
});

afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  qc.clear();
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each(matrix)('$event', async ({ event, base, now, better, fire, effect }) => {
  observe(effect === 'cancel');
  await fire();
  await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS);
  const actual = effect === 'cancel' ? cancelled : reads;
  if (now !== undefined) expect(better).toBeTruthy();
  expect([...new Set(actual)].sort()).toEqual([...(now ?? base)].sort());
  if (event.startsWith('new conversation follow')) {
    expect(qc.getQueryData(keys.chiefTranscript)).toEqual(pages([request, reply]));
    expect(actual).toEqual(['chiefTranscript']);
  }
});
