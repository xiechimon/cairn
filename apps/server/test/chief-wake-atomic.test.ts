import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { chief, step } from '../src/db/schema.js';
import { fireDueChiefWakes, setChiefWake } from '../src/services/chief.js';
import { H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();

function deps() {
  return { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
}

function pendingWakeSteps() {
  return H.s.db
    .select()
    .from(step)
    .where(eq(step.buildId, H.threadId))
    .all()
    .filter((row) => String(row.prompt).includes('[wake:wake]'));
}

function storedWakes() {
  return H.s.db.select().from(chief).where(eq(chief.id, H.chiefId)).get()?.wakes ?? [];
}

describe('due Coordinator wakes are removed together with their step', () => {
  test('a failure while enqueueing one wake keeps that wake and still fires the others', () => {
    const first = setChiefWake(deps(), H.teamId, { at: 1, note: 'first', threadId: H.threadId });
    const second = setChiefWake(deps(), H.teamId, { at: 1, note: 'second', threadId: H.threadId });
    vi.spyOn(H.s.machineHub, 'wake').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() => fireDueChiefWakes(deps(), 2)).toThrow('killed between decision and act');
    expect(storedWakes().map((w) => w.id)).toEqual([first.id]);
    expect(pendingWakeSteps().map((row) => String(row.prompt).includes('second'))).toEqual([true]);
    expect(second.id).not.toBe(first.id);
  });

  test('the kept wake fires on the next tick and only once', () => {
    setChiefWake(deps(), H.teamId, { at: 1, note: 'first', threadId: H.threadId });
    vi.spyOn(H.s.machineHub, 'wake').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() => fireDueChiefWakes(deps(), 2)).toThrow();
    expect(pendingWakeSteps()).toHaveLength(0);
    fireDueChiefWakes(deps(), 3);
    fireDueChiefWakes(deps(), 4);
    expect(pendingWakeSteps()).toHaveLength(1);
    expect(storedWakes()).toEqual([]);
  });

  test('a wake that is not due yet stays', () => {
    const later = setChiefWake(deps(), H.teamId, { at: 100, threadId: H.threadId });
    fireDueChiefWakes(deps(), 2);
    expect(storedWakes().map((w) => w.id)).toEqual([later.id]);
    expect(pendingWakeSteps()).toHaveLength(0);
  });
});
