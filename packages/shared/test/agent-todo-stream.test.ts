import { describe, expect, it } from 'vitest';
import {
  AGENT_TODO_LINE_RE,
  AGENT_TODO_MARKER_STATES,
  agentTodoReportSchema,
  agentTodoSchema,
  toolCallRecordSchema,
} from '../src/index.js';
import { machineToolBodySchema } from '../src/protocol/machine-wire.js';
import { conversationStreamEventSchema } from '../src/protocol/sse.js';

const ITEMS = [
  { text: '通读 poteto 的推文观点', state: 'todo' },
  { text: '开票沉淀注释规则', state: 'doing' },
  { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
] as const;

describe('agent todo wire 三面', () => {
  it('机器面上报形进 tool/{stepId} union（第七形）', () => {
    const parsed = machineToolBodySchema.safeParse({
      kind: 'agent_todo',
      todo: { items: ITEMS },
    });
    expect(parsed.success).toBe(true);
  });

  it('会话流事件 = 上报形 + server 盖章（stepId/at）', () => {
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

  it('todo 调用行携带 cairn 投影位；非 todo 调用缺省不变', () => {
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

  it('state 词表外拒绝；空 text 拒绝；超上限拒绝（fail-closed）', () => {
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

  it('行文法 marker 词表与状态映射单源：x/X=done，空格=todo，~/=doing', () => {
    expect(Object.keys(AGENT_TODO_MARKER_STATES).sort()).toEqual([' ', '/', 'X', 'x', '~']);
    const line = AGENT_TODO_LINE_RE.exec('- [x] 查 pi 模型上下文');
    expect(line?.[1]).toBe('x');
    expect(AGENT_TODO_MARKER_STATES[line?.[1] ?? '']).toBe('done');
    expect(AGENT_TODO_LINE_RE.exec('plain prose')).toBeNull();
  });
});
