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

  it('a time divider, a status row, or a reply with leading subagent/task chrome breaks the run', () => {
    const subagentRobot: GroupedRow['item'] = {
      kind: 'robot',
      paragraphs: [],
      seconds: '',
      tools: [
        {
          label: 'sub',
          subagent: { label: 'Explore', status: 'completed', toolCalls: 2 },
        },
      ],
    };
    const runs = bubbleRuns(
      rows([
        { kind: 'user', text: 'a', createdAt: 0 },
        { kind: 'user', text: 'b', createdAt: 2 * HOUR },
        { kind: 'note', text: 'n' },
        { kind: 'user', text: 'c' },
        { kind: 'robot', paragraphs: [], seconds: '' },
        subagentRobot,
      ]),
      null,
    );
    expect(runs.map((run) => run.joinsPrev)).toEqual([false, false, false, false, false, false]);
    expect(runs[4]).toEqual({ joinsPrev: false, joinsNext: false });
  });

  it('joins consecutive robot replies when only non-subagent tools or hidden rows sit between them', () => {
    const r1: GroupedRow['item'] = { kind: 'robot', id: 'r1', markdown: 'one', seconds: '' };
    const r2: GroupedRow['item'] = {
      kind: 'robot',
      id: 'r2',
      markdown: 'two',
      seconds: '',
      tools: [{ label: 'usage' }],
    };
    const r3: GroupedRow['item'] = { kind: 'robot', id: 'r3', markdown: 'three', seconds: '' };
    const runs = bubbleRuns(
      rows([
        r1,
        { kind: 'thinking', text: 'internal thought' },
        r2,
        { kind: 'thinking-group', texts: ['a', 'b'] },
        { kind: 'chat-block', id: 'cb1', tool: 'diff', state: 'failed' },
        { kind: 'error', id: 'e1', text: 'boom' },
        r3,
      ]),
      null,
      { cardFailure: 'e1' },
    );
    expect(runs[0]).toEqual({ joinsPrev: false, joinsNext: true });
    expect(runs[2]).toEqual({ joinsPrev: true, joinsNext: true });
    expect(runs[6]).toEqual({ joinsPrev: true, joinsNext: false });
  });

  it('breaks the run on both sides when a reply starts with a task trunk', () => {
    const r1: GroupedRow['item'] = { kind: 'robot', id: 'r1', markdown: 'one', seconds: '' };
    const r2: GroupedRow['item'] = { kind: 'robot', id: 'r2', markdown: 'two', seconds: '' };
    const runs = bubbleRuns(rows([r1, r2]), null, { startedBy: new Map([[r2, ['todo-1']]]) });
    expect(runs).toEqual([
      { joinsPrev: false, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
    ]);
  });

  it('keeps user-to-robot and robot-to-user transitions unjoined', () => {
    const runs = bubbleRuns(
      rows([
        { kind: 'user', text: 'u1' },
        { kind: 'robot', markdown: 'r1', seconds: '' },
        { kind: 'user', text: 'u2' },
      ]),
      null,
    );
    expect(runs).toEqual([
      { joinsPrev: false, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
      { joinsPrev: false, joinsNext: false },
    ]);
  });

  it('carries the clock from earlier rows', () => {
    const runs = bubbleRuns(rows([{ kind: 'user', text: 'a', createdAt: 3 * HOUR }]), 0);
    expect(runs).toEqual([{ joinsPrev: false, joinsNext: false }]);
  });

  it('an answered question is a receipt that joins neither the reply before it nor the message after it', () => {
    const answered = {
      kind: 'question' as const,
      requestId: 'q1',
      status: 'answered' as const,
      questions: [],
      answers: [{ header: 'Theme', choices: ['Dark'] }],
    };
    const runs = bubbleRuns(
      rows([
        { kind: 'robot', paragraphs: [], seconds: '' },
        answered,
        { kind: 'user', text: 'a' },
        { kind: 'user', text: 'b' },
      ]),
      null,
    );
    expect(runs.map((run) => run.joinsPrev)).toEqual([false, false, false, true]);
  });
});
