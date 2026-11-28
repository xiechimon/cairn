import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChief, mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_795_863_240_000;

function text(id: string, body: string, at: number): MessageRow {
  return { id, role: 'assistant', content: [{ type: 'text', text: body }], createdAt: at };
}

function call(id: string, name: string, at: number, args: unknown = {}): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: { id: `c-${id}`, name, arguments: args, startedAt: at, endedAt: at + 10 },
    },
    createdAt: at,
  };
}

const NARRATION_ONE = 'Before greeting, I need to call suggest_replies as the instructions require.';
const NARRATION_TWO = 'I need to load suggest_replies first.';
const GREETING = 'xmon 你好，欢迎来到项目「测试」的新频道。你想在这个项目里做什么？';

const GREETING_ECHO =
  '【输入框选定项目：测试（id: p-1）】\n【新频道】用户刚打开项目「测试」的新频道，还没有说话。写问候之前必须先调用 suggest_replies…不要建任务。';

const THREAD: ChiefThread = {
  id: 'chief-channel',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  projectId: 'p-1',
  title: '测试',
  createdAt: 1,
  updatedAt: 1,
  lastTurnAt: NOW + 9,
  session: { runtime: 'pi', id: 's1', openedAt: 1 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    lastTurnAt: null,
    createdAt: 0,
    tz: null,
    model: null,
  },
  agentActor: null,
  context: null,
  watches: [],
  wakes: [],
} as unknown as ChiefGetResponse;

function openingRows(echo: boolean): MessageRow[] {
  const rows: MessageRow[] = [
    ...(echo
      ? [
          {
            id: 'user-YmNEfHs5G8_0Wg-Ue2aMA',
            role: 'user' as const,
            content: GREETING_ECHO,
            origin: 'task-prompt' as const,
            createdAt: NOW,
            projectId: 'p-1',
          },
        ]
      : []),
    text('t-1', NARRATION_ONE, NOW + 1),
    call('t-2', 'suggest_replies', NOW + 2),
    text('t-3', NARRATION_TWO, NOW + 3),
    call('t-4', 'tool_search', NOW + 4, { query: 'suggest_replies' }),
    call('t-5', 'suggest_replies', NOW + 5, { replies: ['接着看看项目里最近的活'] }),
    {
      id: 'quick-replies-step',
      role: 'system',
      content: JSON.stringify({
        kind: 'quick_replies',
        stepId: 'step',
        replies: ['接着看看项目里最近的活', '给这个项目做个计划', '列出这个项目的待办'],
      }),
      createdAt: NOW + 6,
      projectId: 'p-1',
    },
    text('t-6', GREETING, NOW + 7),
  ];
  return rows;
}

function robots(items: readonly ChiefStreamItem[]) {
  return items.filter(
    (item): item is Extract<ChiefStreamItem, { kind: 'robot' }> => item.kind === 'robot',
  );
}

function channelStream(rows: MessageRow[], opts: { hasEarlier?: boolean } = {}) {
  return mapChief(ENV, {
    threads: [THREAD],
    activeThreadId: THREAD.id,
    messages: rows,
    ...opts,
  }).stream;
}

describe('a channel greeting shows one reply, not the model’s pre-tool narration', () => {
  test('the reported greeting turn renders one bubble, the greeting', () => {
    const stream = channelStream(openingRows(false));
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual([GREETING]);
  });

  test('the greeting prompt echo does not change that', () => {
    const stream = channelStream(openingRows(true));
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual([GREETING]);
  });

  test('chips asked for after the greeting keep the greeting as the one bubble', () => {
    const stream = channelStream([
      text('g-1', GREETING, NOW),
      call('g-2', 'suggest_replies', NOW + 1),
      {
        id: 'quick-replies-after',
        role: 'system',
        content: JSON.stringify({ kind: 'quick_replies', stepId: 's', replies: ['做个计划'] }),
        createdAt: NOW + 2,
      },
    ]);
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual([GREETING]);
  });

  test('a greeting written after an earlier failed attempt is still the one bubble', () => {
    const error = (id: string, at: number): MessageRow => ({
      id,
      role: 'system',
      content: JSON.stringify({
        kind: 'chief_turn_error',
        message: 'Connection error: EHOSTUNREACH',
      }),
      createdAt: at,
    });
    const stream = channelStream([
      error('e-1', NOW),
      error('e-2', NOW + 1),
      text('g-1', GREETING, NOW + 2),
    ]);
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual([GREETING]);
  });

  test('an older page of the same channel keeps every reply', () => {
    const stream = channelStream(
      [
        text('p-1', '第一段。', NOW),
        call('p-2', 'docs', NOW + 1),
        text('p-3', '第二段。', NOW + 2),
      ],
      { hasEarlier: true },
    );
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual(['第一段。', '第二段。']);
  });

  test('after the owner speaks, a later turn keeps its own narration', () => {
    const stream = channelStream([
      text('g-1', GREETING, NOW),
      { id: 'u-1', role: 'user', content: '看下仓库', createdAt: NOW + 1 },
      text('n-1', '我先看看仓库结构。', NOW + 2),
      call('n-2', 'docs', NOW + 3),
      text('n-3', '仓库有三个应用。', NOW + 4),
    ]);
    expect(robots(stream ?? []).map((item) => item.markdown)).toEqual([
      GREETING,
      '我先看看仓库结构。',
      '仓库有三个应用。',
    ]);
  });

  test('mapChiefStream without a channel treats every text row as a reply', () => {
    const items = mapChiefStream([text('x-1', NARRATION_ONE, NOW), text('x-2', GREETING, NOW + 1)]);
    expect(robots(items).map((item) => item.markdown)).toEqual([NARRATION_ONE, GREETING]);
  });
});
