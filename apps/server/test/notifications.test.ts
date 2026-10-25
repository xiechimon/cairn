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

function insertPlanDoc(s: TestServer, buildId: string, id: string) {
  s.db
    .insert(planTable)
    .values({ id, buildId, version: 1, content: '# 方案', createdAt: Date.now() })
    .run();
}

describe('three-event matrix (r5 section 7.2 field by field)', () => {
  test('entering confirm -> plan_ready: event shape field by field + channels always in_app', async () => {
    const s = await withRunningTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning');
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
        kind: string;
      }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-1');
      completeStep(s.svc, steps[0]?.id ?? '');

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      const n = ev.notification;
      expect(n).toMatchObject({
        id: `${s.user.id}:${s.todoDoc.id}`,
        teamId: s.team.id,
        userId: s.user.id,
        type: 'plan_ready',
        entityId: s.todoDoc.id,
        entityRef: { title: '写周报', projectId: s.projectId, seqNum: 1 },
        agent: { name: '小林', avatarUrl: null },
        snippet: null,
        readAt: null,
        channels: ['in_app'],
      });
      expect(Number.isInteger(n.createdAt)).toBe(true);
      expect(notificationRecordSchema.safeParse(n).success).toBe(true);
    } finally {
      stream.close();
    }
  });

  test('entering review -> build_review; same todo second event = same-key upsert (single row, readAt reset)', async () => {
    const s = await withRunningTodo();
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning');
      const stepsOf = async () =>
        (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
          id: string;
          kind: string;
        }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-2');
      completeStep(s.svc, (await stepsOf())[0]?.id ?? '');
      await notificationFrames(stream)(3000);
      await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, { action: 'confirm' });
      const steps = await stepsOf();
      completeStep(s.svc, steps[steps.length - 1]?.id ?? '');

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

  test('scheduled round stops at review = build_review (no independent "scheduled round ended" type, r5 section 7.2)', async () => {
    const s = await withRunningTodo({ withPlan: false, triggerSource: 'schedule' });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'building');
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
      }[];
      completeStep(s.svc, steps[0]?.id ?? '');

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification.type).toBe('build_review');
    } finally {
      stream.close();
    }
  });

  test('entering done / entering failed has no in-app notification event (copied verbatim from the r5 section 7.2 observation window)', async () => {
    const s = await withRunningTodo({ withPlan: false, pingIntervalMs: 50 });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'building');
      const stepsOf = async () =>
        (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
          id: string;
        }[];
      completeStep(s.svc, (await stepsOf())[0]?.id ?? '');
      await notificationFrames(stream)(3000);
      await req(s.app, 'POST', `/api/builds/${s.buildId}/merge`);
      const steps = await stepsOf();
      completeStep(s.svc, steps[steps.length - 1]?.id ?? '');

      await expect(notificationFrames(stream)()).rejects.toThrow();

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

  test('chief_message: snippet=full message text, entityRef=thread title (projectId/seqNum null)', async () => {
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
        entityId: threadId,
        id: `${s.user.id}:${threadId}`,
        entityRef: { title: '部署检查', projectId: null, seqNum: null },
        agent: { name: '总管', avatarUrl: null },
        snippet: '已把 #2 派给小林，预计今天完成。',
        channels: ['in_app'],
      });
    } finally {
      stream.close();
    }
  });

  test('no Agent assigned = owner acts on its behalf [inferred]; unread linkage GET notifications -> unreadThreadIds', async () => {
    const s = await withRunningTodo({ assignAgent: false });
    const stream = await openStream(s.app, s.team.id);
    try {
      setTodoPhase(s.svc, s.todoDoc.id, 'planning');
      const steps = (await (await req(s.app, 'GET', `/api/builds/${s.buildId}/steps`)).json()) as {
        id: string;
      }[];
      insertPlanDoc(s, s.buildId, 'plan-ntf-3');
      completeStep(s.svc, steps[0]?.id ?? '');

      const frame = await notificationFrames(stream)(3000);
      const ev = notificationEventSchema.parse(frame);
      expect(ev.notification.agent).toEqual({
        name: s.user.displayName,
        avatarUrl: s.user.avatarUrl,
      });

      const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/notifications`);
      const body = (await res.json()) as { unreadThreadIds: string[] };
      expect(body.unreadThreadIds).toContain(s.todoDoc.id);
    } finally {
      stream.close();
    }
  });
});
