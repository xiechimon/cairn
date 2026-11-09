import { describe, expect, test } from 'vitest';
import { searchMemoryEntries } from '../src/services/memory.js';

describe('overflow goes through search', () => {
  test('searchMemoryEntries needs every term, case and width folded', () => {
    const entries = [
      { title: 'Deploy', content: 'Use the Queue' },
      { title: 'Other', content: 'queue only' },
    ];
    expect(searchMemoryEntries(entries, 'deploy QUEUE')).toEqual([entries[0]]);
    expect(searchMemoryEntries(entries, '   ')).toHaveLength(2);
    expect(searchMemoryEntries(entries, 'absent')).toEqual([]);
  });
});
