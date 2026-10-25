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
  test('F1 tool rows flatten into the main presentation while the turn is in flight', () => {
    const items = mapChiefStream(
      [
        row('m1', 'assistant', text('先说一句'), 1),
        row('t1', 'assistant', toolcall('c1', 'bash'), 2),
      ],
      true,
    );
    expect(items.map((i) => i.kind)).toEqual(['robot', 'tool']);
  });

  test('F2 tool rows sort before the text segment that follows them, and do not reorder the stored order', () => {
    const items = mapChiefStream(
      [
        row('m1', 'assistant', text('甲'), 1),
        row('t1', 'assistant', toolcall('c1', 'bash'), 2),
        row('m2', 'assistant', text('乙'), 3),
      ],
      true,
    );
    expect(items.map((i) => i.kind)).toEqual(['robot', 'tool', 'robot']);
    expect(items[0]).toMatchObject({ kind: 'robot', markdown: '甲' });
    expect(items[2]).toMatchObject({ kind: 'robot', markdown: '乙' });
  });

  test('F2 calls without a result carry the running slot, calls with a result carry seconds', () => {
    const items = mapChiefStream(
      [
        row('t1', 'assistant', toolcall('c1', 'bash'), 1),
        row('t2', 'assistant', toolcall('c2', 'read', { endedAt: 3000, result: 'ok' }), 2),
      ],
      true,
    );
    expect(items[0]).toEqual({ kind: 'tool', label: 'bash', id: 't1', startedAt: 1000, running: true });
    expect(items[1]).toEqual({ kind: 'tool', label: 'read', id: 't2', startedAt: 1000, seconds: 2 });
  });

  test('F3 after the turn settles, tools fold back into the robot row tools collapsed face, no longer flat', () => {
    const messages = [
      row('t1', 'assistant', toolcall('c1', 'bash', { endedAt: 3000 }), 1),
      row('m1', 'assistant', text('甲'), 2),
    ];
    const inFlight = mapChiefStream(messages, true);
    expect(inFlight.map((i) => i.kind)).toEqual(['tool', 'robot']);
    const settled = mapChiefStream(messages, false);
    expect(settled.map((i) => i.kind)).toEqual(['robot']);
    expect(settled[0]).toMatchObject({ kind: 'robot', tools: [{ label: 'bash', seconds: 2 }] });
  });

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

  test('F6 default face (no inlineTools passed) projects the same shape as before the change', () => {
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