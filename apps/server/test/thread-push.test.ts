import {
  ASK_USER_QUESTION_KIND,
  DEFAULT_AUTONOMY_SETTINGS,
  type MergePolicy,
  type TodoSourceKind,
  type TriggerSource,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  build,
  gateState,
  plan,
  project,
  pushDigestItem,
  pushSubscription,
  schedule,
  step,
  todo,
} from '../src/db/schema.js';
import {
  applyStepFailure,
  applyStoppedStep,
  finishTodoDone,
  prepareStopForDone,
} from '../src/services/builds.js';
import { upsertMessage } from '../src/services/machine-deps.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createTodo, setTodoPhase } from '../src/services/todos.js';
import { bootServer, req } from './helpers.js';

function world(
  input: {
    triggerSource?: TriggerSource;
    sourceKind?: TodoSourceKind;
    userStarted?: boolean;
    policy?: MergePolicy;
  } = {},
) {
  const s = bootServer();
  s.db
    .insert(project)
    .values({
      id: 'project',
      name: 'Push tests',
      teamId: s.team.id,
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: input.policy ?? 'human' },
    })
    .run();
  const record = createTodo(s.svc, {
    teamId: s.team.id,
    projectId: 'project',
    title: 'Thread',
    spec: '',
    createdBy: input.userStarted === false ? null : s.user.id,
    ownerId: input.userStarted === false ? null : s.user.id,
    ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
  });
  s.db
    .insert(build)
    .values({
      id: 'build',
      todoId: record.id,
      triggerSource: input.triggerSource ?? 'user',
      withPlan: false,
      createdAt: Date.now(),
      prNumber: 42,
    })
    .run();
  if (input.triggerSource === 'schedule' && input.userStarted !== false) {
    s.db
      .insert(schedule)
      .values({
        id: 'recurring',
        teamId: s.team.id,
        projectId: 'project',
        todoId: record.id,
        kind: 'daily',
        tz: 'UTC',
        createdBy: s.user.id,
      })
      .run();
  }
  s.db
    .update(todo)
    .set({ latestBuildId: 'build', phase: 'building' })
    .where(eq(todo.id, record.id))
    .run();
  s.db
    .insert(pushSubscription)
    .values({
      id: 'sub',
      userId: s.user.id,
      teamId: s.team.id,
      endpoint: 'https://push.example/sub',
      p256dh: 'key',
      auth: 'auth',
      createdAt: Date.now(),
    })
    .run();
  return { ...s, record };
}

afterEach(() => vi.restoreAllMocks());

const sources = [null, 'github-issue', 'github-issue-self'] as const;
const terminalCases = (['user', 'chief', 'schedule'] as const).flatMap((triggerSource) =>
  sources.flatMap((sourceKind) =>
    (['done', 'failed'] as const).map((phase) => ({ triggerSource, sourceKind, phase })),
  ),
);

describe('terminal thread push routing', () => {
  test.each(terminalCases)(
    '$triggerSource / $sourceKind / $phase',
    async ({ triggerSource, sourceKind, phase }) => {
      const s = world({ triggerSource, ...(sourceKind ? { sourceKind } : {}) });
      const send = vi
        .spyOn(webpush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
      const startedAt = Date.now();
      if (phase === 'done') {
        finishTodoDone(s.svc, s.record.id, 'build');
        finishTodoDone(s.svc, s.record.id, 'build');
      } else {
        setTodoPhase(s.svc, s.record.id, phase);
        setTodoPhase(s.svc, s.record.id, phase);
      }
      const immediate = sourceKind !== 'github-issue';
      expect(send).toHaveBeenCalledTimes(immediate ? 1 : 0);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      const digest = s.db.select().from(pushDigestItem).all();
      expect(digest).toHaveLength(immediate ? 0 : 1);
      if (immediate)
        expect(JSON.parse(String(send.mock.calls[0]?.[1])).notification.navigate).toBe(
          `https://cairn.local/app/todo/${s.record.id}`,
        );
      if (phase === 'done' && !immediate) expect(digest[0]?.body).toContain('PR #42');
    },
  );

  test.each(['done', 'failed'] as const)('autonomous scheduled %s remains digest-only', (phase) => {
    const s = world({ triggerSource: 'schedule', userStarted: false });
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, phase);
    expect(send).not.toHaveBeenCalled();
    expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
  });
});

