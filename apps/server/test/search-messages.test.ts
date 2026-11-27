import {
  CHIEF_DIGEST_KIND,
  CHIEF_NOTICE_KIND,
  chiefDigestThreadId,
  chiefMemoryThreadId,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread, message, project, team, user } from '../src/db/schema.js';
import { personalSpaceId } from '../src/services/personal-space.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const NOW = 1_750_000_000_000;

let seq = 0;

function addChiefThread(
  s: TestServer,
  opts: {
    id?: string;
    chiefId?: string;
    userId?: string;
    teamId?: string;
    projectId?: string | null;
    title?: string;
    updatedAt?: number;
    archivedAt?: number | null;
  } = {},
): string {
  seq += 1;
  const id = opts.id ?? `ct-${seq}`;
  s.db
    .insert(chiefThread)
    .values({
      id,
      chiefId: opts.chiefId ?? `chief-${opts.userId ?? s.user.id}-${opts.teamId ?? s.team.id}`,
      userId: opts.userId ?? s.user.id,
      teamId: opts.teamId ?? s.team.id,
      projectId: opts.projectId ?? null,
      title: opts.title ?? 'Coordinator',
      createdAt: NOW,
      updatedAt: opts.updatedAt ?? NOW,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: NOW,
      toolDefHashes: {},
      toolResultHashes: {},
      archivedAt: opts.archivedAt ?? null,
    })
    .run();
  return id;
}

function addChiefMessage(
  s: TestServer,
  threadId: string,
  opts: {
    id?: string;
    role?: 'user' | 'assistant' | 'system';
    content: unknown;
    origin?: (typeof chiefMessage.$inferInsert)['origin'];
    projectId?: string | null;
    createdAt?: number;
  },
): string {
  seq += 1;
  const id = opts.id ?? `cm-${seq}`;
  s.db
    .insert(chiefMessage)
    .values({
      id,
      threadId,
      role: opts.role ?? 'user',
      content: opts.content,
      origin: opts.origin ?? null,
      projectId: opts.projectId ?? null,
      createdAt: opts.createdAt ?? NOW + seq,
    })
    .run();
  return id;
}

interface MessageHit {
  id: string;
  threadId: string;
  projectId: string | null;
  projectName: string | null;
  role: 'user' | 'assistant';
  snippet: string;
  createdAt: number;
}

interface SearchJson {
  todos: { id: string; title: string }[];
  projects: { id: string; name: string }[];
  messages?: MessageHit[];
}

