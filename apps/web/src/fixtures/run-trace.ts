import type { RunTrace, RunTraceItem, RunTurnRow } from '@cairn/shared';
import { chiefThread } from './chief.js';
import type { ChiefContent, FixtureSet } from './records.js';

const settled = chiefThread.chief as ChiefContent;
const HOUR = 3_600_000;
const base = Date.now() - HOUR;

const tool = (
  id: string,
  at: number,
  name: string,
  args: unknown,
  result: unknown,
  isError = false,
  endedAt: number | null = at + 800,
): RunTraceItem => ({
  kind: 'tool',
  id,
  at,
  name,
  arguments: args,
  result,
  isError,
  endedAt,
  truncated: false,
});

const failedItems: RunTraceItem[] = [
  { kind: 'user', id: 'user-turn-b', at: base, text: '再把 CONTRIBUTING.md 的验收部分补全' },
  {
    kind: 'thinking',
    id: 'msg-turn-b-1',
    at: base + 1_000,
    text: '先读现有的 CONTRIBUTING.md，再看验收段落缺什么。',
  },
  tool(
    'call_read',
    base + 2_000,
    'read',
    { path: 'CONTRIBUTING.md' },
    '# Contributing\n\n## 提任务\n…',
  ),
  tool('call_ls', base + 3_000, 'bash', { command: 'ls docs' }, 'acceptance.md\nreview.md'),
  tool(
    'call_grep',
    base + 4_000,
    'bash',
    { command: 'grep -n 验收 docs/*.md' },
    'docs/acceptance.md:3:## 验收',
  ),
  tool(
    'call_cat',
    base + 5_000,
    'read',
    { path: 'docs/acceptance.md' },
    '## 验收\n1. 跑测试\n2. 看截图',
  ),
  tool(
    'call_write',
    base + 6_000,
    'write',
    { path: 'CONTRIBUTING.md', content: '…' },
    'ENOSPC: no space left on device, write',
    true,
  ),
  { kind: 'error', id: 'chief-err-turn-b', at: base + 7_000, text: 'Runner error: ENOSPC' },
];

const failedTrace: RunTrace = {
  kind: 'coordinator',
  id: 'turn-b',
  title: '再把 CONTRIBUTING.md 的验收部分补全',
  threadId: 'thread-run-trace',
  todoId: null,
  status: 'failed',
  startedAt: base,
  finishedAt: base + 7_000,
  models: ['claude-sonnet-5'],
  usage: { input: 18_400, output: 1_250, cacheRead: 12_000, cacheWrite: 0 },
  previousId: 'turn-a',
  nextId: 'turn-s',
  failure: { text: 'Runner error: ENOSPC', itemId: 'call_write' },
  items: failedItems,
};

const doneTrace: RunTrace = {
  ...failedTrace,
  id: 'turn-a',
  title: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南',
  status: 'done',
  previousId: null,
  nextId: 'turn-b',
  failure: null,
  startedAt: base - HOUR,
  finishedAt: base - HOUR + 4_000,
  items: [
    {
      kind: 'user',
      id: 'user-turn-a',
      at: base - HOUR,
      text: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南',
    },
    tool(
      'call_todo',
      base - HOUR + 1_000,
      'create_todo',
      { title: '写 CONTRIBUTING.md' },
      '已创建 #11',
    ),
    {
      kind: 'reply',
      id: 'msg-turn-a-2',
      at: base - HOUR + 3_000,
      text: '已创建并派工 #11，正在编写中。',
    },
  ],
};

const stoppedTrace: RunTrace = {
  ...failedTrace,
  id: 'turn-s',
  title: '顺便检查一下 README',
  status: 'stopped',
  previousId: 'turn-b',
  nextId: null,
  failure: null,
  startedAt: base + HOUR / 2,
  finishedAt: base + HOUR / 2 + 2_000,
  items: [
    { kind: 'user', id: 'user-turn-s', at: base + HOUR / 2, text: '顺便检查一下 README' },
    tool('call_readme', base + HOUR / 2 + 500, 'read', { path: 'README.md' }, null, false, null),
    { kind: 'stopped', id: 'chief-stop-turn-s', at: base + HOUR / 2 + 2_000 },
  ],
};

const DAY = 24 * HOUR;
const LINES = ['看一下今天的任务', '把测试跑一遍', '整理 issue 列表', '更新依赖', '回顾昨天的改动'];

const olderTurns: RunTurnRow[] = Array.from({ length: 22 }, (_, n) => ({
  stepId: `turn-old-${n}`,
  at: base - DAY * (n < 4 ? 1 : 2) - n * HOUR,
  problem: n % 5 === 2 ? ('failed' as const) : n % 7 === 3 ? ('quota' as const) : null,
  firstLine: n % 6 === 4 ? '' : (LINES[n % LINES.length] ?? ''),
  woke: n % 6 === 4,
  toolCount: (n * 3) % 9,
  durationMs: 4_000 + n * 500,
}));

const runTurns: RunTurnRow[] = [
  {
    stepId: 'turn-s',
    at: stoppedTrace.startedAt,
    problem: 'stopped',
    firstLine: stoppedTrace.title,
    woke: false,
    toolCount: 0,
    durationMs: 2_000,
  },
  {
    stepId: 'turn-b',
    at: failedTrace.startedAt,
    problem: 'failed',
    firstLine: failedTrace.title,
    woke: false,
    toolCount: 5,
    durationMs: 7_000,
  },
  {
    stepId: 'turn-a',
    at: doneTrace.startedAt,
    problem: null,
    firstLine: doneTrace.title,
    woke: false,
    toolCount: 1,
    durationMs: 4_000,
  },
  ...olderTurns,
];

export const RUN_TRACE_SCENARIOS: Record<string, FixtureSet> = {
  'run-trace': {
    ...chiefThread,
    chief: {
      ...settled,
      threadId: 'thread-run-trace',
      stream: [
        ...(settled.stream ?? []),
        { kind: 'user', text: '再把 CONTRIBUTING.md 的验收部分补全', id: 'user-turn-b' },
        { kind: 'error', text: 'Runner error: ENOSPC', id: 'chief-err-turn-b' },
        { kind: 'user', text: '顺便检查一下 README', id: 'user-turn-s' },
        { kind: 'stopped', todos: [], id: 'chief-stop-turn-s' },
      ],
    },
    runTurns,
    runTraces: { 'turn-a': doneTrace, 'turn-b': failedTrace, 'turn-s': stoppedTrace },
  },
};
