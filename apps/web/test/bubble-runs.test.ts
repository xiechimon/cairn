import { describe, expect, it } from 'vitest';
import { bubbleRuns } from '../src/chief/bubble-runs.js';
import type { GroupedRow } from '../src/chief/thread-activity.js';

const HOUR = 60 * 60_000;

function rows(items: GroupedRow['item'][]): GroupedRow[] {
  return items.map((item, i) => ({ item, i }));
}

describe('bubbleRuns', () => {
  it('joins consecutive messages of one author and breaks on another author', () => {
    const runs = bubbleRuns(
      rows([
        { kind: 'user', text: 'a' },
        { kind: 'user', text: 'b' },
        { kind: 'robot', paragraphs: [], seconds: '' },
        { kind: 'robot', paragraphs: [], seconds: '' },
        { kind: 'user', text: 'c' },
      ]),
      null,
    );
    expect(runs).toEqual([
      { joinsPrev: false, joinsNext: true },
      { joinsPrev: true, joinsNext: false },
      { joinsPrev: false, joinsNext: true },
      { joinsPrev: true, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
    ]);
  });

  it('a time divider, a status row or a reply that opens with tool steps breaks the run', () => {
    const runs = bubbleRuns(
      rows([
        { kind: 'user', text: 'a', createdAt: 0 },
        { kind: 'user', text: 'b', createdAt: 2 * HOUR },
        { kind: 'note', text: 'n' },
        { kind: 'user', text: 'c' },
        { kind: 'robot', paragraphs: [], seconds: '' },
        { kind: 'robot', paragraphs: [], seconds: '', tools: [{ label: 'read' }] },
      ]),
      null,
    );
    expect(runs.map((run) => run.joinsPrev)).toEqual([false, false, false, false, false, false]);
  });

  it('carries the clock from earlier rows', () => {
    const runs = bubbleRuns(rows([{ kind: 'user', text: 'a', createdAt: 3 * HOUR }]), 0);
    expect(runs).toEqual([{ joinsPrev: false, joinsNext: false }]);
  });

  it('an answered question is an owner bubble and joins the owner run around it', () => {
    const answered = {
      kind: 'question' as const,
      requestId: 'q1',
      status: 'answered' as const,
      questions: [],
      answers: [{ header: 'Theme', choices: ['Dark'] }],
    };
    const runs = bubbleRuns(
      rows([
        { kind: 'user', text: 'a' },
        answered,
        { kind: 'robot', paragraphs: [], seconds: '' },
        { ...answered, status: 'cancelled' },
        { kind: 'user', text: 'b' },
      ]),
      null,
    );
    expect(runs).toEqual([
      { joinsPrev: false, joinsNext: true },
      { joinsPrev: true, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
    ]);
  });
});
