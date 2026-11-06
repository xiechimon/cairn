import { describe, expect, it } from 'vitest';
import { threadCopy } from '../src/board/thread-copy.js';
import type { TodoRecord } from '../src/fixtures/records.js';

function todo(over: Partial<TodoRecord>): TodoRecord {
  return { id: 't', phase: 'building', ...over } as TodoRecord;
}

const WAIT = { providerId: 'p', label: 'Stub Gateway', kind: 'quota' as const, retryAfterMs: null, probeAt: 0 };

describe('threadCopy', () => {
  it('a building task blocked on quota says it waits for quota, not that it is working', () => {
    expect(threadCopy(todo({ quotaWait: WAIT })).reason).toBe(
      '额度空了，等额度恢复后自动续跑。',
    );
  });

  it('a rate-limited task says it is rate limited', () => {
    expect(
      threadCopy(todo({ quotaWait: { ...WAIT, kind: 'capacity' as const } })).reason,
    ).toBe('被限流，等恢复后自动续跑。');
  });

  it('an ordinary building task still says it is working', () => {
    expect(threadCopy(todo({})).reason).toBe('正在动手。');
  });
});