async function runSearch(s: TestServer, q: string): Promise<SearchJson> {
  const res = await req(s.app, 'GET', `/api/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SearchJson;
}

describe('GET /api/search chat messages', () => {
  test('matches Chinese, symbols (+, %, _), mixed text, NFKC full-width, and multi-term queries across Coordinator and project threads', async () => {
    const s = bootServer();
    const projectX = await postProject(s.app, 'X');
    const coordThread = addChiefThread(s, { projectId: null, title: 'Coordinator' });
    const xThread = addChiefThread(s, { projectId: projectX, title: 'X' });

    const mUserZh = addChiefMessage(s, xThread, {
      role: 'user',
      origin: 'user',
      projectId: projectX,
      content: '第二条：再加2呢',
      createdAt: NOW + 100,
    });
    const mAssistantPlus = addChiefMessage(s, xThread, {
      role: 'assistant',
      projectId: projectX,
      content: [{ type: 'text', text: '1+1 等于 2。' }],
      createdAt: NOW + 200,
    });
    const mCoordinatorMixed = addChiefMessage(s, coordThread, {
      role: 'assistant',
      content: [{ type: 'text', text: '当前使用的是 Gemini 4；覆盖率 100%_覆盖，再加 4 项验证。' }],
      createdAt: NOW + 300,
    });

    const zh = await runSearch(s, '再加');
    expect(zh.messages?.map((m) => [m.id, m.projectId, m.projectName, m.role])).toEqual([
      [mCoordinatorMixed, null, null, 'assistant'],
      [mUserZh, projectX, 'X', 'user'],
    ]);

    const plus = await runSearch(s, '1+1');
    expect(plus.messages?.map((m) => m.id)).toEqual([mAssistantPlus]);
    expect(plus.messages?.[0]).toMatchObject({
      threadId: xThread,
      projectId: projectX,
      projectName: 'X',
      role: 'assistant',
    });

    const fullWidth = await runSearch(s, '１＋１');
    expect(fullWidth.messages?.map((m) => m.id)).toEqual([mAssistantPlus]);

    const wild = await runSearch(s, '100%_覆盖');
    expect(wild.messages?.map((m) => m.id)).toEqual([mCoordinatorMixed]);

    const caseMixed = await runSearch(s, 'gemini 4');
    expect(caseMixed.messages?.map((m) => m.id)).toEqual([mCoordinatorMixed]);

    const multiTerm = await runSearch(s, '再加 4');
    expect(multiTerm.messages?.map((m) => m.id)).toEqual([mCoordinatorMixed]);
  });

  test('orders hits globally newest first with tie-breaking, caps at 20, and restricts per-thread scan to 2,000 reachable rows', async () => {
    const s = bootServer();
    const projectA = await postProject(s.app, 'Alpha');
    const threadA = addChiefThread(s, {
      projectId: projectA,
      title: 'Alpha',
      updatedAt: NOW + 5000,
    });
    const threadCoord = addChiefThread(s, {
      projectId: null,
      title: 'Coordinator',
      updatedAt: NOW + 4000,
    });

    const deepId = addChiefMessage(s, threadA, {
      content: 'unreachable-deep-token beyond 2000',
      createdAt: NOW,
    });
    for (let i = 0; i < 2000; i += 1) {
      addChiefMessage(s, threadA, {
        content: i === 1 ? 'reachable-edge-token inside 2000' : `filler-${i}`,
        createdAt: NOW + 10 + i,
      });
    }
    expect((await runSearch(s, 'unreachable-deep-token')).messages ?? []).toEqual([]);
    expect((await runSearch(s, 'reachable-edge-token')).messages?.map((m) => m.id)).toHaveLength(1);
    expect(deepId).toBeTruthy();

    const sameTimeFirst = addChiefMessage(s, threadA, {
      content: 'burst-hit-tie',
      createdAt: NOW + 9000,
    });
    const sameTimeSecond = addChiefMessage(s, threadA, {
      content: 'burst-hit-tie',
      createdAt: NOW + 9000,
    });
    const tie = await runSearch(s, 'burst-hit-tie');
    expect(tie.messages?.map((m) => m.id)).toEqual([sameTimeSecond, sameTimeFirst]);

    const expectedNewest: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const target = i % 2 === 0 ? threadCoord : threadA;
      const id = addChiefMessage(s, target, {
        content: `cap-probe-${i}`,
        createdAt: NOW + 10_000 + i,
      });
      expectedNewest.push(id);
    }
    const capped = await runSearch(s, 'cap-probe-');
    expect(capped.messages).toHaveLength(20);
    expect(capped.messages?.map((m) => m.id)).toEqual(expectedNewest.slice(-20).reverse());
  });

  test('never leaks cross-team, cross-user, archived, personal-space, digest, memory, or task-message rows for the same query', async () => {
    const s = bootServer();
    const visibleProject = await postProject(s.app, 'Visible');
    const visibleThread = addChiefThread(s, { projectId: visibleProject, title: 'Visible' });
    const visibleMsg = addChiefMessage(s, visibleThread, {
      role: 'user',
      origin: 'user',
      content: 'shared-needle in visible project',
      createdAt: NOW + 500,
    });

    const archivedThread = addChiefThread(s, {
      projectId: null,
      title: 'Archived',
      archivedAt: NOW,
    });
    addChiefMessage(s, archivedThread, {
      content: 'shared-needle in archived',
      createdAt: NOW + 600,
    });

    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    const digestThread = addChiefThread(s, { id: chiefDigestThreadId(chiefId), chiefId });
    addChiefMessage(s, digestThread, {
      content: 'shared-needle in digest thread',
      createdAt: NOW + 600,
    });

    const memoryThread = addChiefThread(s, { id: chiefMemoryThreadId(chiefId), chiefId });
    addChiefMessage(s, memoryThread, {
      content: 'shared-needle in memory thread',
      createdAt: NOW + 600,
    });

    const otherUserId = 'user-other';
    s.db.insert(user).values({ id: otherUserId, displayName: 'Other', avatarUrl: null }).run();
    const otherUserThread = addChiefThread(s, { userId: otherUserId, projectId: visibleProject });
    addChiefMessage(s, otherUserThread, {
      content: 'shared-needle other user',
      createdAt: NOW + 600,
    });

    const otherTeamId = 'team-other';
    s.db
      .insert(team)
      .values({
        id: otherTeamId,
        name: 'Other Team',
        createdAt: NOW,
        plan: 'free',
        avatarStyle: 'notionist',
      })
      .run();
    const otherTeamThread = addChiefThread(s, { teamId: otherTeamId, userId: s.user.id });
    addChiefMessage(s, otherTeamThread, {
      content: 'shared-needle other team',
      createdAt: NOW + 600,
    });

    const spaceId = personalSpaceId(s.team.id, s.user.id);
    s.db
      .insert(project)
      .values({
        id: spaceId,
        name: '我的空间',
        teamId: s.team.id,
        repoKind: 'hosted',
        repoName: 'space-test',
        personalOwnerId: s.user.id,
      })
      .run();
    const spaceThread = addChiefThread(s, { projectId: spaceId, title: '我的空间' });
    addChiefMessage(s, spaceThread, {
      content: 'shared-needle in personal space',
      createdAt: NOW + 600,
    });

    s.db
      .insert(message)
      .values({
        id: 'task-msg-1',
        conversationId: 'build-1',
        role: 'assistant',
        content: 'shared-needle in task transcript',
        createdAt: NOW + 600,
      })
      .run();

    const hit = await runSearch(s, 'shared-needle');
    expect(hit.messages?.map((m) => m.id)).toEqual([visibleMsg]);
  });

  test('matches chat visibility rules: excludes toolcalls, thinking, prompt echoes, synthetic, orchestrated, API errors, and retry-parking; includes chief_notice', async () => {
    const s = bootServer();
    const thread = addChiefThread(s, { projectId: null, title: 'Coordinator' });

    const realUserEchoPrefix = addChiefMessage(s, thread, {
      id: `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}real-1`,
      role: 'user',
      origin: 'user',
      content: '[wake:schedule] vis-probe real user message\n\n<turn_state>\nsecret\n</turn_state>',
      createdAt: NOW + 100,
    });
    const realNotice = addChiefMessage(s, thread, {
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_NOTICE_KIND,
        provenance: 'task-finished:t1',
        message: 'vis-probe notice ready',
      }),
      createdAt: NOW + 200,
    });

    addChiefMessage(s, thread, {
      id: `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}echo-1`,
      role: 'user',
      origin: null,
      content: 'vis-probe prompt echo',
      createdAt: NOW + 300,
    });
    addChiefMessage(s, thread, {
      role: 'user',
      origin: 'synthetic',
      content: 'vis-probe synthetic',
      createdAt: NOW + 301,
    });
    addChiefMessage(s, thread, {
      role: 'user',
      origin: 'task-prompt',
      content: 'vis-probe task-prompt',
      createdAt: NOW + 302,
    });
    addChiefMessage(s, thread, {
      role: 'user',
      origin: 'user',
      content: 'vis-probe\n\n编排请求：[#1](todo:todo-1) —— do work',
      createdAt: NOW + 303,
    });
    addChiefMessage(s, thread, {
      role: 'assistant',
      content: { kind: 'toolcall', call: { name: 'run', args: { secret: 'vis-probe' } } },
      createdAt: NOW + 304,
    });
    addChiefMessage(s, thread, {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'vis-probe secret thought' }],
      createdAt: NOW + 305,
    });
    addChiefMessage(s, thread, {
      role: 'assistant',
      content: 'API Error: vis-probe upstream failure',
      createdAt: NOW + 306,
    });
    addChiefMessage(s, thread, {
      role: 'system',
      content: JSON.stringify({ kind: CHIEF_DIGEST_KIND, items: [{ text: 'vis-probe digest' }] }),
      createdAt: NOW + 307,
    });
    addChiefMessage(s, thread, {
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_NOTICE_KIND,
        provenance: 'retry-parking:step-1',
        message: 'vis-probe parked',
      }),
      createdAt: NOW + 308,
    });
    addChiefMessage(s, thread, {
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_NOTICE_KIND,
        provenance: 'runtime:step-1',
        message: 'vis-probe raw fallback',
        runtimeUpdate: { task: 'T', runtime: 'Claude Code', current: '1.0', required: '2.0' },
      }),
      createdAt: NOW + 309,
    });

    const hit = await runSearch(s, 'vis-probe');
    expect(hit.messages?.map((m) => m.id)).toEqual([realNotice, realUserEchoPrefix]);
    expect(hit.messages?.[1]?.snippet).toBe('vis-probe real user message');
    expect(hit.messages?.[0]?.role).toBe('assistant');
  });

  test('produces a compact single-line snippet centered on match and omits messages on syntax-filter queries', async () => {
    const s = bootServer();
    const projectX = await postProject(s.app, 'X');
    const thread = addChiefThread(s, { projectId: projectX, title: 'X' });
    addChiefMessage(s, thread, {
      role: 'assistant',
      content: `${'\uFB03'.repeat(80)}第一行前缀\n第二行关键再加词\n${'结尾填充'.repeat(40)}`,
      createdAt: NOW + 100,
    });

    const hit = await runSearch(s, '再加');
    expect(hit.messages).toHaveLength(1);
    const snippet = hit.messages?.[0]?.snippet ?? '';
    expect(snippet).toContain('再加');
    expect(snippet).not.toContain('\n');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(130);

    const filtered = await runSearch(s, 'project:X 再加');
    expect(filtered.messages).toBeUndefined();
    const isFiltered = await runSearch(s, 'is:failed 再加');
    expect(isFiltered.messages).toBeUndefined();
  });
});
