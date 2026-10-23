// 通知 SSE 三事件对拍（02 §9.1 + r5 §7.2 实测矩阵，逐字段；04 §5 divergence
// 口径：in-app 层 1:1，无 Web Push）。
// - plan_ready（进 confirm）/ build_review（进 review，含定时轮停 review——
//   无独立「定时轮结束」类型）/ chief_message（snippet=消息全文）
// - 进 done、进 failed 无 in-app 通知事件（照抄）
// - 行 id = 组合键 "<userId>:<entityId>"（同键 upsert）；channels 恒 ["in_app"]
// - 未读联动：GET /api/teams/{id}/notifications → unreadThreadIds

import { notificationEventSchema, notificationRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent, chiefThread, notification, plan as planTable } from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { completeStep, startBuilds } from '../src/services/builds.js';
import { notifyChiefMessage } from '../src/services/notifications.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, openStream, postProject, req, type TestServer } from './helpers.js';

async function withRunningTodo(
  opts: {
    withPlan?: boolean;
    triggerSource?: 'user' | 'schedule';
    assignAgent?: boolean;
    pingIntervalMs?: number;
  } = {},
) {
  const s = bootServer({ pingIntervalMs: opts.pingIntervalMs });
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '写周报', spec: '' })
  ).json()) as { id: string; projectId: string; title: string; seqNum: number };
  // 执行侧 Agent（r5 §7.2 agent{name,avatarUrl} 归因源；wire 行经 members 面）。
  const agentId = newRecordId();
  if (opts.assignAgent !== false) {
    s.db
      .insert(agent)
      .values({
        id: agentId,
        teamId: s.team.id,
        displayName: '小林',
        description: null,
        status: 'active',
        avatarUrl: null,
        provider: null,
        modelId: null,
        thinkingLevel: null,
        // XMON-77：本世界走 /merge 202，合并闸要求 build 槽 Agent 持两开关。
        tools: ['合并分支', '推送分支'],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
      })
      .run();
  }
  const assignment =
    opts.assignAgent === false ? { plan: null, build: null } : { plan: null, build: { agentId } };
  const builds = startBuilds(s.svc, {
    projectId,
    todoIds: [todoDoc.id],
    assignment,
    withPlan: opts.withPlan ?? true,
    ...(opts.triggerSource ? { triggerSource: opts.triggerSource } : {}),
  });
  const buildId = builds[0]?.id;
  if (!buildId) throw new Error('no build started');
  return { ...s, projectId, todoDoc, agentId, buildId };
}

function notificationFrames(stream: Awaited<ReturnType<typeof openStream>>) {
  return (timeoutMs = 300) =>
    stream.next((ev) => ev.type === 'notification', timeoutMs) as Promise<{
      type: 'notification';
      notification: Record<string, unknown>;
    }>;
}

/** plan.md 交接物落库（#113：无产物规划步不算成、不进 confirm——服务面直驱
 * 以直插 plan 行等价机器面产物回传）。 */
function insertPlanDoc(s: TestServer, buildId: string, id: string) {
  s.db
    .insert(planTable)
    .values({ id, buildId, version: 1, content: '# 方案', createdAt: Date.now() })
    .run();
}

