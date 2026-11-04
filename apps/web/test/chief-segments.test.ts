import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';

const row = (id: string, role: MessageRow['role'], content: unknown, createdAt: number): MessageRow =>
  ({ id, role, content, createdAt }) as MessageRow;

const text = (t: string) => [{ type: 'text', text: t }];
const thinking = (t: string) => [{ type: 'thinking', thinking: t }];
const toolcall = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'toolcall',
  call: { id, name, arguments: {}, startedAt: 1000, ...extra },
});

describe('segment-row projection (F1..F6)', () => {
  test('F4 thinking rows without body yield a thinking item', () => {
    const items = mapChiefStream([row('m1', 'assistant', thinking('想了一下'), 1)]);
    expect(items).toEqual([{ kind: 'thinking', text: '想了一下', id: 'm1' }]);
  });

  test('F5 mixed rows (text + thinking) still yield only a robot row, thinking not duplicated', () => {
    const items = mapChiefStream([
      row('m1', 'assistant', [...text('正文'), ...thinking('顺带想了想')], 1),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['robot']);
    expect(items[0]).toMatchObject({ kind: 'robot', markdown: '正文' });
  });

  test('F6 tool rows never stand alone; they fold into the reply that follows them', () => {
    const items = mapChiefStream([
      row('m1', 'assistant', text('甲'), 1),
      row('t1', 'assistant', toolcall('c1', 'bash', { endedAt: 3000 }), 2),
      row('m2', 'assistant', text('乙'), 3),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['robot', 'robot']);
    expect(items[0]).toEqual({ kind: 'robot', markdown: '甲', seconds: '', id: 'm1' });
    expect(items[1]).toEqual({
      kind: 'robot',
      markdown: '乙',
      seconds: '',
      id: 'm2',
      tools: [{ label: 'bash', seconds: 2 }],
    });
  });
});