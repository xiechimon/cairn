import { describe, expect, test } from 'vitest';
import { outstandingReportIds } from '../src/chief/outstanding-reports.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

function report(id: string, todoId: string, phase: 'done' | 'failed' | 'review' | 'needs-you') {
  return { kind: 'thread-report', id, todoId, phase, seqNum: 1, title: 'T' } as ChiefStreamItem;
}

describe('outstandingReportIds', () => {
  test('only the newest needs-you report of a todo is outstanding', () => {
    const stream = [
      report('old', 'a', 'needs-you'),
      { kind: 'note', text: 'x' } as ChiefStreamItem,
      report('new', 'a', 'needs-you'),
    ];
    expect([...outstandingReportIds(stream)]).toEqual(['new']);
  });

  test('each todo keeps its own newest question', () => {
    const stream = [
      report('a1', 'a', 'needs-you'),
      report('b1', 'b', 'needs-you'),
      report('a2', 'a', 'needs-you'),
    ];
    expect([...outstandingReportIds(stream)].sort()).toEqual(['a2', 'b1']);
  });

  test('a later report of another phase closes the earlier question', () => {
    const stream = [report('q', 'a', 'needs-you'), report('d', 'a', 'done')];
    expect([...outstandingReportIds(stream)]).toEqual([]);
  });

  test('a stream without needs-you reports has no outstanding question', () => {
    expect([...outstandingReportIds([report('d', 'a', 'failed')])]).toEqual([]);
  });
});
