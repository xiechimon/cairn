import { describe, expect, test } from 'vitest';
import {
  type SealedSegment,
  SegmentBuffer,
  SegmentEmitter,
  segmentContent,
} from '../src/segment.js';

describe('SegmentBuffer（F1..F7）', () => {
  test('F1: consecutive appends of the same kind only accumulate, producing no line', () => {
    const buf = new SegmentBuffer();
    expect(buf.append('text', '甲')).toBeNull();
    expect(buf.append('text', '乙')).toBeNull();
    expect(buf.append('text', '丙')).toBeNull();
    expect(buf.current()).toEqual({ kind: 'text', text: '甲乙丙' });
  });

  test('F2: switching to a different kind seals the previous segment and hands it over', () => {
    const buf = new SegmentBuffer();
    buf.append('text', '先说一句');
    const sealed = buf.append('thinking', '再想一下');
    expect(sealed).toEqual({ kind: 'text', text: '先说一句' });
    expect(buf.current()).toEqual({ kind: 'thinking', text: '再想一下' });
  });

  test('F3: sealing clears the buffer — the next segment does not repeat the previous text', () => {
    const buf = new SegmentBuffer();
    buf.append('text', '第一段');
    expect(buf.seal()).toEqual({ kind: 'text', text: '第一段' });
    expect(buf.current()).toBeNull();
    buf.append('text', '第二段');
    expect(buf.seal()).toEqual({ kind: 'text', text: '第二段' });
  });

  test('F4: empty segments produce no line: never opened / resealed after sealing both return null', () => {
    const buf = new SegmentBuffer();
    expect(buf.seal()).toBeNull();
    buf.append('text', '有内容');
    expect(buf.seal()).not.toBeNull();
    expect(buf.seal()).toBeNull();
  });

  test('F4: an empty string does not change segment state', () => {
    const buf = new SegmentBuffer();
    expect(buf.append('text', '')).toBeNull();
    expect(buf.current()).toBeNull();
    buf.append('text', '甲');
    expect(buf.append('text', '')).toBeNull();
    expect(buf.current()).toEqual({ kind: 'text', text: '甲' });
  });

  test('F5: a full-text event is an authoritative replacement, not added to the accumulated deltas', () => {
    const buf = new SegmentBuffer();
    buf.append('thinking', '想了一半');
    expect(buf.replace('thinking', '想了一半然后想完了')).toBeNull();
    expect(buf.seal()).toEqual({ kind: 'thinking', text: '想了一半然后想完了' });
  });

  test('F5: a full-text event on a different kind seals the previous segment first', () => {
    const buf = new SegmentBuffer();
    buf.append('text', '正文');
    const sealed = buf.replace('thinking', '全文思考');
    expect(sealed).toEqual({ kind: 'text', text: '正文' });
    expect(buf.seal()).toEqual({ kind: 'thinking', text: '全文思考' });
  });

  test('F6: append after sealing opens a new segment normally', () => {
    const buf = new SegmentBuffer();
    buf.append('thinking', '想过');
    buf.seal();
    expect(buf.append('text', '说')).toBeNull();
    expect(buf.current()).toEqual({ kind: 'text', text: '说' });
  });

  test('F7: content preserved verbatim (no trim)', () => {
    const buf = new SegmentBuffer();
    buf.append('text', '  前后有空白\n\n');
    expect(buf.seal()).toEqual({ kind: 'text', text: '  前后有空白\n\n' });
  });

  test('segmentContent produces a single-type block array shape', () => {
    expect(segmentContent({ kind: 'text', text: '甲' })).toEqual([{ type: 'text', text: '甲' }]);
    expect(segmentContent({ kind: 'thinking', text: '乙' })).toEqual([
      { type: 'thinking', thinking: '乙' },
    ]);
  });
});

function collectingEmitter(): { emitter: SegmentEmitter; rows: SealedSegment[] } {
  const rows: SealedSegment[] = [];
  const emitter = new SegmentEmitter(async (seg) => {
    rows.push(seg);
  });
  return { emitter, rows };
}

describe('SegmentEmitter', () => {
  test('a kind switch emits the finished segment and keeps the new one open', async () => {
    const { emitter, rows } = collectingEmitter();
    await emitter.append('thinking', 'plan');
    await emitter.append('thinking', ' more');
    await emitter.append('text', 'answer');
    expect(rows).toEqual([{ kind: 'thinking', text: 'plan more' }]);
    await emitter.seal();
    expect(rows).toEqual([
      { kind: 'thinking', text: 'plan more' },
      { kind: 'text', text: 'answer' },
    ]);
  });

  test('a streamed message ends with its trailing segment and ignores the full content', async () => {
    const { emitter, rows } = collectingEmitter();
    await emitter.append('text', 'streamed');
    await emitter.endAssistantMessage([{ type: 'text', text: 'streamed' }]);
    expect(rows).toEqual([{ kind: 'text', text: 'streamed' }]);
  });

  test('a message whose segments were all emitted already adds no row at its end', async () => {
    const { emitter, rows } = collectingEmitter();
    await emitter.append('text', 'before the tool call');
    await emitter.seal();
    await emitter.endAssistantMessage([{ type: 'text', text: 'before the tool call' }]);
    expect(rows).toEqual([{ kind: 'text', text: 'before the tool call' }]);
  });

  test('a message that never streamed is emitted from its content blocks', async () => {
    const { emitter, rows } = collectingEmitter();
    await emitter.endAssistantMessage([
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'text', text: 'first ' },
      'second',
      { type: 'tool_use', id: 'call-1' },
      null,
    ]);
    expect(rows).toEqual([
      { kind: 'thinking', text: 'reasoning' },
      { kind: 'text', text: 'first second' },
    ]);
  });
});