test('one-shot user schedule retains push intent after the schedule is deleted', () => {
  const s = world({ triggerSource: 'schedule', userStarted: false });
  s.db.update(todo).set({ phase: 'todo' }).where(eq(todo.id, s.record.id)).run();
  s.db
    .insert(schedule)
    .values({
      id: 'once',
      teamId: s.team.id,
      projectId: 'project',
      todoId: s.record.id,
      kind: 'once',
      at: Date.now() - 1,
      nextRunAt: Date.now() - 1,
      tz: 'UTC',
      createdBy: s.user.id,
    })
    .run();
  const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
  scheduler.tick();
  scheduler.stop();
  expect(s.db.select().from(schedule).all()).toHaveLength(0);
  const current = s.db.select().from(todo).where(eq(todo.id, s.record.id)).get();
  if (current?.latestBuildId == null) throw new Error('Missing scheduled build');
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, s.record.id, 'building');
  finishTodoDone(s.svc, s.record.id, current.latestBuildId);
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('manual completion does not push to its operator', async () => {
  const s = world();
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  expect((await req(s.app, 'PATCH', `/api/todos/${s.record.id}`, { phase: 'done' })).status).toBe(
    200,
  );
  expect((await req(s.app, 'PATCH', `/api/todos/${s.record.id}`, { phase: 'done' })).status).toBe(
    200,
  );
  expect(send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

test('completion reserved until a claimed step stops does not push to its operator', () => {
  const s = world();
  s.db
    .insert(step)
    .values({
      id: 'claimed',
      buildId: 'build',
      kind: 'build',
      status: 'claimed',
      createdAt: Date.now(),
    })
    .run();
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  expect(prepareStopForDone(s.svc, s.record.id)).toEqual({ state: 'stopping' });
  expect(send).not.toHaveBeenCalled();
  applyStoppedStep(s.svc, 'claimed');
  applyStoppedStep(s.svc, 'claimed');
  expect(send).not.toHaveBeenCalled();
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
});

describe('human attention push', () => {
  test.each(['confirm', 'review'] as const)('human %s gate pushes once', (phase) => {
    const s = world();
    s.db
      .update(todo)
      .set({ phase: phase === 'confirm' ? 'planning' : 'building' })
      .where(eq(todo.id, s.record.id))
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, phase);
    setTodoPhase(s.svc, s.record.id, phase);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(send.mock.calls[0]?.[1])).notification.navigate).toContain(
      `/app/todo/${s.record.id}`,
    );
  });

  test.each(['shadow', 'autonomous'] as const)('%s machine review does not push', (policy) => {
    const s = world({ policy });
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, 'review');
    expect(send).not.toHaveBeenCalled();
  });

  test.each([['phase-not-review'], ['work-in-flight'], ['phase-not-review', 'work-in-flight']])(
    'PR review entry defers building-era blockers %j until evaluation',
    (...codes) => {
      const s = world();
      const at = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(at);
      s.db
        .update(project)
        .set({ repoKind: 'github', githubRepo: 'owner/repository' })
        .where(eq(project.id, 'project'))
        .run();
      s.db
        .insert(gateState)
        .values({
          buildId: 'build',
          ready: false,
          policy: 'human',
          headSha: null,
          patchDigest: null,
          blockers: [
            { code: 'policy-human', class: 'policy', label: 'Human review required', detail: [] },
            ...codes.map((code) => ({
              code,
              class: 'transient' as const,
              label: code,
              detail: [],
            })),
          ],
          evaluatedAt: at - 1_000,
        })
        .run();
      const send = vi
        .spyOn(webpush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
      setTodoPhase(s.svc, s.record.id, 'review');
      setTodoPhase(s.svc, s.record.id, 'review');
      expect(send).not.toHaveBeenCalled();
      expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
    },
  );

  test.each(['checks-pending', 'work-in-flight'])(
    'a current machine blocker %s still suppresses the human-policy review push',
    (code) => {
      const s = world();
      vi.spyOn(Date, 'now').mockReturnValue(Date.now());
      s.db
        .insert(gateState)
        .values({
          buildId: 'build',
          ready: false,
          policy: 'human',
          headSha: null,
          patchDigest: null,
          blockers: [{ code, class: 'transient', label: 'Machine work pending', detail: [] }],
          evaluatedAt: Date.now(),
        })
        .run();
      const send = vi
        .spyOn(webpush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
      setTodoPhase(s.svc, s.record.id, 'review');
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('an autonomous review with a human blocker handoff pushes once', () => {
    const s = world({ policy: 'autonomous' });
    s.db
      .insert(gateState)
      .values({
        buildId: 'build',
        ready: false,
        policy: 'autonomous',
        headSha: null,
        patchDigest: null,
        blockers: [
          { code: 'round-limit', class: 'human', label: 'Owner decision required', detail: [] },
        ],
        evaluatedAt: Date.now(),
      })
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, 'review');
    setTodoPhase(s.svc, s.record.id, 'review');
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('an open plan decision pushes even under autonomous policy', () => {
    const s = world({ policy: 'autonomous' });
    s.db.update(todo).set({ phase: 'planning' }).where(eq(todo.id, s.record.id)).run();
    s.db
      .insert(plan)
      .values({
        id: 'plan',
        buildId: 'build',
        version: 1,
        content: '## Decisions needed\n- Which target?',
        createdAt: Date.now(),
      })
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, 'confirm');
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('auto-confirmable plan does not push', () => {
    const s = world({ policy: 'autonomous' });
    s.db.update(todo).set({ phase: 'planning' }).where(eq(todo.id, s.record.id)).run();
    s.db
      .insert(plan)
      .values({
        id: 'plan',
        buildId: 'build',
        version: 1,
        content:
          'Kind: fix\n## Context\nA task\n## Changes\nA change\n## Edge cases\nNone\n## Verification\n- `pnpm test` passes\n',
        createdAt: Date.now(),
      })
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, 'confirm', { hasPlan: true });
    expect(send).not.toHaveBeenCalled();
  });

  test('worker question pushes once even when transcript delivery is retried', () => {
    const s = world({ policy: 'autonomous' });
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const row = {
      id: 'question',
      conversationId: 'build',
      role: 'assistant' as const,
      createdAt: Date.now(),
      content: JSON.stringify({
        kind: ASK_USER_QUESTION_KIND,
        requestId: 'question',
        status: 'pending',
        questions: [{ header: 'Decision', question: 'Which target?', options: [] }],
        answers: null,
      }),
    };
    upsertMessage(s.svc, row);
    upsertMessage(s.svc, row);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(send.mock.calls[0]?.[1])).notification.navigate).toContain(
      `/app/todo/${s.record.id}`,
    );
    expect(JSON.parse(String(send.mock.calls[0]?.[1])).notification.title).toBe('需要你决定');
    send.mockClear();
    setTodoPhase(s.svc, s.record.id, 'review');
    expect(send).not.toHaveBeenCalled();
  });

  test('autonomous failure stays digest-only when its error requests a human', () => {
    const s = world({ triggerSource: 'schedule', userStarted: false, policy: 'autonomous' });
    s.db
      .insert(step)
      .values({
        id: 'step',
        buildId: 'build',
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    const row = s.db.select().from(step).where(eq(step.id, 'step')).get();
    if (!row) throw new Error('Missing step');
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    applyStepFailure(s.svc, row, '转人工处理: blocked on an owner decision');
    expect(send).not.toHaveBeenCalled();
    expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
  });
});

test.each([
  ['confirm', '方案已就绪'],
  ['review', '构建待审核'],
  ['failed', '任务失败'],
  ['done', 'PR 已合并'],
] as const)('preserves the Chinese title for %s', (phase, title) => {
  const s = world();
  if (phase === 'confirm')
    s.db.update(todo).set({ phase: 'planning' }).where(eq(todo.id, s.record.id)).run();
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, s.record.id, phase);
  expect(send).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(String(send.mock.calls[0]?.[1])) as {
    notification: { title: string };
  };
  expect(payload.notification.title).toBe(title);
});

describe('thread viewing presence', () => {
  test.each([0, 59_999, 60_000] as const)(
    'presence age %d suppresses only the viewed thread before expiry',
    async (age) => {
      const s = world();
      const base = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(base);
      const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/presence`, {
        todoId: s.record.id,
        tabId: 'tab-a',
      });
      expect(response.status).toBe(200);
      vi.spyOn(Date, 'now').mockReturnValue(base + age);
      const send = vi
        .spyOn(webpush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
      setTodoPhase(s.svc, s.record.id, 'done');
      expect(send).toHaveBeenCalledTimes(age < 60_000 ? 0 : 1);
      const other = createTodo(s.svc, {
        teamId: s.team.id,
        projectId: 'project',
        title: 'Other thread',
        spec: '',
        createdBy: s.user.id,
        ownerId: s.user.id,
      });
      s.db
        .insert(build)
        .values({
          id: 'other-build',
          todoId: other.id,
          triggerSource: 'user',
          withPlan: false,
          createdAt: Date.now(),
        })
        .run();
      s.db
        .update(todo)
        .set({ phase: 'building', latestBuildId: 'other-build' })
        .where(eq(todo.id, other.id))
        .run();
      send.mockClear();
      setTodoPhase(s.svc, other.id, 'done');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  test('clearing a viewed thread immediately restores pushes and preserves other thread presence', async () => {
    const s = world();
    const other = createTodo(s.svc, {
      teamId: s.team.id,
      projectId: 'project',
      title: 'Other visible thread',
      spec: '',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    s.db
      .insert(build)
      .values({
        id: 'other-build',
        todoId: other.id,
        triggerSource: 'user',
        withPlan: false,
        createdAt: Date.now(),
      })
      .run();
    s.db
      .update(todo)
      .set({ phase: 'building', latestBuildId: 'other-build' })
      .where(eq(todo.id, other.id))
      .run();
    const path = `/api/teams/${s.team.id}/presence`;
    for (const todoId of [s.record.id, other.id])
      expect((await req(s.app, 'POST', path, { todoId, tabId: 'tab-a' })).status).toBe(200);
    expect((await req(s.app, 'DELETE', path, { todoId: s.record.id, tabId: 'tab-a' })).status).toBe(
      200,
    );
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, s.record.id, 'done');
    expect(send).toHaveBeenCalledTimes(1);
    setTodoPhase(s.svc, other.id, 'done');
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        await req(s.app, 'DELETE', '/api/teams/other/presence', {
          todoId: other.id,
          tabId: 'tab-a',
        })
      ).status,
    ).toBe(404);
  });

  test('rejects invalid presence bodies and foreign teams or threads', async () => {
    const s = world();
    for (const body of [{}, { todoId: '' }, { todoId: 7 }]) {
      expect((await req(s.app, 'POST', `/api/teams/${s.team.id}/presence`, body)).status).toBe(400);
    }
    expect(
      (
        await req(s.app, 'POST', '/api/teams/other/presence', {
          todoId: s.record.id,
          tabId: 'tab-a',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await req(s.app, 'POST', `/api/teams/${s.team.id}/presence`, {
          todoId: 'missing',
          tabId: 'tab-a',
        })
      ).status,
    ).toBe(404);
  });
});

test('clearing one tab retains suppression for another tab viewing the same thread', async () => {
  const s = world();
  const path = `/api/teams/${s.team.id}/presence`;
  for (const tabId of ['first', 'second'])
    expect((await req(s.app, 'POST', path, { todoId: s.record.id, tabId })).status).toBe(200);
  expect((await req(s.app, 'DELETE', path, { todoId: s.record.id, tabId: 'first' })).status).toBe(
    200,
  );
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, s.record.id, 'review');
  expect(send).not.toHaveBeenCalled();
  expect((await req(s.app, 'DELETE', path, { todoId: s.record.id, tabId: 'second' })).status).toBe(
    200,
  );
  setTodoPhase(s.svc, s.record.id, 'done');
  expect(send).toHaveBeenCalledTimes(1);
});
