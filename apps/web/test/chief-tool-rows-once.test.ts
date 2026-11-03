import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChief, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_793_630_000_000;

function row(id: string, role: MessageRow['role'], content: unknown, at: number): MessageRow {
  return { id, role, content, createdAt: at };
}

function toolMsg(id: string, name: string, at: number, done = true): MessageRow {
  return row(id, 'assistant', {
    kind: 'toolcall',
    call: {
      id: `c-${id}`,
      name,
      arguments: {},
      startedAt: at,
      ...(done ? { endedAt: at + 1000, result: '{}' } : {}),
    },
  }, at);
}

function thread(activeRun: ChiefThread['activeRun']): ChiefThread {
  return {
    id: 'chief-ttt',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: 'Coordinator',
    createdAt: 1,
    updatedAt: 1,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's1', openedAt: 1 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun,
  };
}

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    charter: null,
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

const ANSWERED_TURN: MessageRow[] = [
  row('u-q', 'user', '？', NOW),
  toolMsg('t-1', 'mcp__cairn__pull_requests', NOW + 1),
  toolMsg('t-2', 'mcp__cairn__issues', NOW + 2),
  toolMsg('t-3', 'mcp__cairn__run_builds', NOW + 3),
  row('a-1', 'assistant', [{ type: 'text', text: '已派发 #104。' }], NOW + 4),
];

function streamOf(activeRun: ChiefThread['activeRun'], messages: MessageRow[]) {
  return (
    mapChief(ENV, {
      threads: [thread(activeRun)],
      activeThreadId: 'chief-ttt',
      messages,
    }).stream ?? []
  );
}

function toolMentions(stream: ChiefStreamItem[]): number {
  return stream.reduce((n, item) => {
    if (item.kind === 'robot' || item.kind === 'streaming') return n + (item.tools?.length ?? 0);
    return n;
  }, 0);
}

describe('each Coordinator tool call renders once', () => {
  test('an answered turn keeps its tools in the reply group while a later turn runs', () => {
    const stream = streamOf({ phase: 'chief' }, [
      ...ANSWERED_TURN,
      row('u-stop', 'user', '停止', NOW + 10),
    ]);
    const reply = stream.find((item) => item.kind === 'robot' && item.id === 'a-1');
    expect(reply?.kind === 'robot' ? reply.tools?.length : 0).toBe(3);
    expect(toolMentions(stream)).toBe(3);
  });

  test('the reply header comes before its tools, not after loose tool rows', () => {
    const stream = streamOf({ phase: 'chief' }, ANSWERED_TURN);
    const kinds = stream.map((item) => item.kind);
    expect(kinds.indexOf('robot')).toBe(kinds.indexOf('user') + 1);
  });

  test('the running turn shows its unanswered tools once, inside the live row', () => {
    const stream = streamOf({ phase: 'chief' }, [
      ...ANSWERED_TURN,
      row('u-next', 'user', '再看看', NOW + 10),
      toolMsg('t-4', 'mcp__cairn__todos', NOW + 11),
      toolMsg('t-5', 'mcp__cairn__machines', NOW + 12, false),
    ]);
    const live = stream.at(-1);
    expect(live?.kind).toBe('streaming');
    expect(live?.kind === 'streaming' ? live.tools?.length : 0).toBe(2);
    expect(toolMentions(stream)).toBe(5);
  });

  test('a call made after a sealed text segment still shows in the live row', () => {
    const stream = streamOf({ phase: 'chief' }, [
      row('u-next', 'user', '再看看', NOW),
      row('a-seg', 'assistant', [{ type: 'text', text: '先看现状' }], NOW + 1),
      toolMsg('t-4', 'mcp__cairn__todos', NOW + 2, false),
    ]);
    const live = stream.at(-1);
    expect(live?.kind).toBe('streaming');
    expect(live?.kind === 'streaming' ? live.tools : []).toEqual([
      { label: 'mcp__cairn__todos', running: true },
    ]);
  });

  test('a reply that starts streaming takes the turn tools under its header', () => {
    const stream =
      mapChief(ENV, {
        threads: [thread({ phase: 'chief' })],
        activeThreadId: 'chief-ttt',
        messages: [row('u-next', 'user', '再看看', NOW), toolMsg('t-4', 'mcp__cairn__todos', NOW + 1)],
        liveText: '我看了一下',
      }).stream ?? [];
    const typing = stream.at(-1);
    expect(typing).toMatchObject({ kind: 'robot', typing: true });
    expect(typing?.kind === 'robot' ? typing.tools?.length : 0).toBe(1);
    expect(toolMentions(stream)).toBe(1);
  });

  test('tools called before a question fold into the reply after it', () => {
    const stream = streamOf(null, [
      row('u-q', 'user', '派一下', NOW),
      toolMsg('t-1', 'mcp__cairn__todos', NOW + 1),
      row(
        'q-1',
        'assistant',
        JSON.stringify({
          kind: 'ask_user_question',
          requestId: 'r1',
          status: 'answered',
          questions: [{ header: '项目', question: '哪个项目？', options: [{ label: 'cairn' }] }],
          answers: [{ header: '项目', choices: ['cairn'] }],
        }),
        NOW + 2,
      ),
      row('a-1', 'assistant', '好，派到 cairn。', NOW + 3),
    ]);
    expect(stream.map((item) => item.kind)).toEqual(['user', 'question', 'robot']);
    const reply = stream.find((item) => item.kind === 'robot' && item.id === 'a-1');
    expect(reply?.kind === 'robot' ? reply.tools?.length : 0).toBe(1);
  });

  test('an idle thread renders the same rows as a running one for answered turns', () => {
    const idle = streamOf(null, ANSWERED_TURN);
    expect(toolMentions(idle)).toBe(3);
  });
});
