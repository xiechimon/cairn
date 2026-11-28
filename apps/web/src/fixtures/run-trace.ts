import type { RunListRow, RunTrace, RunTraceItem } from '@cairn/shared';
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
  failure: { text: 'Runner error: ENOSPC', itemId: 'call_write' },
  items: failedItems,
};

const doneTrace: RunTrace = {
  ...failedTrace,
  id: 'turn-a',
  title: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南',
  status: 'done',
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
  failure: null,
  startedAt: base + HOUR / 2,
  finishedAt: base + HOUR / 2 + 2_000,
  items: [
    { kind: 'user', id: 'user-turn-s', at: base + HOUR / 2, text: '顺便检查一下 README' },
    tool('call_readme', base + HOUR / 2 + 500, 'read', { path: 'README.md' }, null, false, null),
    { kind: 'stopped', id: 'chief-stop-turn-s', at: base + HOUR / 2 + 2_000 },
  ],
};

const taskTrace: RunTrace = {
  kind: 'task',
  id: 'build-r',
  title: '#12 修复设置页 390 宽度下的横向滚动',
  threadId: null,
  todoId: 'todo-r',
  status: 'done',
  startedAt: base - HOUR / 2,
  finishedAt: base - HOUR / 2 + 660_000,
  models: ['claude-sonnet-5'],
  usage: { input: 52_000, output: 4_100, cacheRead: 30_000, cacheWrite: 0 },
  failure: null,
  items: [
    { kind: 'step', id: 'step-build-r', at: base - HOUR / 2, stepKind: 'build', status: 'done' },
    {
      kind: 'prompt',
      id: 'user-build-r',
      at: base - HOUR / 2 + 100,
      text: '修复设置页 390 宽度下的横向滚动',
    },
    tool(
      'call_r1',
      base - HOUR / 2 + 1_000,
      'bash',
      { command: 'rg -n overflow-x apps/web/src/settings' },
      'settings-list.tsx:41',
    ),
    {
      kind: 'reply',
      id: 'msg-build-r-1',
      at: base - HOUR / 2 + 660_000,
      text: '去掉了设置列表的固定最小宽度，390 下不再横向滚动。',
    },
  ],
};

const DAY = 24 * HOUR;
const LINES = ['看一下今天的任务', '把测试跑一遍', '整理 issue 列表', '更新依赖', '回顾昨天的改动'];
const THREAD = 'thread-run-trace';

const turn = (row: Partial<RunListRow> & Pick<RunListRow, 'id' | 'at'>): RunListRow => ({
  kind: 'coordinator',
  threadId: THREAD,
  status: 'done',
  firstLine: '',
  woke: false,
  source: null,
  toolCount: 0,
  durationMs: 4_000,
  ...row,
});

const olderTurns: RunListRow[] = Array.from({ length: 22 }, (_, n) =>
  turn({
    id: `turn-old-${n}`,
    at: base - DAY * (n < 4 ? 1 : 2) - n * HOUR,
    status: n % 5 === 2 ? 'failed' : n % 7 === 3 ? 'quota' : 'done',
    firstLine: n % 6 === 4 ? '' : (LINES[n % LINES.length] ?? ''),
    woke: n % 6 === 4,
    toolCount: (n * 3) % 9,
    durationMs: 4_000 + n * 500,
  }),
);

const runs: RunListRow[] = [
  turn({
    id: 'turn-s',
    at: stoppedTrace.startedAt,
    status: 'stopped',
    firstLine: stoppedTrace.title,
    durationMs: 2_000,
  }),
  turn({
    id: 'turn-b',
    at: failedTrace.startedAt,
    status: 'failed',
    firstLine: failedTrace.title,
    toolCount: 5,
    durationMs: 7_000,
  }),
  turn({
    id: 'turn-channel',
    threadId: 'thread-channel',
    at: failedTrace.startedAt - HOUR / 3,
    firstLine: '这个项目的发布说明写到哪了',
    source: 'r3-lifecycle',
    toolCount: 2,
    durationMs: 48_000,
  }),
  {
    id: 'build-r',
    kind: 'task',
    threadId: null,
    at: taskTrace.startedAt,
    status: 'done',
    firstLine: '修复设置页 390 宽度下的横向滚动',
    woke: false,
    source: 'r3-lifecycle',
    toolCount: 1,
    durationMs: 660_000,
  },
  turn({
    id: 'turn-a',
    at: doneTrace.startedAt,
    firstLine: doneTrace.title,
    toolCount: 1,
  }),
  ...olderTurns,
];

export const RUN_TRACE_SCENARIOS: Record<string, FixtureSet> = {
  'run-trace': {
    ...chiefThread,
    chief: {
      ...settled,
      threadId: THREAD,
      stream: [
        ...(settled.stream ?? []),
        { kind: 'user', text: '再把 CONTRIBUTING.md 的验收部分补全', id: 'user-turn-b' },
        { kind: 'error', text: 'Runner error: ENOSPC', id: 'chief-err-turn-b' },
        { kind: 'user', text: '顺便检查一下 README', id: 'user-turn-s' },
        { kind: 'stopped', todos: [], id: 'chief-stop-turn-s' },
      ],
    },
    runs,
    runTraces: {
      'turn-a': doneTrace,
      'turn-b': failedTrace,
      'turn-s': stoppedTrace,
      'build-r': taskTrace,
    },
  },
  'run-trace-empty': {
    ...chiefThread,
    chief: { ...settled, threadId: THREAD, stream: settled.stream ?? [] },
    runs: [],
    runTraces: {},
  },
};
