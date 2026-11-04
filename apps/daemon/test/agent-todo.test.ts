import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AGENT_TODO_MAX_ITEMS, type StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { parseAgentTodoText } from '../src/agent-todo.js';
import {
  createClaudeMapState,
  mapClaudeMessage,
  todoFromTodoWrite,
} from '../src/backend/claude-code.js';

describe('todoFromTodoWrite (claude-code TodoWrite → cairn format)', () => {
  test('F3: the three status words map verbatim to the three cairn states', () => {
    const items = todoFromTodoWrite('TodoWrite', {
      todos: [
        { content: '读 README', status: 'pending' },
        { content: '追加一行', status: 'in_progress' },
        { content: '验证尾部', status: 'completed' },
      ],
    });
    expect(items).toEqual([
      { text: '读 README', state: 'todo' },
      { text: '追加一行', state: 'doing' },
      { text: '验证尾部', state: 'done' },
    ]);
  });

  test('F1: non-TodoWrite name → null', () => {
    expect(todoFromTodoWrite('bash', { todos: [{ content: 'a', status: 'pending' }] })).toBeNull();
    expect(todoFromTodoWrite('todowrite', { todos: [] })).toBeNull();
  });

  test('F2: malformed input shape → no guessing, no output', () => {
    expect(todoFromTodoWrite('TodoWrite', undefined)).toBeNull();
    expect(todoFromTodoWrite('TodoWrite', { todos: 'nope' })).toBeNull();
    expect(todoFromTodoWrite('TodoWrite', { todos: [{ content: 'a' }] })).toBeNull();
    expect(
      todoFromTodoWrite('TodoWrite', { todos: [{ content: 'a', status: 'someday' }] }),
    ).toBeNull();
    expect(todoFromTodoWrite('TodoWrite', { todos: [{ status: 'pending' }] })).toBeNull();
  });

  test('F4: empty todos array → null (nothing to show)', () => {
    expect(todoFromTodoWrite('TodoWrite', { todos: [] })).toBeNull();
  });

  test('F5: truncated beyond the cap (bounded payload)', () => {
    const todos = Array.from({ length: AGENT_TODO_MAX_ITEMS + 10 }, (_, i) => ({
      content: `条目 ${i}`,
      status: 'pending',
    }));
    const items = todoFromTodoWrite('TodoWrite', { todos });
    expect(items).not.toBeNull();
    expect(items).toHaveLength(AGENT_TODO_MAX_ITEMS);
  });

  test('tool_use block attaches the projection to the call row; non-TodoWrite call rows carry no todo field', () => {
    const state = createClaudeMapState();
    const events: StepEvent[] = [];
    for (const ev of mapClaudeMessage(
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'TodoWrite',
              input: { todos: [{ content: '读文件', status: 'in_progress' }] },
            },
            { type: 'tool_use', id: 't2', name: 'bash', input: { command: 'ls' } },
          ],
        },
      } as SDKMessage,
      state,
    )) {
      events.push(ev);
    }
    const calls = events
      .filter((e): e is Extract<StepEvent, { type: 'toolcall_end' }> => e.type === 'toolcall_end')
      .map((e) => e.call);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.todo).toEqual([{ text: '读文件', state: 'doing' }]);
    expect(calls[1]?.todo).toBeUndefined();
  });
});

describe('parseAgentTodoText (pi text channel: `- [ ]` lines → cairn format)', () => {
  test('T1: all four markers map', () => {
    const items = parseAgentTodoText(
      [
        '- [ ] 待开始',
        '- [x] 已完成小写',
        '- [X] 已完成大写',
        '- [~] 进行中波浪',
        '- [/] 进行中斜杠',
      ].join('\n'),
    );
    expect(items).toEqual([
      { text: '待开始', state: 'todo' },
      { text: '已完成小写', state: 'done' },
      { text: '已完成大写', state: 'done' },
      { text: '进行中波浪', state: 'doing' },
      { text: '进行中斜杠', state: 'doing' },
    ]);
  });

  test('T2: no task lines → null; plain prose does not drive', () => {
    expect(parseAgentTodoText('先看方案，再动手。')).toBeNull();
    expect(parseAgentTodoText('')).toBeNull();
  });

  test('T3: multiple task-line runs → take the last contiguous run', () => {
    const items = parseAgentTodoText(
      [
        '- [x] 旧计划第一条',
        '- [x] 旧计划第二条',
        '',
        '进度说明',
        '',
        '- [ ] 新计划',
        '- [~] 正在做',
      ].join('\n'),
    );
    expect(items).toEqual([
      { text: '新计划', state: 'todo' },
      { text: '正在做', state: 'doing' },
    ]);
  });

  test('T4: task lines inside fences do not count (same rule as web rendering)', () => {
    const items = parseAgentTodoText(
      ['```md', '- [ ] 围栏里的假清单', '```', '', '- [x] 真清单'].join('\n'),
    );
    expect(items).toEqual([{ text: '真清单', state: 'done' }]);
  });

  test('T5: empty-text task lines are skipped', () => {
    const items = parseAgentTodoText(['- [ ]', '- [x] 有内容'].join('\n'));
    expect(items).toEqual([{ text: '有内容', state: 'done' }]);
  });

  test('T6: truncated beyond the cap', () => {
    const lines = Array.from({ length: AGENT_TODO_MAX_ITEMS + 5 }, (_, i) => `- [ ] 条目 ${i}`);
    const items = parseAgentTodoText(lines.join('\n'));
    expect(items).not.toBeNull();
    if (items === null) return;
    expect(items).toHaveLength(AGENT_TODO_MAX_ITEMS);
    expect(items[0]).toEqual({ text: '条目 0', state: 'todo' });
  });

  test('prose grammar is same-source with the web TaskCard: `*` markers and indentation also recognized', () => {
    const items = parseAgentTodoText('  * [~] 缩进的星号条目');
    expect(items).toEqual([{ text: '缩进的星号条目', state: 'doing' }]);
  });
});
