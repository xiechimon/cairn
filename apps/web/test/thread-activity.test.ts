import { describe, expect, test } from 'vitest';
import {
  activitySummary,
  groupThreadEvents,
  type StreamRow,
  type ThreadActivity,
} from '../src/chief/thread-activity.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

let counter = 0;
const nextId = () => `row-${counter++}`;

function message(seq: number, excerpt = 'hello', by: 'user' | 'coordinator' = 'coordinator') {
  return {
    kind: 'thread-message',
    id: nextId(),
    todoId: `todo-${seq}`,
    seqNum: seq,
    title: `task ${seq}`,
    excerpt,
    delivered: 'steer',
    conversationId: 'conv-1',
    by,
  } satisfies ChiefStreamItem;
}

function report(seq: number, phase: 'done' | 'failed' | 'review' | 'needs-you', line?: string) {
  return {
    kind: 'thread-report',
    id: nextId(),
    todoId: `todo-${seq}`,
    seqNum: seq,
    title: `task ${seq}`,
    phase,
    ...(line === undefined ? {} : { line }),
  } satisfies ChiefStreamItem;
}

const user = (): ChiefStreamItem => ({ kind: 'user', id: nextId(), text: 'hi' });

const toRows = (items: ChiefStreamItem[]): StreamRow[] => items.map((item, i) => ({ item, i }));
const never = () => false;
const activities = (entries: ReturnType<typeof groupThreadEvents>): ThreadActivity[] =>
  entries.flatMap((entry) => (entry.item.kind === 'thread-activity' ? [entry.item] : []));
const kinds = (entries: ReturnType<typeof groupThreadEvents>) =>
  entries.map((entry) => entry.item.kind);

describe('groupThreadEvents', () => {
  test('user relay markers are hidden without changing source rows or the original message', () => {
    const original = user();
    const relay = message(2, 'hi', 'user');
    const rows = toRows([original, relay]);
    const snapshot = structuredClone(rows);
    expect(groupThreadEvents(rows, never)).toEqual([{ item: original, i: 0 }]);
    expect(rows).toEqual(snapshot);
  });

  test('hidden relay markers do not appear in activity counts or expanded events', () => {
    const coordinator = message(2, 'continue', 'coordinator');
    const status = report(2, 'review');
    const entries = groupThreadEvents(
      toRows([message(2, 'hello', 'user'), coordinator, message(2, 'again', 'user'), status]),
      never,
    );
    expect(activities(entries)[0]?.events).toEqual([coordinator, status]);
    expect(activitySummary(activities(entries)[0] as ThreadActivity).messages).toBe(1);
    expect(entries[0]?.i).toBe(1);
  });
  test('consecutive events about one thread coalesce into one row', () => {
    const entries = groupThreadEvents(
      toRows([message(2), message(2, 'again'), report(2, 'review')]),
      never,
    );
    expect(entries).toHaveLength(1);
    expect(activities(entries)[0]).toMatchObject({ title: 'task 2' });
    expect(activities(entries)[0]?.events).toHaveLength(3);
  });

  test('a different thread breaks the group', () => {
    const entries = groupThreadEvents(
      toRows([message(2), message(3), message(2, 'back')]),
      never,
    );
    expect(activities(entries).map((a) => [a.title, a.events.length])).toEqual([
      ['task 2', 1],
      ['task 3', 1],
      ['task 2', 1],
    ]);
  });

  test('a conversation message between events breaks the group', () => {
    const entries = groupThreadEvents(toRows([message(2), user(), message(2, 'next')]), never);
    expect(kinds(entries)).toEqual([
      'thread-activity',
      'user',
      'thread-activity',
    ]);
  });

  test('identical repeated statuses dedupe', () => {
    const entries = groupThreadEvents(
      toRows([report(2, 'review'), report(2, 'review'), report(2, 'review')]),
      never,
    );
    expect(activities(entries)[0]?.events).toHaveLength(1);
  });

  test('a status that returns after a different one is kept', () => {
    const entries = groupThreadEvents(
      toRows([report(2, 'review'), report(2, 'failed'), report(2, 'review')]),
      never,
    );
    expect(activities(entries)[0]?.events).toHaveLength(3);
  });

  test('identical messages are never deduped', () => {
    const entries = groupThreadEvents(toRows([message(2, 'same'), message(2, 'same')]), never);
    expect(activities(entries)[0]?.events).toHaveLength(2);
  });

  test('a standalone report stays its own row and breaks the group', () => {
    const asking = report(2, 'needs-you', 'which one?');
    const entries = groupThreadEvents(
      toRows([message(2), asking, message(2, 'after')]),
      (item) => item === asking,
    );
    expect(kinds(entries)).toEqual([
      'thread-activity',
      'thread-report',
      'thread-activity',
    ]);
  });

  test('rows keep the original stream index of their first event', () => {
    const entries = groupThreadEvents(
      [{ item: user(), i: 4 }, ...toRows([message(2), message(2, 'b')]).map((r) => ({ ...r, i: r.i + 5 }))],
      never,
    );
    expect(entries.map((entry) => entry.i)).toEqual([4, 5]);
  });
});

describe('activitySummary', () => {
  test('counts messages and names the latest status', () => {
    const [activity] = activities(
      groupThreadEvents(
        toRows([
          message(2, 'a'),
          message(2, 'b'),
          message(2, 'c', 'coordinator'),
          message(2, 'd'),
          report(2, 'review'),
        ]),
        never,
      ),
    );
    expect(activity).toBeDefined();
    expect(activitySummary(activity as ThreadActivity)).toEqual({
      title: 'task 2',
      messages: 4,
      status: '审阅中',
    });
  });

  test('a group with only reports has no message count', () => {
    const [activity] = activities(
      groupThreadEvents(toRows([report(2, 'review'), report(2, 'done')]), never),
    );
    expect(activitySummary(activity as ThreadActivity)).toEqual({
      title: 'task 2',
      messages: 0,
      status: '已完成',
    });
  });

  test('a group with only messages has no status', () => {
    const [activity] = activities(groupThreadEvents(toRows([message(2), message(2, 'x')]), never));
    expect(activitySummary(activity as ThreadActivity)).toEqual({
      title: 'task 2',
      messages: 2,
      status: null,
    });
  });
});
