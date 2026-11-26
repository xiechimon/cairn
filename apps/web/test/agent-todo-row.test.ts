import type { AgentTodo, AgentTodoItem, BuildRecord, StepJournalRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type MessageRow, mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord, TranscriptItem } from '../src/fixtures/records.js';
import { NOW, todo } from './helpers.js';

const BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function runningStep(id: string): StepJournalRow {
  return {
    id,
    buildId: BUILD.id,
    kind: 'build',
    machineId: null,
    createdAt: NOW - 30_000,
    status: 'claimed',
    checkpointCommit: null,
    skillInjection: null,
  };
}

function todoUpdate(stepId: string, items: { text: string; state: 'todo' | 'doing' | 'done' }[]) {
  return { stepId, at: NOW - 1_000, items } as AgentTodo;
}

function render(overrides: {
  messages?: MessageRow[];
  steps?: StepJournalRow[];
  agentTodo?: AgentTodo | null;
  pageTodo?: AgentTodoItem[] | null;
  build?: BuildRecord | null;
  liveText?: string;
  phase?: TodoRecord['phase'];
}): TranscriptItem[] {
  return mapTranscript({
    messages: overrides.messages ?? [],
    steps: overrides.steps ?? [],
    build: overrides.build === undefined ? BUILD : overrides.build,
    todo: todo(9, overrides.phase ?? 'building') as TodoRecord,
    machineName: null,
    userName: 'Xmon Dai',
    liveText: overrides.liveText ?? '',
    ...(overrides.agentTodo !== undefined ? { agentTodo: overrides.agentTodo } : {}),
    ...(overrides.pageTodo !== undefined ? { pageTodo: overrides.pageTodo } : {}),
  });
}

function todoItems(items: TranscriptItem[]) {
  return items
    .filter((i): i is Extract<TranscriptItem, { kind: 'agent-todo' }> => i.kind === 'agent-todo')
    .map(({ kind, items: todo }) => ({ kind, items: todo }));
}