describe('三事件矩阵（r5 §7.2 逐字段）', () => {
  test('进 confirm → plan_ready：事件形状逐字段 + channels 恒 in_app', async () => {
    const s = await withRunningTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning'); // 机器领规划步（M3 面前用服务面驱动）
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
        kind: string;
      }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-1'); // 交接物在先（#113）
      completeStep(s.svc, steps[0]?.id ?? ''); // 规划步成 → confirm

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame); // shared 单源全形状复验
      const n = ev.notification;
      expect(n).toMatchObject({
        id: `${s.user.id}:${s.todoDoc.id}`, // 组合键 "<userId>:<entityId>"（r5 §7.2 原样）
        teamId: s.team.id,
        userId: s.user.id,
        type: 'plan_ready',
        entityId: s.todoDoc.id, // todoId
        entityRef: { title: '写周报', projectId: s.projectId, seqNum: 1 },
        agent: { name: '小林', avatarUrl: null }, // assignment.build 槽归因
        snippet: null, // plan_ready/build_review = null（r5 §7.2）
        readAt: null,
        channels: ['in_app'], // 恒 in_app（R1 divergence，04 §5）
      });
      expect(Number.isInteger(n.createdAt)).toBe(true);
      expect(notificationRecordSchema.safeParse(n).success).toBe(true);
    } finally {
      stream.close();
    }
  });

  test('进 review → build_review；同 todo 二次事件 = 同键 upsert（单行、readAt 重置）', async () => {
    const s = await withRunningTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning');
      const stepsOf = async () =>
        (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
          id: string;
          kind: string;
        }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-2'); // 交接物在先（#113）
      completeStep(s.svc, (await stepsOf())[0]?.id ?? ''); // → confirm（plan_ready）
      await notificationFrames(stream)(3000);
      await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, { action: 'confirm' });
      const steps = await stepsOf();
      completeStep(s.svc, steps[steps.length - 1]?.id ?? ''); // 执行步成 → review

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification.type).toBe('build_review');
      expect(ev.notification.id).toBe(`${s.user.id}:${s.todoDoc.id}`);
      expect(ev.notification.entityRef).toEqual({
        title: '写周报',
        projectId: s.projectId,
        seqNum: 1,
      });
      expect(ev.notification.channels).toEqual(['in_app']);

      // 组合键 upsert：两次业务事件、同一行（站内未读按 thread 非按事件）。
      const rows = s.db
        .select()
        .from(notification)
        .where(eq(notification.entityId, s.todoDoc.id))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe('build_review');
      expect(rows[0]?.readAt).toBeNull();
    } finally {
      stream.close();
    }
  });

  test('定时轮停 review = build_review（无独立「定时轮结束」类型，r5 §7.2）', async () => {
    const s = await withRunningTodo({ withPlan: false, triggerSource: 'schedule' });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'building'); // 机器领直执行步
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
      }[];
      completeStep(s.svc, steps[0]?.id ?? ''); // → review

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification.type).toBe('build_review'); // triggerSource 仅在 build doc 上
    } finally {
      stream.close();
    }
  });

  test('进 done / 进 failed 无 in-app 通知事件（照抄 r5 §7.2 观测窗）', async () => {
    // 快 ping：无事件断言依赖心跳帧驱动 stream reader 的截止检查。
    const s = await withRunningTodo({ withPlan: false, pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'building');
      const stepsOf = async () =>
        (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
          id: string;
        }[];
      completeStep(s.svc, (await stepsOf())[0]?.id ?? ''); // → review（build_review 发出）
      await notificationFrames(stream)(3000);
      await req(s.app, 'POST', `/api/builds/${s.buildId}/merge`);
      const steps = await stepsOf();
      completeStep(s.svc, steps[steps.length - 1]?.id ?? ''); // 合并步成 → done

      // done 窗口内无 notification 帧（todo/build 文档事件照常）。
      await expect(notificationFrames(stream)()).rejects.toThrow();

      // failed 同判：另起一条 todo 走到 failed（done 为终态，不可重跑）。
      const second = (await (
        await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, {
          title: '修流水线',
          spec: '',
        })
      ).json()) as { id: string };
      startBuilds(s.svc, {
        projectId: s.projectId,
        todoIds: [second.id],
        assignment: { plan: null, build: null },
        withPlan: false,
      });
      setTodoPhase(s.svc, second.id, 'building');
      setTodoPhase(s.svc, second.id, 'failed');
      await expect(notificationFrames(stream)()).rejects.toThrow();
    } finally {
      stream.close();
    }
  });

  test('chief_message：snippet=消息全文，entityRef=thread title（projectId/seqNum null）', async () => {
    const s = await withRunningTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      const threadId = `chief-${newUuidv7()}`;
      const now = nowMs();
      s.db
        .insert(chiefThread)
        .values({
          id: threadId,
          chiefId: `chief-${s.user.id}-${s.team.id}`,
          userId: s.user.id,
          teamId: s.team.id,
          title: '部署检查',
          createdAt: now,
          updatedAt: now,
          sessionId: newUuidv7(),
          sessionOpenedAt: now,
        })
        .run();

      // Chief relay 挂接面归 M4；此处直驱服务面验证事件契约。
      const record = notifyChiefMessage(
        { db: s.db, hub: s.hub, user: s.user },
        {
          threadId,
          message: '已把 #2 派给小林，预计今天完成。',
          agent: { name: '总管', avatarUrl: null },
        },
      );
      expect(notificationRecordSchema.safeParse(record).success).toBe(true);

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification).toMatchObject({
        type: 'chief_message',
        entityId: threadId, // chief-threadId（02 §9.1）
        id: `${s.user.id}:${threadId}`,
        entityRef: { title: '部署检查', projectId: null, seqNum: null },
        agent: { name: '总管', avatarUrl: null },
        snippet: '已把 #2 派给小林，预计今天完成。', // 消息全文（r5 §7.2）
        channels: ['in_app'],
      });
    } finally {
      stream.close();
    }
  });

  test('未指派 Agent = 属主代行 [推断]；未读联动 GET notifications → unreadThreadIds', async () => {
    const s = await withRunningTodo({ assignAgent: false });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning');
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
      }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-3'); // 交接物在先（#113）
      completeStep(s.svc, steps[0]?.id ?? '');

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification.agent).toEqual({
        name: s.user.displayName,
        avatarUrl: s.user.avatarUrl,
      });

      // 未读联动（02 §9.1：站内未读 + 徽标）。
      const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/notifications`);
      const body = (await res.json()) as { unreadThreadIds: string[] };
      expect(body.unreadThreadIds).toContain(s.todoDoc.id);
    } finally {
      stream.close();
    }
  });
});
