import type { Page, Route } from '@playwright/test';

declare global {
  interface Window {
    __es: { url: string; readyState: number; emit: (ev: unknown) => void }[];
  }
}

export const TEAM = { id: 't1', name: '团队' };
export const USER = { id: 'u1', displayName: 'ian', avatarUrl: null };
export const AGENT = {
  id: 'agent-1',
  displayName: 'r5-scribe',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};
export const THREAD = {
  id: 'chief-home',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: '修看板计数',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};
export const TASK = {
  id: 'todo-1',
  teamId: 't1',
  projectId: 'proj-1',
  title: '修复看板拖拽后计数不刷新',
  spec: '',
  phase: 'building',
  phaseAt: Date.now() - 12 * 60_000,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: 'build-1',
  lastRunAt: 0,
  hasChanges: false,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};
export const taskEntry = (over: Record<string, unknown>) => ({
  ...TASK,
  createdBy: USER.id,
  ownerId: USER.id,
  sourceBuildId: null,
  sourceKind: null,
  sourceRef: null,
  ...over,
  kind: 'todo',
});

export const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: 't1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

export const READY_MACHINE = { id: 'm-ready', name: 'omarchy', online: true };
export const READY_PROVIDER = { id: 'p-ready', providerId: 'r3-gw', label: 'r3-gw' };

export const toolRow = (id: string, name: string, args: unknown, at: number) => ({
  id,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: { id: `c-${id}`, name, arguments: args, result: { ok: true }, startedAt: at, endedAt: at + 2000 },
  },
  createdAt: at,
});

export const createTodoRow = (
  id: string,
  todo: { id: string; seqNum: number; title: string; projectId?: string },
  at: number,
) => ({
  id,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: `c-${id}`,
      name: 'create_todo',
      arguments: { title: todo.title, projectId: todo.projectId ?? 'proj-1' },
      result: { id: todo.id, seqNum: todo.seqNum, title: todo.title },
      startedAt: at,
      endedAt: at + 1,
    },
  },
  createdAt: at,
});

export const HISTORY = [
  { id: 'm1', role: 'user', content: '看板拖完卡片计数不对，修一下', createdAt: 10 },
  createTodoRow('m2', TASK, 11),
  {
    id: 'm3',
    role: 'assistant',
    content: '已建任务 [#9 修复看板拖拽后计数不刷新](todo:todo-1)，放在 cairn，正在跑。',
    createdAt: 12,
  },
  { id: 'm4', role: 'user', content: '顺便把空列的提示也改一下', createdAt: 20 },
  toolRow('m5', 'message_todo', { todoId: 'todo-1', content: '空列提示也改一下' }, 21),
  { id: 'm6', role: 'assistant', content: '这条和 #9 是同一处，已经补给它了。', createdAt: 22 },
];

export type Row = {
  id: string;
  role: string;
  content: unknown;
  createdAt: number;
  projectId?: string | null;
};

export interface MockState {
  threads: (typeof THREAD & { projectId?: string | null })[];
  messages: Row[];
  channels?: Record<string, Row[]>;
  rejectSend?: boolean;
  todos?: unknown[];
  tasks?: unknown[];
  projects?: unknown[];
  machines?: unknown[];
  backup?: unknown;
  sendAt?: number;
}

type Json = (body: unknown, status?: number) => Promise<void>;

function pendingQuestionEntries(messages: Row[]) {
  return messages.flatMap((row) => {
    if (typeof row.content !== 'string' || !row.content.startsWith('{')) return [];
    const content = JSON.parse(row.content) as {
      kind?: string;
      requestId: string;
      status: string;
      questions: { header: string }[];
    };
    if (content.kind !== 'ask_user_question' || content.status !== 'pending') return [];
    return [
      {
        kind: 'question',
        requestId: content.requestId,
        threadId: THREAD.id,
        projectId: null,
        title: content.questions[0]?.header ?? '',
        section: 'needs_input',
        createdAt: row.createdAt,
        content,
      },
    ];
  });
}

