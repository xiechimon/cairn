import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedule, step } from '../../src/db/schema.js';
import { scheduleChiefThreadTurn } from '../../src/services/chief.js';
import { createSchedule, serverTimezone } from '../../src/services/schedules.js';
import { boot, stub, world } from './runner-world.js';

afterEach(() => vi.useRealTimers());

describe('scheduled Coordinator turn timezone', () => {
  it('formats Now in the schedule timezone for scheduled turns and preserves server timezone for normal turns', async () => {
    const fixedNow = Date.UTC(2026, 10, 27, 1, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'], now: fixedNow });
    const w = await world('normal turn');
    const { faux, seen } = stub('ok');
    const coordinator = boot(w, faux);

    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(JSON.stringify(seen[0]?.messages)).toContain(`(${serverTimezone()})`);

    const shanghai = createSchedule(w.s.svc, {
      teamId: w.teamId,
      chiefThreadId: w.threadId,
      kind: 'daily',
      at: fixedNow,
      tz: 'Asia/Shanghai',
      prompt: '汇报当前时间',
      createdBy: w.s.user.id,
    });
    w.s.db.update(schedule).set({ nextRunAt: fixedNow }).where(eq(schedule.id, shanghai.id)).run();
    scheduleChiefThreadTurn(w.s.svc, {
      scheduleId: shanghai.id,
      teamId: w.teamId,
      threadId: w.threadId,
      prompt: shanghai.prompt,
      createdBy: w.s.user.id,
      now: fixedNow,
      expectedNextRunAt: fixedNow,
      nextRunAt: fixedNow + 86_400_000,
      recurring: true,
    });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(JSON.stringify(seen[1]?.messages)).toContain(
      'Now: 2026-11-27 09:00, Friday (Asia/Shanghai)',
    );

    const la = createSchedule(w.s.svc, {
      teamId: w.teamId,
      chiefThreadId: w.threadId,
      kind: 'daily',
      at: fixedNow,
      tz: 'America/Los_Angeles',
      prompt: 'Report current time',
      createdBy: w.s.user.id,
    });
    w.s.db.update(schedule).set({ nextRunAt: fixedNow }).where(eq(schedule.id, la.id)).run();
    scheduleChiefThreadTurn(w.s.svc, {
      scheduleId: la.id,
      teamId: w.teamId,
      threadId: w.threadId,
      prompt: la.prompt,
      createdBy: w.s.user.id,
      now: fixedNow,
      expectedNextRunAt: fixedNow,
      nextRunAt: fixedNow + 86_400_000,
      recurring: true,
    });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(JSON.stringify(seen[2]?.messages)).toContain(
      'Now: 2026-11-26 17:00, Thursday (America/Los_Angeles)',
    );

    const steps = w.s.db.select().from(step).all();
    expect(steps.filter((row) => row.status === 'done')).toHaveLength(3);
  });
});
