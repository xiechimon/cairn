import { chiefDigestThreadId, type ModelUsage, type StepKind } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  build,
  chiefThread,
  chiefTurnUsage,
  step as stepTable,
  stepUsage,
  todo,
  tokenUsage,
} from '../src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { recordStepUsage } from '../src/services/coordinator-steps.js';
import { dailyUsage } from '../src/services/usage-daily.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setCoordinatorServerContextEnabled(true);
});
afterEach(() => {
  setCoordinatorServerContextEnabled(false);
  vi.useRealTimers();
});

const SG = 'Asia/Singapore';
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-16T10:00:00+08:00');
const YESTERDAY = at('2026-11-15T10:00:00+08:00');

function deps() {
  return {
    ...H.s.svc,
    box: H.s.secretBox,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
  };
}

function addStep(id: string, buildId: string, kind: StepKind = 'chief') {
  H.s.db
    .insert(stepTable)
    .values({ id, buildId, kind, status: 'claimed', prompt: 'p', createdAt: Date.now() })
    .run();
  return H.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

function report(stepId: string, buildId: string, usage: ModelUsage[], kind: StepKind = 'chief') {
  const row =
    H.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get() ??
    addStep(stepId, buildId, kind);
  recordStepUsage(deps(), row, usage);
}

const u = (model: string, input: number): ModelUsage => ({
  model,
  input,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

function addBuild(id: string, createdAt: number) {
  H.s.db
    .insert(todo)
    .values({
      id: `todo-${id}`,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 't',
      phase: 'building',
      phaseAt: createdAt,
      seqNum: Math.floor(Math.random() * 1e6),
      latestBuildId: id,
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id,
      todoId: `todo-${id}`,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt,
    })
    .run();
}

function legacyOnly() {
  H.s.db.delete(stepUsage).run();
}

const daily = (days: number, tz = SG, now = NOW) =>
  dailyUsage(H.s.db, H.teamId, { days, tz, now }).days;

describe('recordStepUsage writes one step_usage row per step and model', () => {
  test('a task step records its team, build, kind and counts, with nothing mirrored', () => {
    vi.setSystemTime(NOW);
    addBuild('build-1', NOW);
    report(
      's1',
      'build-1',
      [{ model: 'm', input: 10, output: 2, cacheRead: 30, cacheWrite: 4 }],
      'build',
    );
    expect(H.s.db.select().from(stepUsage).all()).toEqual([
      {
        stepId: 's1',
        model: 'm',
        teamId: H.teamId,
        buildId: 'build-1',
        kind: 'build',
        input: 10,
        output: 2,
        cacheRead: 30,
        cacheWrite: 4,
        mirroredTokens: 0,
        createdAt: NOW,
      },
    ]);
  });

  test('a Pi Coordinator turn mirrors its total; a later report adds counts and keeps the first time', () => {
    vi.setSystemTime(YESTERDAY);
    report('t1', H.threadId, [u('m', 100)]);
    vi.setSystemTime(NOW);
    setCoordinatorServerContextEnabled(false);
    report('t1', H.threadId, [u('m', 40)]);
    expect(H.s.db.select().from(stepUsage).get()).toMatchObject({
      input: 140,
      mirroredTokens: 100,
      createdAt: YESTERDAY,
    });
  });

  test('empty usage and a step whose team cannot be resolved write no row', () => {
    report('t1', H.threadId, []);
    report('s-orphan', 'build-gone', [u('m', 5)], 'build');
    expect(H.s.db.select().from(stepUsage).all()).toEqual([]);
    expect(
      H.s.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, 'build-gone')).get()?.input,
    ).toBe(5);
  });

  test('a failure in the last write rolls back all three tables', () => {
    H.s.db.run(
      sql.raw(
        "CREATE TRIGGER fail_step_usage BEFORE INSERT ON step_usage BEGIN SELECT RAISE(ABORT, 'boom'); END",
      ),
    );
    const row = addStep('t1', H.threadId);
    expect(() => recordStepUsage(deps(), row, [u('m', 100)])).toThrow(/boom/);
    expect(H.s.db.select().from(tokenUsage).all()).toEqual([]);
    expect(H.s.db.select().from(chiefTurnUsage).all()).toEqual([]);
    H.s.db.run(sql.raw('DROP TRIGGER fail_step_usage'));
  });

  test('a deleted step keeps its usage on its day', () => {
    vi.setSystemTime(NOW);
    report('t1', H.threadId, [u('m', 100)]);
    H.s.db.delete(stepTable).where(eq(stepTable.id, 't1')).run();
    expect(daily(1)).toEqual([{ date: '2026-11-16', coordinator: 100, tasks: 0 }]);
  });
});

describe('dailyUsage groups tokens by local calendar day', () => {
  test('a midnight DST start keeps the previous evening out of the first day', () => {
    const tz = 'America/Havana';
    vi.setSystemTime(at('2026-03-08T04:30:00Z'));
    report('t-before', H.threadId, [u('m', 7)]);
    vi.setSystemTime(at('2026-03-08T05:30:00Z'));
    report('t-after', H.threadId, [u('m', 11)]);
    expect(daily(1, tz, at('2026-03-08T16:00:00Z'))).toEqual([
      { date: '2026-03-08', coordinator: 11, tasks: 0 },
    ]);
    expect(daily(2, tz, at('2026-03-08T16:00:00Z')).map((d) => d.date)).toEqual([
      '2026-03-07',
      '2026-03-08',
    ]);
  });

  test('rows on both sides of local midnight land on their own days in a half-hour zone', () => {
    const tz = 'America/St_Johns';
    vi.setSystemTime(at('2026-11-15T23:50:00-03:30'));
    report('a', H.threadId, [u('m', 3)]);
    vi.setSystemTime(at('2026-11-16T00:10:00-03:30'));
    report('b', H.threadId, [u('m', 5)]);
    expect(daily(3, tz, at('2026-11-16T12:00:00-03:30'))).toEqual([
      { date: '2026-11-15', coordinator: 3, tasks: 0 },
      { date: '2026-11-16', coordinator: 5, tasks: 0 },
    ]);
  });

  test('a Pi turn reported before and after the rollout keeps each part on its day', () => {
    vi.setSystemTime(YESTERDAY);
    report('t1', H.threadId, [u('a', 100)]);
    legacyOnly();
    vi.setSystemTime(NOW);
    report('t1', H.threadId, [u('a', 40), u('b', 9)]);
    expect(daily(2)).toEqual([
      { date: '2026-11-15', coordinator: 100, tasks: 0 },
      { date: '2026-11-16', coordinator: 49, tasks: 0 },
    ]);
  });

  test('a turn whose Pi flag changed across a restart is not moved to the thread day', () => {
    H.s.db
      .update(chiefThread)
      .set({ createdAt: at('2026-10-01T10:00:00+08:00') })
      .run();
    vi.setSystemTime(YESTERDAY);
    report('t1', H.threadId, [u('m', 100)]);
    legacyOnly();
    setCoordinatorServerContextEnabled(false);
    vi.setSystemTime(NOW);
    report('t1', H.threadId, [u('m', 40)]);
    expect(daily(60)).toEqual([
      { date: '2026-11-15', coordinator: 100, tasks: 0 },
      { date: '2026-11-16', coordinator: 40, tasks: 0 },
    ]);
  });

  test('legacy non-Pi and digest usage lands on its thread creation day, once', () => {
    const digest = chiefDigestThreadId(H.chiefId);
    H.s.db
      .insert(chiefThread)
      .values({
        id: digest,
        chiefId: H.chiefId,
        userId: H.userId,
        teamId: H.teamId,
        title: 'digest',
        createdAt: at('2026-11-10T09:00:00+08:00'),
        updatedAt: 0,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: 0,
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    H.s.db
      .update(chiefThread)
      .set({ createdAt: at('2026-11-12T09:00:00+08:00') })
      .where(eq(chiefThread.id, H.threadId))
      .run();
    vi.setSystemTime(at('2026-11-14T09:00:00+08:00'));
    report('pi-turn', H.threadId, [u('m', 70)]);
    setCoordinatorServerContextEnabled(false);
    report('off-turn', H.threadId, [u('m', 20)]);
    report('digest', digest, [u('m', 5)]);
    legacyOnly();
    setCoordinatorServerContextEnabled(true);
    vi.setSystemTime(NOW);
    report('new-turn', H.threadId, [u('m', 8)]);
    expect(daily(30)).toEqual([
      { date: '2026-11-10', coordinator: 5, tasks: 0 },
      { date: '2026-11-12', coordinator: 20, tasks: 0 },
      { date: '2026-11-14', coordinator: 70, tasks: 0 },
      { date: '2026-11-16', coordinator: 8, tasks: 0 },
    ]);
  });

  test('a legacy task counts its remainder on the build day and new steps on their own days', () => {
    addBuild('build-1', at('2026-11-14T09:00:00+08:00'));
    vi.setSystemTime(at('2026-11-14T10:00:00+08:00'));
    report('old', 'build-1', [u('m', 300)], 'build');
    legacyOnly();
    vi.setSystemTime(at('2026-11-01T10:00:00+08:00'));
    report('before-window', 'build-1', [u('m', 50)], 'build');
    vi.setSystemTime(NOW);
    report('new', 'build-1', [u('m', 25)], 'review');
    expect(daily(7)).toEqual([
      { date: '2026-11-14', coordinator: 0, tasks: 300 },
      { date: '2026-11-16', coordinator: 0, tasks: 25 },
    ]);
  });

  test('another team sees nothing', () => {
    vi.setSystemTime(NOW);
    report('t1', H.threadId, [u('m', 100)]);
    expect(dailyUsage(H.s.db, 'team-other', { days: 7, tz: SG, now: NOW }).days).toEqual([]);
  });
});

describe('GET /api/teams/:id/usage/daily', () => {
  const url = (q: string, team = H.teamId) => `/api/teams/${team}/usage/daily${q}`;

  test('returns the days and rejects a bad time zone, an out-of-range window and another team', async () => {
    vi.setSystemTime(Date.now());
    report('t1', H.threadId, [u('m', 12)]);
    const ok = await req(H.s.app, 'GET', url('?days=7&tz=Asia/Singapore'));
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as { days: { coordinator: number }[] }).days.at(-1)?.coordinator,
    ).toBe(12);
    expect((await req(H.s.app, 'GET', url('?days=7&tz=Mars/Base'))).status).toBe(400);
    expect((await req(H.s.app, 'GET', url('?days=0&tz=UTC'))).status).toBe(400);
    expect((await req(H.s.app, 'GET', url('?days=372&tz=UTC'))).status).toBe(400);
    expect((await req(H.s.app, 'GET', url('?days=7&tz=UTC', 'team-other'))).status).toBe(404);
  });
});
