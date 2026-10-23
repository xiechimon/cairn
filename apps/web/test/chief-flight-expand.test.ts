// #822 在飞存在行展开面：mapChief 把已有 wire 数据投影进视图模型——
// activeRun.tool.toolName → runningTool，本轮尚未归属的工具行 → streaming
// 行的 tools。不新增任何 wire 面（数据源 = 本就拉取的 threads + messages）。
// 失败方式先行枚举：
//   F-E1 activeRun 带 tool 位 → runningTool = 该工具名（展开面首行）
//   F-E2 activeRun 无 tool 位（{phase:'chief'}）→ runningTool 缺省（面板走 fallback）
//   F-E3 本轮工具行（user 行之后的 toolcall）→ streaming.tools（展开面工具表）
//   F-E4 上轮工具行（user 行之前）→ 归属上轮 robot 行，不进 streaming.tools（回合边界）
//   F-E5 空闲（activeRun null）→ 无 streaming 行、无 runningTool（现状锁）
//   F-E6 打字窗口（liveText 非空）→ typing 行，无 streaming 行（#651/#739 F1 互斥锁）
//   F-E7 工具行文本 = pillOf 投影（`bash <命令>` 族），不是裸工具名——一排
//        「Bash」读不出跑了什么；裸名只在无 command/file_path/path 时出现

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

describe('mapChief 在飞展开面投影（#822 F-E1..E6）', () => {
  test('F-E1 activeRun 带 tool 位 → runningTool = 该工具名', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief', tool: { toolName: 'machines' } },
      messages: [USER],
    });
    expect(streaming).toHaveLength(1);
    expect(chief.runningTool).toBe('machines');
  });

  test('F-E2 activeRun 无 tool 位 → runningTool 缺省（面板走 fallback 行）', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [USER],
    });
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.tools ?? []).toHaveLength(0);
    expect(chief.runningTool).toBeUndefined();
  });

  test('F-E3 本轮工具行（user 行之后）→ streaming.tools', () => {
    const { streaming } = streamingOf({
      activeRun: { phase: 'chief' },
      messages: [USER, toolMsg('m5', 'todo_write')],
    });
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.tools?.map((t) => t.label)).toEqual(['todo_write']);
    expect(streaming[0]?.tools?.[0]?.seconds).toBe(2);
  });

  test('F-E7 工具行文本带命令（pillOf 投影），不是裸工具名', () => {
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

  test('F-E4 上轮工具行（user 行之前）→ 归属上轮 robot 行，不进 streaming.tools', () => {
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

  test('F-E5 空闲（activeRun null）→ 无 streaming 行、无 runningTool', () => {
    const { chief, streaming } = streamingOf({ activeRun: null, messages: [USER] });
    expect(streaming).toHaveLength(0);
    expect(chief.running).toBeUndefined();
    expect(chief.runningTool).toBeUndefined();
  });

  test('F-E6 打字窗口（liveText 非空）→ typing 行，无 streaming 行', () => {
    const { chief, streaming } = streamingOf({
      activeRun: { phase: 'chief', tool: { toolName: 'machines' } },
      messages: [USER],
      liveText: '正在验证',
    });
    expect(streaming).toHaveLength(0);
    const last = chief.stream?.[chief.stream.length - 1];
    expect(last).toMatchObject({ kind: 'robot', typing: true });
    // 打字行不带展开面——runningTool 仍可投影（typing 接管后 streaming 缺席，
    // 面板无处挂载，F-R16 e2e 钉收敛）。
    expect(chief.runningTool).toBe('machines');
  });
});
