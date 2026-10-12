// 定时面 E2E（02 §9.2 词表照抄 + 04 §4 M2 场景清单：「定时 CRUD + 触发闭环
// （00/15/30/45 分档、once 出队）」）。闭环真值 = r3 §9 实测（触发→新 build
// 全新重跑、时间线数据面 triggerSource:"schedule"、once 出队 → GET → []）+
// r5 §8 复核（触发时停驻关口旧 build errorMessage:"Cancelled"、分档四值）。
// 调度驱动 = scheduler.tick(now) 直接调用（确定性；真实时间循环 = index.ts）。

import {
  type BuildRecord,
  type ScheduleRecord,
  scheduleRecordSchema,
  type TodoRecord,
  todoRecordSchema,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { machine as machineTable, todo as todoTable } from '../src/db/schema.js';
import { completeStep, listSteps } from '../src/services/builds.js';
import { createScheduler } from '../src/services/scheduler.js';
import { serverTimezone, wallClockParts } from '../src/services/schedules.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

/** Asia/Shanghai = UTC+8 恒定（无 DST）——周期档断言用固定偏移。 */
const TZ = 'Asia/Shanghai';

const servers: TestServer[] = [];
function boot() {
  const s = bootServer();
  servers.push(s);
  return s;
}
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function withTodo(title = '每天巡检 r3-lifecycle') {
  const s = boot();
  const projectId = await postProject(s.app, 'r3-lifecycle');
  const todoDoc = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title, spec: '巡检 README' })
    ).json(),
  );
  const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
  return { ...s, projectId, todoDoc, scheduler };
}

async function buildsOf(s: TestServer, projectId: string): Promise<BuildRecord[]> {
  return (await (
    await req(s.app, 'GET', `/api/projects/${projectId}/builds`)
  ).json()) as BuildRecord[];
}

async function todoOf(s: TestServer, todoId: string): Promise<TodoRecord> {
  return todoRecordSchema.parse(await (await req(s.app, 'GET', `/api/todos/${todoId}`)).json());
}

/** 直执行一轮到 review（机器面驱动 = M3；此处按 02 §4.1 语义推进）。 */
async function runToReview(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const started = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: null, build: null },
      withPlan: false,
    })
  ).json()) as { builds: BuildRecord[] };
  const buildId = started.builds[0]?.id as string;
  setTodoPhase(s.svc, todoId, 'building');
  completeStep(s.svc, listSteps(s.svc, buildId)[0]?.id as string);
  return buildId;
}

/** review → merge 202 → 合并步成 → done（02 §4.2 主时序尾段）。 */
async function runToDone(s: TestServer, projectId: string, todoId: string): Promise<void> {
  const buildId = await runToReview(s, projectId, todoId);
  await req(s.app, 'POST', `/api/builds/${buildId}/merge`);
  const steps = listSteps(s.svc, buildId);
  completeStep(s.svc, steps[steps.length - 1]?.id as string);
}

