import { describe, expect, test } from 'vitest';
import { mapChiefStream } from '../src/api/mappers.js';

const REPORT = {
  kind: 'thread-report',
  todoId: 't1',
  phase: 'review',
  seqNum: 3,
  title: 'Export',
};

describe('thread report items with the session line', () => {
  test('the stream mapper keeps the line on the report item', () => {
    const rows = [
      {
        id: 'a',
        role: 'system' as const,
        content: JSON.stringify({ ...REPORT, line: 'Short line' }),
        createdAt: 1,
      },
    ];
    expect(mapChiefStream(rows)).toEqual([{ ...REPORT, id: 'a', line: 'Short line' }]);
  });

  test('the stream mapper keeps a needs-you report and its line', () => {
    const rows = [
      {
        id: 'a',
        role: 'system' as const,
        content: JSON.stringify({ ...REPORT, phase: 'needs-you', line: 'Which format?' }),
        createdAt: 1,
      },
    ];
    expect(mapChiefStream(rows)).toEqual([
      { ...REPORT, phase: 'needs-you', id: 'a', line: 'Which format?' },
    ]);
  });
});
