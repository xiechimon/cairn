import { buildOrchestratePrompt } from '@cairn/shared';
import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement, type DependencyList } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { startTeamStream } from '../src/api/sse.js';
import { useThreadChat } from '../src/board/use-thread-chat.js';
import { useChiefSurface } from '../src/chief/use-chief-surface.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { FakeEventSource } from './tab-stream-harness.js';

const { coordinatorId, projectChannelId, buildId, effects } = vi.hoisted(() => ({
  coordinatorId: 'chief-coordinator',
  projectChannelId: 'chief-project',
  buildId: 'task-build',
  effects: [] as { effect: () => void | (() => void); follow: boolean }[],
}));
const taskId = 'waiting-task';
const teamId = 'team';

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useEffect: (effect: () => void | (() => void), deps?: DependencyList) => {
      const follow = [coordinatorId, projectChannelId, buildId].some((id) => deps?.[0] === id);
      if (follow || deps?.[1] === coordinatorId) effects.push({ effect, follow });
    },
    useSyncExternalStore: <T>(
      subscribe: (onChange: () => void) => () => void,
      snapshot: () => T,
      serverSnapshot = snapshot,
    ) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot),
  };
});
vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 'team', userName: 'Owner' }),
}));
vi.mock('../src/board/use-mark-thread-read.js', () => ({ useMarkThreadRead: () => {} }));

function ProjectTask() {
  useChiefSurface({ todos: [], now: 0 }, { threadId: null, onConsumed: () => {} });
  const { transcript } = useThreadChat(taskId, undefined);
  return createElement('div', null, JSON.stringify(transcript));
}

function renderProjectTask(qc: QueryClient) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: qc,
      children: createElement(MemoryRouter, {
        initialEntries: ['/app?project=selected&thread=waiting-task'],
        children: createElement(I18nProvider, {
          initialLocale: 'en',
          children: createElement(ProjectTask),
        }),
      }),
    }),
  );
}

test('a changed Coordinator summary refreshes the task pane from the global transcript on a legacy follow', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const chiefThreadsKey = ['chiefThreads', teamId];
  const messagesKey = ['messages', coordinatorId, 'pages'];
  const coordinator = { id: coordinatorId, title: 'Coordinator', createdAt: 1, lastTurnAt: 1 };
  const projectChannel = { id: projectChannelId, projectId: 'selected', title: 'Project', createdAt: 1, lastTurnAt: 1 };
  const request = { id: 'request', role: 'user', content: buildOrchestratePrompt({ id: taskId, seqNum: 1, spec: 'Check the plan' }), createdAt: 1 };
  const reply = { id: 'reply', role: 'assistant', content: 'Saved Coordinator reply', createdAt: 2 };
  const pendingTranscript = { messages: [request] };
  const savedTranscript = { messages: [request, reply] };
  const settledThreads = [{ ...coordinator, activeRun: null, lastTurnAt: 2 }, projectChannel];
  const threadsPath = `/api/teams/${teamId}/chief/threads`;
  const transcriptPath = `/api/conversations/${coordinatorId}/messages`;
  let transcript = pendingTranscript;
  const readTranscript = vi.fn(() => Response.json(transcript));
  const followed = new Set<string>();
  const fetchApi = vi.fn<typeof fetch>(async (path, init) => {
    if (path === '/api/streams/legacy/conversations') {
      const body = JSON.parse(String(init?.body)) as { conversationIds: string[]; revision?: number };
      if (body.revision !== undefined) {
        return Response.json({ error: 'Unexpected revision' }, { status: 400 });
      }
      followed.clear();
      for (const id of body.conversationIds) followed.add(id);
      return new Response(null, { status: 204 });
    }
    if (path === transcriptPath) return readTranscript();
    expect(path).toBe(threadsPath);
    return Response.json(settledThreads);
  });
  qc.setQueryData(chiefThreadsKey, [{ ...coordinator, activeRun: { phase: 'chief' } }, projectChannel]);
  qc.setQueryData(messagesKey, { pages: [pendingTranscript], pageParams: [null] });
  qc.setQueryData(['todo', taskId], {
    id: taskId,
    title: 'Check the plan',
    phase: 'todo',
    phaseAt: 1,
    latestBuildId: buildId,
  });
  const stopThreads = new QueryObserver(qc, {
    queryKey: chiefThreadsKey,
    queryFn: () => api.get<typeof settledThreads>(threadsPath),
  }).subscribe(() => {});
  const stopTranscript = new InfiniteQueryObserver(qc, {
    queryKey: messagesKey,
    queryFn: () => api.get<typeof savedTranscript>(transcriptPath),
    initialPageParam: null,
    getNextPageParam: () => undefined,
  }).subscribe(() => {});
  vi.stubGlobal('fetch', fetchApi);
  vi.stubGlobal('EventSource', FakeEventSource);
  const stopTeam = startTeamStream(teamId, qc);
  const cleanups: (() => void)[] = [];
  const flushEffects = (follow: boolean) => {
    for (const item of effects.splice(0)) {
      if (item.follow !== follow) continue;
      const cleanup = item.effect();
      if (cleanup !== undefined) cleanups.push(cleanup);
    }
  };
  try {
    expect(renderProjectTask(qc)).not.toContain(reply.content);
    flushEffects(true);
    const tab = FakeEventSource.instances[0];
    if (tab === undefined) throw new Error('Missing team stream');
    tab.fireOpen();
    tab.push({ type: 'hello', connectionId: 'legacy' });
    await vi.waitFor(() => expect(followed).toEqual(new Set([projectChannelId, buildId, coordinatorId])));
    expect(renderProjectTask(qc)).not.toContain(reply.content);
    flushEffects(false);
    await vi.waitFor(() => expect(qc.getQueryState(messagesKey)?.fetchStatus).toBe('idle'));
    readTranscript.mockClear();

    transcript = savedTranscript;
    await qc.refetchQueries({ queryKey: chiefThreadsKey });
    expect(qc.getQueryData(chiefThreadsKey)).toEqual(settledThreads);
    expect(renderProjectTask(qc)).not.toContain(reply.content);
    flushEffects(false);
    await vi.waitFor(() => expect(renderProjectTask(qc)).toContain(reply.content));
    expect(readTranscript).toHaveBeenCalledOnce();
  } finally {
    for (const cleanup of cleanups) cleanup();
    effects.length = 0;
    stopTeam();
    stopTranscript();
    stopThreads();
    qc.clear();
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
  }
});