describe('定时 CRUD（record = r3 §8.3 实测原样）', () => {
  test('POST /api/schedules once → 201 ScheduleRecord（at=nextRunAt，内嵌 todo 摘要）', async () => {
    const s = await withTodo();
    const at = new Date('2026-09-24T14:30:00+08:00').getTime(); // 分档 30 ✓
    const res = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
    });
    expect(res.status).toBe(201);
    const record = scheduleRecordSchema.parse(await res.json());
    expect(record).toMatchObject({
      teamId: s.team.id,
      projectId: s.projectId,
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
      nextRunAt: at, // once：at 即触发时刻
      createdBy: s.user.id,
    });
    // 内嵌 todo 摘要（r3 §8.3：seqNum/title/phase/projectName/ownerId）
    expect(record.todo).toEqual({
      seqNum: s.todoDoc.seqNum,
      title: s.todoDoc.title,
      phase: 'todo',
      projectName: 'r3-lifecycle',
      ownerId: s.user.id,
    });
  });

  test('GET /api/schedules?team=（参数名 team，02 §6.1 实测原样）；未知 team 404', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-24T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    const list = (await (
      await req(s.app, 'GET', `/api/schedules?team=${s.team.id}`)
    ).json()) as ScheduleRecord[];
    expect(list).toHaveLength(1);
    expect(scheduleRecordSchema.safeParse(list[0]).success).toBe(true);
    expect((await req(s.app, 'GET', '/api/schedules?team=nope')).status).toBe(404);
  });

  test('DELETE /api/schedules/{id} → 204；再删 404（DELETE_FACE [推断] 同名）', async () => {
    const s = await withTodo();
    const created = (await (
      await req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        tz: TZ,
      })
    ).json()) as ScheduleRecord;
    expect((await req(s.app, 'DELETE', `/api/schedules/${created.id}`)).status).toBe(204);
    expect((await req(s.app, 'DELETE', `/api/schedules/${created.id}`)).status).toBe(404);
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test('校验面：单次分档外分钟 400（00/15/30/45 四档，r5 §8）；坏 body 400；未知 todo 404', async () => {
    const s = await withTodo();
    // 14:07 → 分档外（四档绑定单次，02 §9.2「单次=日期+时间（分 00/15/30/45）」）
    await expect(
      req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at: new Date('2026-09-24T14:07:00+08:00').getTime(),
        tz: TZ,
      }).then(async (r) => {
        expect(r.status).toBe(400);
        expect(Object.keys((await r.json()) as Record<string, unknown>)).toEqual(['error']);
      }),
    ).resolves.toBeUndefined();
    // 周期档锚点不做分档收窄（picker 共用未分离观测 [推断]）：09:05 daily 放行
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'daily',
          at: new Date('2026-09-01T09:05:00+08:00').getTime(),
          tz: TZ,
        })
      ).status,
    ).toBe(201);
    // 四档全过（同小时 00/15/30/45）
    for (const minute of [0, 15, 30, 45]) {
      const at = new Date(`2026-09-24T14:${String(minute).padStart(2, '0')}:00+08:00`).getTime();
      const res = await req(s.app, 'POST', '/api/schedules', {
        todoId: s.todoDoc.id,
        kind: 'once',
        at,
        tz: TZ,
      });
      expect(res.status, `minute ${minute}`).toBe(201);
    }
    // 缺 at → 400；未知 todo → 404；project 不匹配 → 400
    expect(
      (await req(s.app, 'POST', '/api/schedules', { todoId: s.todoDoc.id, kind: 'once' })).status,
    ).toBe(400);
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: 'nope',
          kind: 'once',
          at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          projectId: 'other-project',
          kind: 'once',
          at: new Date('2026-09-24T00:00:00+08:00').getTime(),
        })
      ).status,
    ).toBe(400);
  });

  test('tz 缺省 = server 本地时区（tz 注「按你的本地时区运行（…）」，01 §4.2）', async () => {
    const s = await withTodo();
    const now = Date.now();
    const at = Math.ceil((now + 3_600_000) / 900_000) * 900_000; // 未来整刻（15min 对齐）
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', { todoId: s.todoDoc.id, kind: 'once', at })
      ).json(),
    );
    expect(record.tz).toBe(serverTimezone());
  });
});

describe('周期档 nextRunAt（cron tz 感知；hourly/daily/weekly 枚举词 [推断] 02 §6.2）', () => {
  test('daily：下一落点 = tz 墙钟 14:30，严格晚于创建时刻', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T14:30:00+08:00').getTime(); // 锚 = 墙钟 14:30
    const t0 = Date.now();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'daily',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    expect(next).toBeGreaterThan(t0);
    expect(next - t0).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
    const parts = wallClockParts(next, TZ);
    expect(parts).toMatchObject({ hour: 14, minute: 30 });
    expect(next % 1000).toBe(0); // 整分落点
  });

  test('hourly：下一落点 = 每小时的 45 分（分档锚）', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T09:45:00+08:00').getTime();
    const t0 = Date.now();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    expect(next).toBeGreaterThan(t0);
    expect(next - t0).toBeLessThanOrEqual(3_600_000 + 60_000);
    expect(wallClockParts(next, TZ).minute).toBe(45);
  });

  test('weekly：下一落点 = 锚的星期 + 墙钟（周三 09:00）', async () => {
    const s = await withTodo();
    // 2026-09-23 = 周三；锚取过去某周三 09:00 CST
    const anchor = new Date('2026-09-23T09:00:00+08:00').getTime();
    const record = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'weekly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const next = record.nextRunAt as number;
    const nextDate = new Date(next);
    // tz 内星期 = 周三（用 en-US weekday 独立核对）
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(
      nextDate,
    );
    expect(weekday).toBe('Wed');
    expect(wallClockParts(next, TZ)).toMatchObject({ hour: 9, minute: 0 });
    expect(next - Date.now()).toBeLessThanOrEqual(7 * 24 * 3_600_000 + 60_000);
  });
});

