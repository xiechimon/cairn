import { type ChiefGetResponse, type ChiefThread, SUBAGENT_TOOL_NAME } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChief, mapChiefStream } from '../src/api/mappers.js';
import { CHIEF_ROW_CLASS, chiefRowRenders } from '../src/chief/chief-row-kinds.js';
import { statusMarkView } from '../src/chief/status-mark.js';

const NOW = 1_758_000_000_000;

function subagentRow(
  id: string,
  args: Record<string, unknown>,
  finished?: { payload: Record<string, unknown>; endedAt?: number; isError?: boolean },
  name: string = SUBAGENT_TOOL_NAME,
): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name,
        arguments: args,
        startedAt: NOW,
        ...(finished !== undefined
          ? {
              ...(finished.endedAt !== undefined ? { endedAt: finished.endedAt } : {}),
              result: [{ type: 'text', text: JSON.stringify(finished.payload) }],
              ...(finished.isError !== undefined ? { isError: finished.isError } : {}),
            }
          : {}),
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

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

function thread(activeRun: ChiefThread['activeRun']): ChiefThread {
  return {
    id: 'chief-sub',
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

describe('path 13: Coordinator subagent silent chat stream contract (Option A)', () => {
  test('CHIEF_ROW_CLASS adds no subagent row kind and status mark keeps think while running', () => {
    expect('subagent' in CHIEF_ROW_CLASS).toBe(false);
    expect(chiefRowRenders('subagent')).toBe(false);
    const chief = mapChief(ENV, {
      threads: [thread({ phase: 'chief', tool: { toolName: SUBAGENT_TOOL_NAME } })],
      activeThreadId: 'chief-sub',
      messages: [
        { id: 'u1', role: 'user', content: 'Compare 2 tasks', createdAt: NOW } as MessageRow,
        subagentRow('m1', { task: 'Inspect #11', label: '检查 #11' }),
        subagentRow('m2', { task: 'Inspect #12', label: '检查 #12' }),
      ],
    });
    expect(chief.stream?.map((item) => item.kind)).toEqual(['user', 'streaming']);
    const mark = statusMarkView({ chief, questionPending: false, connected: true });
    expect(mark.id).toBe('think');
    expect(mark.label).toBe('正在思考');
  });

  test('parallel and timed_out subagents leave only user and reply in the chat stream', () => {
    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Check 2 tasks', createdAt: NOW } as MessageRow,
      subagentRow(
        'm1',
        { task: 'Check #1', label: '检查 #1' },
        {
          endedAt: NOW + 6_000,
          payload: {
            status: 'completed',
            summary: 'Task #1 failed on lint.',
            childId: 'c1',
            runtime: 'pi',
            model: 'stub/m',
            toolCalls: 2,
            durationMs: 6_000,
            usage: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      ),
      subagentRow(
        'm2',
        { task: 'Check #2', label: '检查 #2' },
        {
          endedAt: NOW + 120_000,
          payload: {
            status: 'timed_out',
            partial: true,
            summary: 'Partial log from #2.',
            childId: 'c2',
            runtime: 'pi',
            model: 'stub/m',
            toolCalls: 3,
            durationMs: 120_000,
            usage: { inputTokens: 300, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      ),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Task #1 failed lint; #2 timed out partway.' }],
        createdAt: NOW + 121_000,
      } as MessageRow,
    ]);

    expect(stream.map((entry) => entry.kind)).toEqual(['user', 'robot']);
    const reply = stream[1];
    expect(reply?.kind === 'robot' ? reply.tools?.length : 0).toBe(2);
  });

  test('stopped turn after an aborted subagent shows only the user row and stopped row', () => {
    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Stop it', createdAt: NOW } as MessageRow,
      {
        id: 'm-abort',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: {
            id: 'c-abort',
            name: SUBAGENT_TOOL_NAME,
            arguments: { task: 'Long check', label: '长检查' },
            startedAt: NOW,
            endedAt: NOW + 400,
            isError: true,
            result: [{ type: 'text', text: 'Tool execution aborted' }],
          },
        },
        createdAt: NOW,
      } as MessageRow,
      {
        id: 's1',
        role: 'system',
        content: JSON.stringify({ kind: 'chief_turn_stopped', todos: [] }),
        createdAt: NOW + 500,
      } as MessageRow,
    ]);
    expect(stream.map((entry) => entry.kind)).toEqual(['user', 'stopped']);
  });

  test('daemon mcp__cairn__subagent tool calls stay silent in the chat stream', () => {
    const stream = mapChiefStream([
      { id: 'u1', role: 'user', content: 'Check package', createdAt: NOW } as MessageRow,
      subagentRow(
        'm-daemon',
        { task: 'Read package.json', label: '读 package.json' },
        {
          endedAt: NOW + 1_800,
          payload: {
            status: 'completed',
            summary: 'name is cairn.',
            childId: 'claude-child-1',
            runtime: 'claude-code',
            model: 'claude-code/claude-sonnet-4-6',
            toolCalls: 1,
            durationMs: 1_800,
            usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
        'mcp__cairn__subagent',
      ),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: '已确认包名是 cairn。' }],
        createdAt: NOW + 2_000,
      } as MessageRow,
    ]);
    expect(stream.map((entry) => entry.kind)).toEqual(['user', 'robot']);
  });
});
