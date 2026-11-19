import { describe, expect, test } from 'vitest';
import { foldTaskCards, placeTaskRefs, taskRefsOf } from '../src/chief/chief-task-refs.js';
import { growDelays, markGrown } from '../src/chief/task-ref-signal.js';
import type { GroupedRow } from '../src/chief/thread-activity.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

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

  test('a task the reply started but did not mention gets a reference after the mentioned ones', () => {
    const refs = taskRefsOf({ markdown: 'See [#8](todo:b2)' }, glances, ['a1']);
    expect(refs.map((r) => r.todoId)).toEqual(['b2', 'a1']);
  });

  test('a started task the reply also mentions is referenced once', () => {
    const refs = taskRefsOf({ markdown: 'Started [#7](todo:a1)' }, glances, ['a1', 'a1']);
    expect(refs.map((r) => r.todoId)).toEqual(['a1']);
  });

  test('the cap on mentioned tasks never drops a started one', () => {
    const many = new Map(
      ['t1', 't2', 't3', 't4', 't5'].map((id, n) => [id, { phase: 'building' as const, seq: n + 1, title: id }]),
    );
    const markdown = '[#1](todo:t1) [#2](todo:t2) [#3](todo:t3) [#4](todo:t4)';
    expect(taskRefsOf({ markdown }, many).map((r) => r.todoId)).toEqual(['t1', 't2', 't3']);
    expect(taskRefsOf({ markdown }, many, ['t4', 't5']).map((r) => r.todoId)).toEqual([
      't1', 't2', 't3', 't4', 't5',
    ]);
  });

  test('a started task the page does not know is left to its own row', () => {
    expect(taskRefsOf({ markdown: 'plain' }, glances, ['zz'])).toEqual([]);
  });
});

describe('foldTaskCards', () => {
  const rows = (...items: ChiefStreamItem[]): GroupedRow[] => items.map((item, i) => ({ item, i }));
  const user: ChiefStreamItem = { kind: 'user', id: 'u1', text: 'go' };
  const reply: ChiefStreamItem = { kind: 'robot', id: 'r1', seconds: '', markdown: 'Started it.' };
  const card = (todoId: string): ChiefStreamItem => ({
    kind: 'task-card', id: `${todoId}:card`, todoId, projectId: 'p1', seq: null, title: null,
  });

  test('cards after a reply fold into that reply and leave no row of their own', () => {
    const list = rows(user, reply, card('a1'), card('b2'));
    const folded = foldTaskCards(list, glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['user', 'robot']);
    expect(folded.startedBy.get(reply)).toEqual(['a1', 'b2']);
    expect(folded.startedBy.size).toBe(1);
  });

  test('a card with no reply before it keeps its own row', () => {
    const folded = foldTaskCards(rows(card('a1'), user), glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['task-card', 'user']);
    expect(folded.startedBy.size).toBe(0);
  });

  test('a card for a task the page does not know keeps its own row for the one-line link', () => {
    const folded = foldTaskCards(rows(user, reply, card('zz')), glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['user', 'robot', 'task-card']);
    expect(folded.startedBy.size).toBe(0);
  });

  test('an unknown card does not stop the next card from folding into the reply', () => {
    const folded = foldTaskCards(rows(user, reply, card('zz'), card('a1')), glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['user', 'robot', 'task-card']);
    expect(folded.startedBy.get(reply)).toEqual(['a1']);
  });

  test('cards of a turn still running hang on its live row, not on the previous reply', () => {
    const earlier: ChiefStreamItem = { kind: 'robot', id: 'r0', seconds: '', markdown: 'Earlier.' };
    const live: ChiefStreamItem = { kind: 'streaming', label: '处理中...' };
    const list = rows(user, earlier, card('a1'), card('b2'), live);
    const folded = foldTaskCards(list, glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['user', 'robot', 'streaming']);
    expect(folded.startedBy.get(live)).toEqual(['a1', 'b2']);
    expect(folded.startedBy.has(earlier)).toBe(false);
    expect(placeTaskRefs(folded.rows, folded.startedBy, glances, new Set()).get(live)?.map((r) => r.todoId)).toEqual([
      'a1',
      'b2',
    ]);
  });

  test('cards before a typing reply hang on that reply', () => {
    const typing: ChiefStreamItem = { kind: 'robot', seconds: '', markdown: 'Started', typing: true };
    const folded = foldTaskCards(rows(user, card('a1'), typing), glances);
    expect(folded.rows.map((row) => row.item.kind)).toEqual(['user', 'robot']);
    expect(folded.startedBy.get(typing)).toEqual(['a1']);
  });

  test('a live row after a later user message does not take an earlier turn\'s cards', () => {
    const live: ChiefStreamItem = { kind: 'streaming', label: '处理中...' };
    const next: ChiefStreamItem = { kind: 'user', id: 'u2', text: 'more' };
    const folded = foldTaskCards(rows(user, reply, card('a1'), next, live), glances);
    expect(folded.startedBy.get(reply)).toEqual(['a1']);
    expect(folded.startedBy.has(live)).toBe(false);
  });

  test('an unchanged fold hands the reply the same list, so its row does not re-render', () => {
    const list = rows(user, reply, card('a1'));
    expect(foldTaskCards(list, glances).startedBy.get(reply)).toBe(
      foldTaskCards(list, glances).startedBy.get(reply),
    );
  });
});

describe('growDelays', () => {
  test('only tasks new to a live turn grow, staggered in order, and never twice', () => {
    expect([...growDelays(['g1', 'g2'], false)]).toEqual([]);
    expect([...growDelays(['g1', 'g2'], true)]).toEqual([
      ['g1', 0],
      ['g2', 350],
    ]);
    markGrown('g1');
    expect([...growDelays(['g1', 'g2', 'g3'], true)]).toEqual([
      ['g2', 0],
      ['g3', 350],
    ]);
  });
});