describe('mapTranscript agent todo list (#1524)', () => {
  test('running todo list → agent-todo row, before the streaming row', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s1', [
        { text: '通读 poteto 的推文观点', state: 'todo' },
        { text: '开票沉淀注释规则', state: 'doing' },
        { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
      ]),
    });
    const rows = todoItems(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.items).toEqual([
      { text: '通读 poteto 的推文观点', state: 'todo' },
      { text: '开票沉淀注释规则', state: 'doing' },
      { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
    ]);
    const cardIndex = items.findIndex((i) => i.kind === 'agent-todo');
    const streamingIndex = items.findIndex((i) => i.kind === 'streaming');
    expect(streamingIndex).toBeGreaterThan(cardIndex);
  });

  test('stepId mismatch (stale step list) → no row produced', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s-old', [{ text: '旧清单', state: 'todo' }]),
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('not running → no row (the list only appears at the live tail)', () => {
    const items = render({
      steps: [{ ...runningStep('s1'), status: 'done' }],
      agentTodo: todoUpdate('s1', [{ text: '收尾清单', state: 'done' }]),
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('no signal (old server / fixture capture) → no row, zero noise', () => {
    expect(todoItems(render({ steps: [runningStep('s1')], agentTodo: null }))).toHaveLength(0);
    expect(todoItems(render({ steps: [runningStep('s1')] }))).toHaveLength(0);
  });

  test('empty list produces no row', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s1', []),
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('persisted TodoWrite keeps unfinished items after step settles and stays hidden from WorkTrace', () => {
    const todoWrite: MessageRow = {
      id: 'm-todo',
      role: 'assistant',
      createdAt: NOW - 10_000,
      content: {
        kind: 'toolcall',
        call: {
          id: 'c-todo',
          name: 'TodoWrite',
          arguments: {
            todos: [
              { content: '读配置', status: 'completed', activeForm: '正在读配置' },
              { content: '改接口', status: 'in_progress', activeForm: '正在改接口' },
              { content: '补测试', status: 'pending', activeForm: '等待补测试' },
            ],
          },
          result: 'ok',
        },
      },
    };
    const items = render({
      messages: [todoWrite],
      steps: [{ ...runningStep('s1'), status: 'done' }],
    });
    expect(items.some((item) => item.kind === 'work')).toBe(false);
    expect(todoItems(items)).toEqual([
      {
        kind: 'agent-todo',
        items: [
          { text: '读配置', state: 'done' },
          { text: '改接口', state: 'todo' },
          { text: '补测试', state: 'todo' },
        ],
      },
    ]);
  });

  test('a finished task hides its unfinished checklist; a stopped or failed one keeps it', () => {
    const checklist: MessageRow = {
      id: 'm-plan',
      role: 'assistant',
      createdAt: NOW - 10_000,
      content: '- [x] 读配置\n- [ ] 改接口',
    };
    const settled = [{ ...runningStep('s1'), status: 'done' as const }];
    for (const phase of ['done', 'review'] as const)
      expect(todoItems(render({ messages: [checklist], steps: settled, phase }))).toEqual([]);
    for (const phase of ['failed', 'needs_input'] as const)
      expect(todoItems(render({ messages: [checklist], steps: settled, phase }))).toHaveLength(1);
  });

  test('persisted TodoWrite hides once all items are done after the step settles', () => {
    const todoWrite: MessageRow = {
      id: 'm-todo-done',
      role: 'assistant',
      createdAt: NOW - 10_000,
      content: {
        kind: 'toolcall',
        call: {
          id: 'c-todo-done',
          name: 'TodoWrite',
          arguments: {
            todos: [
              { content: '读配置', status: 'completed', activeForm: '正在读配置' },
              { content: '改接口', status: 'completed', activeForm: '正在改接口' },
            ],
          },
          result: 'ok',
        },
      },
    };
    const items = render({
      messages: [todoWrite],
      steps: [{ ...runningStep('s1'), status: 'done' }],
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('reload mid-step: an empty live store and no loaded snapshot fall back to the page todo', () => {
    const page: AgentTodoItem[] = [
      { text: '读配置', state: 'done' },
      { text: '改接口', state: 'doing' },
    ];
    expect(todoItems(render({ steps: [runningStep('s1')], pageTodo: page }))).toEqual([
      { kind: 'agent-todo', items: page },
    ]);
    expect(
      todoItems(render({ steps: [{ ...runningStep('s1'), status: 'done' }], pageTodo: page })),
    ).toEqual([
      {
        kind: 'agent-todo',
        items: [
          { text: '读配置', state: 'done' },
          { text: '改接口', state: 'todo' },
        ],
      },
    ]);
  });

  test('a snapshot in the loaded rows is newer than the page todo, and plan rows stay out of the trace', () => {
    const plan: MessageRow = {
      id: 'm-plan',
      role: 'assistant',
      createdAt: NOW - 5_000,
      content: {
        kind: 'toolcall',
        call: {
          id: 'plan-1',
          name: 'plan',
          arguments: {},
          result: '',
          isError: false,
          todo: [{ text: '跑测试', state: 'doing' }],
        },
      },
    };
    const items = render({
      messages: [plan],
      steps: [runningStep('s1')],
      pageTodo: [{ text: '旧计划', state: 'todo' }],
    });
    expect(items.some((item) => item.kind === 'work')).toBe(false);
    expect(todoItems(items)).toEqual([
      { kind: 'agent-todo', items: [{ text: '跑测试', state: 'doing' }] },
    ]);
  });

  test('a running turn is one running work block with the agent-todo right above it', () => {
    const settledCall: MessageRow = {
      id: 'm-read',
      role: 'assistant',
      createdAt: NOW - 20_000,
      content: {
        kind: 'toolcall',
        call: { id: 'c-read', name: 'Read', arguments: { file_path: 'src/a.ts' }, result: 'ok' },
      },
    };
    const note: MessageRow = {
      id: 'm-note',
      role: 'assistant',
      createdAt: NOW - 15_000,
      content: '第一阶段读完了，下面开始运行测试。',
    };
    const activeCall: MessageRow = {
      id: 'm-bash',
      role: 'assistant',
      createdAt: NOW - 5_000,
      content: {
        kind: 'toolcall',
        call: { id: 'c-bash', name: 'Bash', arguments: { command: 'pnpm test' } },
      },
    };
    const items = render({
      messages: [settledCall, note, activeCall],
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s1', [
        { text: '读文件', state: 'done' },
        { text: '跑测试', state: 'doing' },
      ]),
    });
    const works = items.filter((i) => i.kind === 'work');
    expect(works).toHaveLength(1);
    expect(works[0]?.running).toBe(true);
    const workAt = items.findIndex((i) => i.kind === 'work');
    expect(items[workAt - 1]?.kind).toBe('agent-todo');
    expect(items.some((i) => i.kind === 'streaming')).toBe(false);
  });
});

describe('mapTranscript running turn (Claude Code parity, mon X 2026-11-19)', () => {
  const read = (id: string, at: number): MessageRow => ({
    id,
    role: 'assistant',
    createdAt: at,
    content: {
      kind: 'toolcall',
      call: { id: `c-${id}`, name: 'Read', arguments: { file_path: `src/${id}.ts` }, result: 'ok' },
    },
  });

  test('between two calls the turn stays one running work block and adds no status row', () => {
    const items = render({
      messages: [read('a', NOW - 20_000), read('b', NOW - 10_000)],
      steps: [runningStep('s1')],
    });
    expect(items.filter((i) => i.kind === 'work')).toEqual([
      expect.objectContaining({ running: true }),
    ]);
    expect(items.some((i) => i.kind === 'streaming')).toBe(false);
  });

  test('prose after a call stays inside the running block, persisted or streaming', () => {
    const persisted = render({
      messages: [
        read('a', NOW - 20_000),
        { id: 'mid', role: 'assistant', createdAt: NOW - 15_000, content: '读完 a，再看看 b。' },
      ],
      steps: [runningStep('s1')],
      liveText: '先看 b 的导出',
    });
    expect(persisted.some((i) => i.kind === 'robot')).toBe(false);
    const work = persisted.find((i) => i.kind === 'work');
    expect(work?.kind === 'work' && work.running).toBe(true);
    expect(work?.kind === 'work' && work.steps.map((s) => s.kind)).toEqual(['call', 'say', 'say']);
    expect(persisted.some((i) => i.kind === 'streaming')).toBe(false);
  });

  test('streaming text before the first call of the step stays prose', () => {
    const items = render({ steps: [runningStep('s1')], liveText: '我按这三步来。' });
    expect(items.some((i) => i.kind === 'robot')).toBe(true);
    expect(items.some((i) => i.kind === 'work')).toBe(false);
  });

  test('the narration before the first call stays prose above the work block', () => {
    const items = render({
      messages: [
        { id: 'plan', role: 'assistant', createdAt: NOW - 25_000, content: '我按这三步来。' },
        read('a', NOW - 20_000),
        { id: 'mid', role: 'assistant', createdAt: NOW - 15_000, content: '读完 a，再读 b。' },
        read('b', NOW - 10_000),
      ],
      steps: [runningStep('s1')],
    });
    const kinds = items.filter((i) => i.kind === 'robot' || i.kind === 'work').map((i) => i.kind);
    expect(kinds).toEqual(['robot', 'work']);
    const work = items.find((i) => i.kind === 'work');
    expect(work?.kind === 'work' && work.steps.map((s) => s.kind)).toEqual(['call', 'say', 'call']);
  });
});

describe('mapTranscript background tasks (docs/design/task-panel-live-row-subagents-todo.md B)', () => {
  const call = (id: string, at: number, extra: Record<string, unknown> = {}): MessageRow => ({
    id,
    role: 'assistant',
    createdAt: at,
    content: {
      kind: 'toolcall',
      call: { id, name: 'Bash', arguments: { command: `echo ${id}` }, result: id, ...extra },
    },
  });
  const bg = (taskId: string, status: string, extra: Record<string, unknown> = {}): MessageRow => ({
    id: `bg-s1-${taskId}`,
    role: 'assistant',
    createdAt: NOW - 20_000,
    content: {
      kind: 'bg_task',
      task: { taskId, type: 'agent', description: `survey ${taskId}`, status, startedAt: NOW - 20_000, ...extra },
    },
  });
  const spawn: MessageRow = {
    id: 'toolu_spawn',
    role: 'assistant',
    createdAt: NOW - 20_000,
    content: {
      kind: 'toolcall',
      call: { id: 'toolu_spawn', name: 'Agent', arguments: { description: 'survey a' }, result: 'launched' },
    },
  };
  const workCalls = (items: TranscriptItem[]) =>
    items.flatMap((item) =>
      item.kind === 'work'
        ? item.steps.flatMap((step) =>
            step.kind === 'call'
              ? [{ id: step.id, background: step.background, description: step.description }]
              : [],
          )
        : [],
    );

  test('sub-agent calls leave the main trace and land on their task; the spawning call is named by the task', () => {
    const items = render({
      steps: [runningStep('s1')],
      messages: [
        spawn,
        bg('a', 'running', { toolCallId: 'toolu_spawn', toolUses: 1 }),
        call('child-1', NOW - 15_000, { parent: 'toolu_spawn' }),
        call('main-1', NOW - 10_000),
      ],
    });
    expect(workCalls(items)).toEqual([
      { id: 'toolu_spawn', background: true, description: 'survey a' },
      { id: 'main-1', background: undefined, description: 'echo main-1' },
    ]);
    const group = items.find((i) => i.kind === 'bg-tasks');
    expect(group).toMatchObject({
      buildId: 'build-1',
      tasks: [{ taskId: 'a', status: 'running', toolUses: 1, steps: [{ kind: 'call', id: 'child-1' }] }],
    });
  });

  test('the group sits above the todo, which counts the running tasks on itself; no running task means no group', () => {
    const agentTodo = todoUpdate('s1', [{ text: '汇总调研', state: 'doing' }]);
    const items = render({
      steps: [runningStep('s1')],
      messages: [bg('a', 'running'), bg('b', 'running'), bg('c', 'done', { endedAt: NOW - 5_000 })],
      agentTodo,
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf('bg-tasks')).toBeLessThan(kinds.indexOf('agent-todo'));
    expect(items.find((i) => i.kind === 'bg-tasks')).toMatchObject({
      tasks: [{ taskId: 'a' }, { taskId: 'b' }, { taskId: 'c', status: 'done' }],
    });
    expect(items.find((i) => i.kind === 'agent-todo')).toMatchObject({ backgroundRunning: 2 });
    const settled = render({
      steps: [runningStep('s1')],
      messages: [bg('c', 'done', { endedAt: NOW - 5_000 })],
      agentTodo,
    });
    expect(settled.some((i) => i.kind === 'bg-tasks')).toBe(false);
    expect(settled.find((i) => i.kind === 'agent-todo')).not.toHaveProperty('backgroundRunning');
  });
});

describe('mapTranscript checklist deduplication', () => {
  test('checklist-only assistant message renders only in agent-todo and emits no duplicate robot prose', () => {
    const items = render({
      steps: [runningStep('s1')],
      messages: [
        {
          id: 'm-checklist',
          role: 'assistant',
          createdAt: NOW - 5_000,
          content: '计划：\n- [x] 读配置\n- [~] 改接口\n- [ ] 跑测试',
        },
      ],
    });
    expect(items.some((i) => i.kind === 'robot')).toBe(false);
    expect(todoItems(items)).toEqual([
      {
        kind: 'agent-todo',
        items: [
          { text: '读配置', state: 'done' },
          { text: '改接口', state: 'doing' },
          { text: '跑测试', state: 'todo' },
        ],
      },
    ]);
  });

  test('mixed prose and checklist strips the checklist from robot prose while keeping surrounding prose and agent-todo', () => {
    const items = render({
      steps: [runningStep('s1')],
      messages: [
        {
          id: 'm-mixed',
          role: 'assistant',
          createdAt: NOW - 5_000,
          content: '先查一下现有实现。\n\nPlan:\n- [x] 读配置\n- [~] 改接口\n\n接下来开始改动。',
        },
      ],
    });
    const robots = items.filter((i): i is Extract<TranscriptItem, { kind: 'robot' }> => i.kind === 'robot');
    expect(robots).toHaveLength(1);
    expect(robots[0]?.markdown).toBe('先查一下现有实现。\n\n接下来开始改动。');
    expect(robots[0]?.markdown).not.toContain('- [x]');
    expect(todoItems(items)).toHaveLength(1);
  });

  test('streaming liveText checklist emits no duplicate checklist in robot or work say', () => {
    const items = render({
      steps: [runningStep('s1')],
      liveText: '计划：\n- [ ] 第一步\n- [~] 第二步',
    });
    expect(items.some((i) => i.kind === 'robot')).toBe(false);
    expect(todoItems(items)).toEqual([
      {
        kind: 'agent-todo',
        items: [
          { text: '第一步', state: 'todo' },
          { text: '第二步', state: 'doing' },
        ],
      },
    ]);
  });
});