describe('触发闭环 E2E（04 §4 M2：触发 → 新 build 全新重跑，r3 §9）', () => {
  test('once 到期 tick → 新 build triggerSource:"schedule" + todo queued + 自动出队', async () => {
    const s = await withTodo();
    const at = new Date('2026-09-23T00:00:00+08:00').getTime(); // 已过期 → 立即到期
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at,
      tz: TZ,
      // #1259 起定时步的机器面 = 指派 Agent 的归属机（schedule 钉选槽退役）。
    });
    s.scheduler.tick();
    // 新 build：全新重跑（直执行 withPlan:false，观测轮 32s 直达审核关口 [推断]）
    const builds = await buildsOf(s, s.projectId);
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      todoId: s.todoDoc.id,
      triggerSource: 'schedule', // 时间线「由定时发起」的数据面（呈现归 web）
      withPlan: false,
      prevPhase: 'todo',
    });
    // todo → queued（等空闲机器；机器执行面归 M3）
    const t = await todoOf(s, s.todoDoc.id);
    expect(t.phase).toBe('queued');
    expect(t.latestBuildId).toBe(builds[0]?.id);
    // once 触发后自动出队（r3 §9：GET /api/schedules?team= → []）
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toEqual([]);
    // 步队列：直执行 → 执行步入队（A6 server 持有）
    const steps = listSteps(s.svc, builds[0]?.id as string);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('build');
  });

  test('done 复跑（r3 §9 实测：已完成 → 到点全新重跑回到执行中→待验收语义）', async () => {
    const s = await withTodo();
    await runToDone(s, s.projectId, s.todoDoc.id);
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('done');
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.scheduler.tick();
    const builds = await buildsOf(s, s.projectId);
    expect(builds).toHaveLength(2);
    const rerun = builds.find((b) => b.triggerSource === 'schedule');
    expect(rerun?.prevPhase).toBe('done');
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('queued');
    // 运行历史两行（r3 §3.8）
    expect((await todoOf(s, s.todoDoc.id)).buildHistory).toHaveLength(2);
  });

  test('review 停驻轮被顶替：旧 build errorMessage:"Cancelled"（r5 §8 实测）', async () => {
    const s = await withTodo();
    const oldBuildId = await runToReview(s, s.projectId, s.todoDoc.id);
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('review');
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.scheduler.tick();
    const oldBuild = (await (await req(s.app, 'GET', `/api/builds/${oldBuildId}`)).json()) as
      | BuildRecord
      | { error: string };
    expect(oldBuild).toMatchObject({ id: oldBuildId, errorMessage: 'Cancelled' });
    const t = await todoOf(s, s.todoDoc.id);
    expect(t.phase).toBe('queued');
    const builds = await buildsOf(s, s.projectId);
    expect(builds.find((b) => b.triggerSource === 'schedule')?.prevPhase).toBe('review');
  });

  test('周期档触发后滚动 nextRunAt（行保留，once 出队对照组）', async () => {
    const s = await withTodo();
    const anchor = new Date('2026-09-01T00:00:00+08:00').getTime(); // 每小时 00 分
    const created = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    const firstNext = created.nextRunAt as number;
    s.scheduler.tick(firstNext + 1_000); // 到期后 1s
    const after = scheduleRecordSchema.parse(
      ((await (await req(s.app, 'GET', '/api/schedules')).json()) as ScheduleRecord[])[0],
    );
    expect(after.id).toBe(created.id); // 未出队
    expect(after.nextRunAt as number).toBeGreaterThan(firstNext); // 滚动到下一小时档
    expect(wallClockParts(after.nextRunAt as number, TZ).minute).toBe(0);
    // 触发产生了 schedule build
    expect((await buildsOf(s, s.projectId))[0]?.triggerSource).toBe('schedule');
  });

  test('进行中 phase 不抢占：本轮跳过、周期档仍滚动 [设计]', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', `/api/projects/${s.projectId}/builds`, {
      todoIds: [s.todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: false,
    }); // → queued（进行中）
    // #706：同 tick 兼跑 worker 步失联扫尾——合成 now 越过 120s 阈值时，
    // pending 步 + 团队零在线机器会被收尾；本测试意图是调度抢占，在线机器
    // 使手动 build 的 pending 步走合法排队分支，断言焦点不变（在线位置位
    // 直写 DB，生产置位路径归 machine-wire 面）。
    s.db
      .insert(machineTable)
      .values({
        id: 'machine-schedule-no-preempt',
        teamId: s.team.id,
        name: 'sched-box',
        online: true,
      })
      .run();
    const anchor = new Date('2026-09-01T00:15:00+08:00').getTime();
    const created = scheduleRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: s.todoDoc.id,
          kind: 'hourly',
          at: anchor,
          tz: TZ,
        })
      ).json(),
    );
    s.scheduler.tick((created.nextRunAt as number) + 1_000);
    expect(await buildsOf(s, s.projectId)).toHaveLength(1); // 只有手动 build，未新增
    expect((await todoOf(s, s.todoDoc.id)).phase).toBe('queued'); // 未被顶替
    const after = scheduleRecordSchema.parse(
      ((await (await req(s.app, 'GET', '/api/schedules')).json()) as ScheduleRecord[])[0],
    );
    expect(after.nextRunAt as number).toBeGreaterThan(created.nextRunAt as number);
  });

  test('孤儿自愈：todo 已删 → 出队 [设计]', async () => {
    const s = await withTodo();
    await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoDoc.id,
      kind: 'once',
      at: new Date('2026-09-23T00:00:00+08:00').getTime(),
      tz: TZ,
    });
    s.db.delete(todoTable).where(eq(todoTable.id, s.todoDoc.id)).run();
    s.scheduler.tick();
    const list = (await (await req(s.app, 'GET', '/api/schedules')).json()) as unknown[];
    expect(list).toEqual([]);
    expect(await buildsOf(s, s.projectId)).toHaveLength(0);
  });
});
