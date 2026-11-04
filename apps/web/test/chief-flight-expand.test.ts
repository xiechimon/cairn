import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChief, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

function row(id: string, role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  return { id, role, content, createdAt: at };
}

function toolMsg(id: string, name: string, at = NOW, args: Record<string, unknown> = {}) {
  return row(id, 'assistant', {
    kind: 'toolcall',
    call: { id: `c-${id}`, name, arguments: args, startedAt: at, endedAt: at + 2000 },
  });
}

function thread(activeRun: ChiefThread['activeRun']): ChiefThread {
  return {
    id: 'chief-bbb',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程乙',
    createdAt: 2,
    updatedAt: 2,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's2', openedAt: 2 },
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

const USER = row('AbCdEfGhIjKlMnOpQrStU', 'user', '派一下凭证链路验证', NOW);

function streamingOf(opts: {
  activeRun: ChiefThread['activeRun'];
  messages: MessageRow[];
  liveText?: string;
}) {
  const chief = mapChief(
    ENV,
    { threads: [thread(opts.activeRun)], activeThreadId: 'chief-bbb', messages: opts.messages, liveText: opts.liveText },
  );
  expect(chief.running ?? false).toBe(opts.activeRun != null);
  return {
    chief,
    streaming: (chief.stream ?? []).filter(
      (i): i is Extract<ChiefStreamItem, { kind: 'streaming' }> => i.kind === 'streaming',
    ),
  };
}

describe('mapChief in-flight expand-face projection (#822 F-E1..E6)', () => {
  test('F-E1 activeRun with a tool slot → runningTool = that tool name', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief', tool: { toolName: 'machines' } },
      messages: [USER],
    });
    expect(streaming).toHaveLength(1);
    expect(chief.runningTool).toBe('machines');
  });

  test('F-E2 activeRun without a tool slot → runningTool defaults (panel walks the fallback row)', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [USER],
    });
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.tools ?? []).toHaveLength(0);
    expect(chief.runningTool).toBeUndefined();
  });

  test('F-E3 this-turn tool rows (after the user row) → streaming.tools', () => {
    const { streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [USER, toolMsg('m5', 'todo_write')],
    });
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.tools?.map((t) => t.label)).toEqual(['todo_write']);
    expect(streaming[0]?.tools?.[0]?.seconds).toBe(2);
  });

  test('F-E7 tool row text carries the command (pillOf projection), not a bare tool name', () => {
    const { streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [
        USER,
        toolMsg('m7', 'Bash', NOW, { command: 'ls -la', description: '列目录' }),
        toolMsg('m8', 'Edit', NOW, { file_path: 'README.md' }),
        toolMsg('m9', 'todo_write'),
      ],
    });
    expect(streaming[0]?.tools?.map((t) => t.label)).toEqual([
      'Bash ls -la',
      'Edit README.md',
      'todo_write',
    ]);
  });

  test('F-E4 last-turn tool rows (before the user row) → belong to the last robot row, not into streaming.tools', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [
        toolMsg('m0', 'todo_write', NOW - 9000),
        row('msg-r0', 'assistant', '上轮完成', NOW - 8000),
        USER,
      ],
    });
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.tools ?? []).toHaveLength(0);
    const robots = (chief.stream ?? []).filter((i) => i.kind === 'robot');
    expect(robots[0]?.tools?.map((t) => t.label)).toEqual(['todo_write']);
  });

  test('F-E5 idle (activeRun null) → no streaming row, no runningTool', () => {
    const { chief, streaming } = streamingOf({ activeRun: null, messages: [USER] });
    expect(streaming).toHaveLength(0);
    expect(chief.running).toBeUndefined();
    expect(chief.runningTool).toBeUndefined();
  });

  test('F-E6 typing window (liveText non-empty) → typing row, no streaming row', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief', tool: { toolName: 'machines' } },
      messages: [USER],
      liveText: '正在验证',
    });
    expect(streaming).toHaveLength(0);
    const last = chief.stream?.[chief.stream.length - 1];
    expect(last).toMatchObject({ kind: 'robot', typing: true });

    expect(chief.runningTool).toBe('machines');
  });
});