export async function mockLive(
  page: Page,
  state: MockState,
  extra?: (path: string, route: Route, json: Json) => Promise<void> | undefined,
) {
  await page.addInitScript(() => {
    window.__es = [];
    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        window.__es.push(this as unknown as (typeof window.__es)[number]);
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      emit(ev: unknown) {
        this.onmessage?.({ data: JSON.stringify(ev) });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
  const sent: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const json: Json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const handled = extra?.(p, route, json);
    if (handled !== undefined) return handled;
    if (p === '/api/teams') return json([TEAM]);
    if (p === '/api/user/me') return json(USER);
    if (p === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (p === '/api/teams/t1/chief/threads' && request.method() === 'POST') {
      const content = (request.postDataJSON() as { content: string }).content;
      sent.push(content);
      if (state.rejectSend) return json({ error: 'boom' }, 500);
      state.threads = [THREAD];
      state.messages = [{ id: 'n1', role: 'user', content, createdAt: 30 }];
      return json({ thread: THREAD }, 201);
    }
    if (p === '/api/teams/t1/chief/threads') return json(state.threads);
    const channel = /^\/api\/teams\/t1\/chief\/channels\/([^/]+)$/.exec(p)?.[1];
    if (channel !== undefined && request.method() === 'POST') {
      const archived = (state.projects as { id: string; archivedAt?: number | null }[] | undefined)?.some(
        (row) => row.id === channel && row.archivedAt != null,
      );
      if (archived === true) return json({ error: `project ${channel} is archived` }, 409);
      const opened = { ...THREAD, id: `chief-${channel}`, projectId: channel, title: channel };
      state.threads = [...state.threads.filter((row) => row.id !== opened.id), opened];
      state.channels = { ...state.channels, [channel]: state.channels?.[channel] ?? [] };
      return json(opened, 201);
    }
    const channelThread = state.threads.find(
      (row) => row.projectId != null && p === `/api/conversations/${row.id}/messages`,
    );
    if (channelThread?.projectId != null) {
      const key = channelThread.projectId;
      if (request.method() === 'POST') {
        const content = (request.postDataJSON() as { content: string }).content;
        sent.push(content);
        const rows = state.channels?.[key] ?? [];
        state.channels = {
          ...state.channels,
          [key]: [
            ...rows,
            { id: `${key}-n${rows.length + 1}`, role: 'user', content, createdAt: state.sendAt ?? Date.now() },
          ],
        };
        return json({ thread: channelThread }, 201);
      }
      return json({ messages: state.channels?.[key] ?? [] });
    }
    if (p === '/api/teams/t1/chief')
      return json({
        chief: {
          id: 'chief-u1-t1',
          userId: 'u1',
          teamId: 't1',
          agent: { agentId: 'agent-1' },
          charter: null,
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: AGENT,
        context: null,
        watches: [],
        wakes: [],
      });
    if (p === `/api/conversations/${THREAD.id}/messages` && request.method() === 'POST') {
      const content = (request.postDataJSON() as { content: string }).content;
      sent.push(content);
      state.messages = [
        ...state.messages,
        {
          id: `n${state.messages.length + 1}`,
          role: 'user',
          content,
          createdAt: state.sendAt ?? Date.now(),
        },
      ];
      return json({ thread: THREAD }, 201);
    }
    if (p === `/api/conversations/${THREAD.id}/messages`) return json({ messages: state.messages });
    if (/^\/api\/conversations\/[^/]+\/messages$/.test(p)) {
      return json({ messages: [], nextCursor: null });
    }
    if (p === '/api/todos') return json(state.todos ?? [TASK]);
    if (p === '/api/tasks') return json({ entries: [...(state.tasks ?? []), ...pendingQuestionEntries(state.messages)] });
    if (p === '/api/projects') return json(state.projects ?? [PROJECT]);
    if (p === '/api/teams/t1/machines') return json(state.machines ?? [READY_MACHINE]);
    if (p === '/api/teams/t1/providers') return json({ presets: [], providers: [READY_PROVIDER] });
    if (p === '/api/server/backup') return json(state.backup ?? { state: 'none' });
    if (p === '/api/teams/t1/members' || p === '/api/skills') return json([]);
    return json([]);
  });
  return sent;
}
