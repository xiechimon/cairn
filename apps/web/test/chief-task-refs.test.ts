import { describe, expect, test } from 'vitest';
import { taskRefsOf } from '../src/chief/chief-task-refs.js';

const glances = new Map([
  ['a1', { phase: 'building' as const, seq: 7, title: 'Read the repo' }],
  ['b2', { phase: 'review' as const, seq: 8, title: 'Write docs' }],
]);

describe('taskRefsOf', () => {
  test('reads task mentions from markdown and keeps first-seen order', () => {
    const refs = taskRefsOf({ markdown: 'See [#8](todo:b2) then [#7](todo:a1) and [#8](todo:b2)' }, glances);
    expect(refs.map((r) => r.todoId)).toEqual(['b2', 'a1']);
    expect(refs[0]).toMatchObject({ seq: 8, title: 'Write docs', phase: 'review' });
  });

  test('reads legacy segments by sequence number', () => {
    const refs = taskRefsOf({ paragraphs: [[{ text: '', todo: 7 }, { text: 'x' }]] }, glances);
    expect(refs.map((r) => r.todoId)).toEqual(['a1']);
  });

  test('drops tasks the page does not know and replies with no reference', () => {
    expect(taskRefsOf({ markdown: '[#9](todo:zz)' }, glances)).toEqual([]);
    expect(taskRefsOf({ markdown: 'plain' }, glances)).toEqual([]);
  });
});
