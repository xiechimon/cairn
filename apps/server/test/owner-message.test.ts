import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { chiefMessage } from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

afterEach(() => vi.useRealTimers());

function seededAt(content: string): number | undefined {
  const id = seedOwnerMessage(H.s.db, H.threadId, content);
  return H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, id)).get()?.createdAt;
}

describe('seedOwnerMessage timestamps', () => {
  test('seeds inside one millisecond stay ordered and later seeds return to the clock', () => {
    const start = Date.now() + 60_000;
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    expect([seededAt('first'), seededAt('second'), seededAt('third')]).toEqual([
      start,
      start + 1,
      start + 2,
    ]);
    vi.setSystemTime(start + 10);
    expect(seededAt('after the clock moved')).toBe(start + 10);
  });
});
