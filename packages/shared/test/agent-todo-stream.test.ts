import { describe, expect, it } from 'vitest';
import {
  AGENT_TODO_LINE_RE,
  AGENT_TODO_MARKER_STATES,
  agentTodoReportSchema,
  agentTodoSchema,
  stripAgentTodoText,
  toolCallRecordSchema,
} from '../src/index.js';
import { machineToolBodySchema } from '../src/protocol/machine-wire.js';
import { conversationStreamEventSchema } from '../src/protocol/sse.js';

const ITEMS = [
  { text: '通读 poteto 的推文观点', state: 'todo' },
  { text: '开票沉淀注释规则', state: 'doing' },
  { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
] as const;

describe("agent todo wire's three surfaces", () => {
  it('machine-surface reported shape enters the tool/{stepId} union (seventh shape)', () => {
    const parsed = machineToolBodySchema.safeParse({
      kind: 'agent_todo',
      todo: { items: ITEMS },
    });
    expect(parsed.success).toBe(true);
  });

  it('conversation-stream events = reported shape + server stamping (stepId/at)', () => {
    const parsed = conversationStreamEventSchema.safeParse({
      type: 'agent_todo',
      todo: { items: ITEMS, stepId: 'step-0199', at: 1760000000000 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        type: 'agent_todo',
        todo: { items: ITEMS, stepId: 'step-0199', at: 1760000000000 },
      });
    }
  });

  it('todo call lines carry the cairn projection bits; non-todo calls unchanged by default', () => {
    const withTodo = toolCallRecordSchema.parse({
      id: 'toolu_1',
      name: 'TodoWrite',
      arguments: { todos: [] },
      todo: ITEMS,
    });
    expect(withTodo.todo).toEqual(ITEMS);
    const without = toolCallRecordSchema.parse({
      id: 'toolu_2',
      name: 'bash',
      arguments: { command: 'ls' },
    });
    expect(without.todo).toBeUndefined();
  });

  it('state outside vocabulary rejected; empty text rejected; over-limit rejected (fail-closed)', () => {
    expect(
      agentTodoReportSchema.safeParse({ items: [{ text: 'a', state: 'later' }] }).success,
    ).toBe(false);
    expect(agentTodoReportSchema.safeParse({ items: [{ text: '', state: 'todo' }] }).success).toBe(
      false,
    );
    expect(
      agentTodoReportSchema.safeParse({
        items: Array.from({ length: 65 }, (_, i) => ({ text: `t${i}`, state: 'todo' })),
      }).success,
    ).toBe(false);
    expect(agentTodoSchema.safeParse({ items: ITEMS }).success).toBe(false);
  });

  it('line-syntax marker vocabulary and state mapping single source: x/X=done, space=todo, ~/=doing', () => {
    expect(Object.keys(AGENT_TODO_MARKER_STATES).sort()).toEqual([' ', '/', 'X', 'x', '~']);
    const line = AGENT_TODO_LINE_RE.exec('- [x] 查 pi 模型上下文');
    expect(line?.[1]).toBe('x');
    expect(AGENT_TODO_MARKER_STATES[line?.[1] ?? '']).toBe('done');
    expect(AGENT_TODO_LINE_RE.exec('plain prose')).toBeNull();
  });
});

describe('stripAgentTodoText', () => {
  it('strips checklist-only messages and standalone headers down to empty string', () => {
    expect(stripAgentTodoText('- [ ] 读配置\n- [~] 改接口\n- [x] 跑测试')).toBe('');
    expect(stripAgentTodoText('计划：\n- [ ] 读配置\n- [x] 跑测试')).toBe('');
    expect(stripAgentTodoText('Plan:\n\n- [ ] Step 1\n- [~] Step 2')).toBe('');
    expect(stripAgentTodoText('计划:\n* [ ] 第一步\n* [x] 第二步')).toBe('');
  });

  it('strips checklist blocks and standalone headers while preserving surrounding prose', () => {
    const input = [
      '我先检查配置文件。',
      '',
      '计划：',
      '- [x] 读配置',
      '- [~] 改接口',
      '- [ ] 补测试',
      '',
      '下面开始修改接口。',
    ].join('\n');
    expect(stripAgentTodoText(input)).toBe('我先检查配置文件。\n\n下面开始修改接口。');
  });

  it('strips multiple checklist runs while preserving prose between them', () => {
    const input = [
      'Plan:',
      '- [x] 旧计划第一条',
      '- [x] 旧计划第二条',
      '',
      '进度说明',
      '',
      '- [ ] 新计划',
      '- [~] 正在做',
    ].join('\n');
    expect(stripAgentTodoText(input)).toBe('进度说明');
  });

  it('keeps fenced checklist examples and plain prose untouched', () => {
    const fencedOnly = ['```md', '- [ ] 围栏里的假清单', '```'].join('\n');
    expect(stripAgentTodoText(fencedOnly)).toBe(fencedOnly);
    const mixed = ['示例：', '```md', '- [ ] 围栏里的假清单', '```', '', '- [x] 真清单'].join('\n');
    expect(stripAgentTodoText(mixed)).toBe(
      ['示例：', '```md', '- [ ] 围栏里的假清单', '```'].join('\n'),
    );
  });
});
