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
  phaseAt: 0,
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
export const PROJECT = {
  id: 'proj-1',
  name: 'cairn',
  teamId: 't1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};

export const toolRow = (id: string, name: string, args: unknown, at: number) => ({
  id,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: { id: `c-${id}`, name, arguments: args, result: { ok: true }, startedAt: at, endedAt: at + 2000 },
  },
  createdAt: at,
});

export const HISTORY = [
  { id: 'm1', role: 'user', content: '看板拖完卡片计数不对，修一下', createdAt: 10 },
  toolRow('m2', 'create_todo', { title: TASK.title, projectId: 'proj-1' }, 11),
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

export type Row = { id: string; role: string; content: unknown; createdAt: number };

export interface MockState {
  threads: (typeof THREAD)[];
  messages: Row[];
  rejectSend?: boolean;
  todos?: unknown[];
  projects?: unknown[];
  machines?: unknown[];
  backup?: unknown;
  sendAt?: number;
}

type Json = (body: unknown, status?: number) => Promise<void>;

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
    if (p === '/api/teams/t1/agents/agent-1') return json(AGENT);
    if (p === '/api/todos') return json(state.todos ?? [TASK]);
    if (p === '/api/projects') return json(state.projects ?? [PROJECT]);
    if (p === '/api/teams/t1/machines') return json(state.machines ?? []);
    if (p === '/api/server/backup') return json(state.backup ?? { state: 'none' });
    if (p === '/api/teams/t1/members' || p === '/api/skills') return json([]);
    return json([]);
  });
  return sent;
}
