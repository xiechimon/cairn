import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  agent,
  build,
  chief,
  chiefMessage,
  gateState,
  message,
  project,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import { finishTodoDone, requestMerge } from '../src/services/builds.js';
import { transitionTodos } from '../src/services/chief-tools.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { recordCorrectionGuard } from '../src/services/correction.js';
import { DONE_ROW } from '../src/services/delivery-rows.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createIssueIntake } from '../src/services/issue-intake.js';
import { correctionDoneCheck } from '../src/services/merge-gate/correction.js';
import { createPrFeedbackPoller, PR_FEEDBACK_INTERVAL_MS } from '../src/services/pr-feedback.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createTodo, setTodoPhase, updateTodo } from '../src/services/todos.js';
import { githubFake, mergeGithubFake } from './fakes/github.js';
import { bootServer, req } from './helpers.js';

const REPO = 'octo/demo';
const feedback = (id: number, login = 'reviewer', body = `Fix case ${id}`) => ({
  id,
  user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' },
  body,
  created_at: '2026-10-31T00:00:00Z',
});

async function world(prime = true) {
  const gh = githubFake(REPO);
  gh.state.permissions.set('reviewer', { body: { permission: 'write', role_name: 'write' } });
  const s = bootServer({ githubFetch: gh.impl });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'owner', accessToken: 'fake-token', scope: 'repo' },
  );
  const res = await req(s.app, 'POST', '/api/projects', {
    name: 'Project',
    kind: 'github',
    githubRepo: REPO,
  });
  expect(res.status).toBe(201);
  const projectId = ((await res.json()) as { id: string }).id;
  s.db
    .update(project)
    .set({
      autonomy: {
        enabled: true,
        quietMinutes: 0,
        cooldownMinutes: 0,
        dailyBudgetUsd: 0,
      },
    })
    .where(eq(project.id, projectId))
    .run();
  const task = createTodo(s.svc, {
    teamId: s.team.id,
    projectId,
    title: 'Thread',
    spec: '',
    createdBy: s.user.id,
    ownerId: s.user.id,
  });
  s.db
    .insert(build)
    .values({
      id: 'build-feedback',
      todoId: task.id,
      withPlan: false,
      triggerSource: 'user',
      prNumber: 42,
      prUrl: `https://github.com/${REPO}/pull/42`,
      createdAt: Date.now(),
    })
    .run();
  s.db
    .update(todo)
    .set({ latestBuildId: 'build-feedback', phase: 'review' })
    .where(eq(todo.id, task.id))
    .run();
  gh.state.pulls.set(42, { state: 'open', merged: false });
  const deps = { ...s.svc, box: s.secretBox, githubFetch: gh.impl };
  if (prime) await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
  return { s, gh, deps, projectId, task };
}

function userMessages(s: ReturnType<typeof bootServer>) {
  return s.db.select().from(message).where(eq(message.role, 'user')).all();
}

describe('PR feedback backflow', () => {
  test('first sight persists historical high-water marks across restart and only dispatches newer feedback once', async () => {
    const { s, gh, deps } = await world(false);
    gh.state.comments.set(42, [feedback(50)]);
    gh.state.reviewComments.set(42, [feedback(70)]);
    gh.state.reviews.set(42, [{ ...feedback(90), state: 'CHANGES_REQUESTED' }]);
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(0);
    expect(s.db.select().from(step).all()).toHaveLength(0);
    const restarted = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
    await restarted.sweep();
    gh.state.comments.set(42, [feedback(50), feedback(51)]);
    await restarted.sweep();
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(userMessages(s)[0]?.content).toContain('Fix case 51');
  });

  test.each(['before', 'after'] as const)(
    'a PR created %s team polling starts preserves the correct first-poll feedback policy across restart',
    async (position) => {
      const { s, gh, deps } = await world(false);
      const startedAt = Date.parse('2026-10-31T01:00:00Z');
      const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
      try {
        s.db.update(build).set({ prNumber: null }).run();
        await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
        now.mockReturnValue(startedAt + 120_000);
        s.db.update(build).set({ prNumber: 42 }).run();
        gh.overrides.set(`/repos/${REPO}/pulls/42`, () => ({
          body: {
            state: 'open',
            merged: false,
            created_at: new Date(
              startedAt + (position === 'after' ? 60_000 : -60_000),
            ).toISOString(),
          },
        }));
        gh.state.comments.set(42, [feedback(1)]);
        gh.state.reviewComments.set(42, [feedback(2)]);
        gh.state.reviews.set(42, [{ ...feedback(3), state: 'CHANGES_REQUESTED' }]);
        await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
        expect(userMessages(s)).toHaveLength(position === 'after' ? 3 : 0);
        gh.state.comments.set(42, [feedback(1), feedback(4)]);
        await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
        expect(userMessages(s)).toHaveLength(position === 'after' ? 4 : 1);
      } finally {
        now.mockRestore();
      }
    },
  );

  test('unchanged sweeps use four conditional reads and cache collaborator permission until its TTL expires', async () => {
    const { s, gh, deps } = await world();
    const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      gh.state.reviewComments.set(42, [feedback(1, 'reader')]);
      await poller.sweep();
      const before = gh.calls.length;
      await poller.sweep();
      expect(gh.calls.slice(before).map((call) => call.status)).toEqual([304, 304, 304, 304]);
      expect(gh.permissionReads('reader')).toHaveLength(1);
      now.mockReturnValue(now() + 60 * 60_000);
      await poller.sweep();
      expect(gh.permissionReads('reader')).toHaveLength(2);
      expect(userMessages(s)).toHaveLength(0);
    } finally {
      now.mockRestore();
    }
  });

  test('the connection owner can comment and request changes on their own PR while generated markers are ignored', async () => {
    const { s, gh, deps } = await world();
    gh.state.pulls.set(42, { state: 'open', merged: false, user: { login: 'owner' } });
    gh.state.permissions.set('owner', { body: { permission: 'admin' } });
    gh.state.reviewComments.set(42, [
      feedback(1, 'owner'),
      feedback(2, 'reviewer', '<!-- review-gate:abc --> PASS'),
      feedback(3, 'reviewer', '<!-- review-gate-pending:abc --> Pending'),
      feedback(4, 'reviewer', '<!-- cairn-dedupe: test --> Generated'),
      feedback(5),
    ]);
    gh.state.reviews.set(42, [
      { ...feedback(1, 'owner', 'Owner requests changes'), state: 'CHANGES_REQUESTED' },
    ]);
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(3);
    expect(
      userMessages(s)
        .map((row) => row.content)
        .join('\n'),
    ).toContain('Owner requests changes');
    expect(
      userMessages(s)
        .map((row) => row.content)
        .join('\n'),
    ).toContain('Fix case 1');
    expect(
      userMessages(s)
        .map((row) => row.content)
        .join('\n'),
    ).toContain('Fix case 5');
    expect(gh.permissionReads('owner')).toHaveLength(1);
  });

  test('a human collaborator named cairn is filtered by generated markers rather than their login', async () => {
    const { s, gh, deps } = await world();
    gh.state.permissions.set('cairn', { body: { permission: 'write' } });
    gh.state.comments.set(42, [
      feedback(1, 'cairn'),
      feedback(2, 'cairn', '<!-- cairn-dedupe: test --> Generated'),
    ]);
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(userMessages(s)[0]?.content).toContain('Fix case 1');
  });

  test('issue comments, inline comments and reviews are spliced in creation order', async () => {
    const { s, gh, deps } = await world();
    s.db
      .insert(step)
      .values({
        id: 'ordered',
        buildId: 'build-feedback',
        kind: 'build',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    gh.state.comments.set(42, [{ ...feedback(3), created_at: '2026-10-31T00:03:00Z' }]);
    gh.state.reviewComments.set(42, [{ ...feedback(1), created_at: '2026-10-31T00:01:00Z' }]);
    gh.state.reviews.set(42, [
      {
        id: 2,
        user: { login: 'reviewer' },
        body: 'Fix case 2',
        submitted_at: '2026-10-31T00:02:00Z',
        state: 'CHANGES_REQUESTED',
      },
      { id: 4, user: { login: 'reviewer' }, body: null, submitted_at: null, state: 'PENDING' },
    ]);
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    const content = s.db.select().from(steerPending).get()!.content;
    expect(content.indexOf('Fix case 1')).toBeLessThan(content.indexOf('Fix case 2'));
    expect(content.indexOf('Fix case 2')).toBeLessThan(content.indexOf('Fix case 3'));
  });

  test('one poll delivers one user message, wakes the same Thread and leaves merge-gate state unchanged across restarts', async () => {
    const { s, gh, deps } = await world();
    gh.state.reviewComments.set(42, [feedback(1)]);
    s.db
      .insert(gateState)
      .values({
        buildId: 'build-feedback',
        ready: true,
        headSha: 'a'.repeat(40),
        patchDigest: 'old-digest',
        policy: 'human',
        blockers: [],
        evaluatedAt: 1,
      })
      .run();
    const before = s.db.select().from(gateState).all();
    const wake = vi.spyOn(s.machineHub, 'wake');
    const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
    await poller.sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(userMessages(s)[0]).toMatchObject({ conversationId: 'build-feedback', role: 'user' });
    expect(userMessages(s)[0]?.content).toContain('Fix case 1');
    expect(s.db.select().from(build).all()).toHaveLength(1);
    expect(s.db.select().from(step).all()).toEqual([
      expect.objectContaining({ buildId: 'build-feedback', kind: 'build', status: 'pending' }),
    ]);
    expect(wake).toHaveBeenCalledWith(s.team.id);
    await poller.sweep();
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(s.db.select().from(gateState).all()).toEqual(before);
  });

  test.each(['building', 'planning', 'done'] as const)(
    'feedback resumes a %s Thread between steps',
    async (phase) => {
      const { s, gh, deps, task } = await world();
      s.db.update(todo).set({ phase }).where(eq(todo.id, task.id)).run();
      s.db.update(build).set({ prevPhase: 'todo', errorMessage: 'Previous turn failed' }).run();
      gh.state.reviewComments.set(42, [feedback(1)]);
      await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
      expect(userMessages(s)).toHaveLength(1);
      expect(s.db.select().from(build).get()).toMatchObject({
        prevPhase: phase,
        errorMessage: null,
      });
      expect(s.db.select().from(step).get()).toMatchObject({
        buildId: 'build-feedback',
        status: 'pending',
      });
    },
  );

  test('bot identities, deleted authors and read-only reviewers produce no messages', async () => {
    const { s, gh, deps } = await world();
    gh.state.permissions.set('reader', { body: { permission: 'read', role_name: 'read' } });
    const bots = [
      'cairn',
      'cairn[bot]',
      'cairnwright',
      'cairnwright[bot]',
      'CAIRNWRIGHT[bot]',
      'dependabot[bot]',
    ];
    for (const login of [...bots.filter((login) => login.endsWith('[bot]')), 'app-account'])
      gh.state.permissions.set(login, { body: { permission: 'write', role_name: 'write' } });
    gh.state.reviewComments.set(42, [
      ...[...bots, 'reader'].map((login, i) => feedback(i + 1, login)),
      { ...feedback(9, 'app-account'), user: { login: 'app-account', type: 'Bot' } },
      { ...feedback(10), user: null },
    ]);
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(0);
    expect(s.db.select().from(step).all()).toHaveLength(0);
  });

  test('change requests and inline comments have separate identities and multiple claimed-step comments are not lost', async () => {
    const { s, gh, deps } = await world();
    s.db
      .insert(step)
      .values({
        id: 'running',
        buildId: 'build-feedback',
        kind: 'build',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    gh.state.reviewComments.set(42, [feedback(1), feedback(2)]);
    gh.state.comments.set(42, [feedback(1, 'reviewer', 'Discussion feedback')]);
    gh.state.reviews.set(42, [
      { ...feedback(1), state: 'CHANGES_REQUESTED' },
      { ...feedback(2), state: 'APPROVED' },
    ]);
    const steer = vi.spyOn(s.machineHub, 'steerSignal');
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(4);
    expect(steer).toHaveBeenCalledWith(s.team.id, 'running');
    const pending = s.db.select().from(steerPending).get();
    expect(pending?.content).toContain('Fix case 1');
    expect(pending?.content).toContain('Fix case 2');
    expect(pending?.content).toContain('Discussion feedback');
    expect(s.db.select().from(step).all()).toHaveLength(1);
  });

  test.each(['pending', 'waiting_quota'] as const)(
    'feedback is included when a %s step eventually runs',
    async (status) => {
      const { s, gh, deps } = await world();
      s.db
        .insert(step)
        .values({
          id: 'waiting',
          buildId: 'build-feedback',
          kind: 'build',
          status,
          prompt: 'Original instruction',
          createdAt: 1,
        })
        .run();
      gh.state.reviewComments.set(42, [feedback(1), feedback(2)]);
      const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
      await poller.sweep();
      await poller.sweep();
      const waiting = s.db.select().from(step).get();
      expect(waiting?.prompt).toContain('Original instruction');
      expect(waiting?.prompt).toContain('Fix case 1');
      expect(waiting?.prompt).toContain('Fix case 2');
      expect(userMessages(s)).toHaveLength(2);
      expect(s.db.select().from(step).all()).toHaveLength(1);
    },
  );

  test.each(['review', 'verify', 'merge'] as const)(
    'a pending %s step yields to worker feedback without changing its instruction',
    async (kind) => {
      const { s, gh, deps } = await world();
      s.db
        .insert(step)
        .values({
          id: 'gate',
          buildId: 'build-feedback',
          kind,
          status: 'pending',
          prompt: 'Gate instruction',
          createdAt: 1,
        })
        .run();
      gh.state.reviewComments.set(42, [feedback(1)]);
      const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
      await poller.sweep();
      await poller.sweep();
      const rows = s.db.select().from(step).all();
      expect(rows.find((row) => row.id === 'gate')).toMatchObject({
        status: 'stopped',
        prompt: 'Gate instruction',
      });
      expect(rows.filter((row) => row.kind === 'build')).toEqual([
        expect.objectContaining({ prompt: expect.stringContaining('Fix case 1') }),
      ]);
      expect(userMessages(s)).toHaveLength(1);
    },
  );

  test('a claimed gate receives one visible message and dispatches it to a worker after the gate finishes', async () => {
    const { s, gh, deps } = await world();
    s.db
      .insert(step)
      .values({
        id: 'gate',
        buildId: 'build-feedback',
        kind: 'review',
        status: 'claimed',
        prompt: 'Gate instruction',
        createdAt: 1,
      })
      .run();
    gh.state.reviewComments.set(42, [feedback(1)]);
    const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
    await poller.sweep();
    await createPrFeedbackPoller(deps, { githubFetch: gh.impl }).sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(s.db.select().from(step).all()).toHaveLength(1);
    expect(s.db.select().from(step).get()?.prompt).toBe('Gate instruction');
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'gate')).run();
    await poller.sweep();
    await poller.sweep();
    expect(userMessages(s)).toHaveLength(1);
    expect(
      s.db
        .select()
        .from(step)
        .all()
        .filter((row) => row.kind === 'build'),
    ).toEqual([expect.objectContaining({ prompt: expect.stringContaining('Fix case 1') })]);
  });

  test('pagination and failed reads retry without duplicate delivery', async () => {
    const { s, gh, deps } = await world();
    gh.state.reviewComments.set(
      42,
      Array.from({ length: 101 }, (_, i) => feedback(i + 1)),
    );
    gh.overrides.set(`/repos/${REPO}/pulls/42/comments`, (url) =>
      url.searchParams.get('page') === '2'
        ? { status: 502 }
        : { body: Array.from({ length: 100 }, (_, i) => feedback(i + 1)) },
    );
    const poller = createPrFeedbackPoller(deps, { githubFetch: gh.impl });
    await poller.sweep();
    gh.overrides.clear();
    await poller.sweep();
    await poller.sweep();
    expect(userMessages(s)).toHaveLength(101);
  });

  test('scheduler delivers feedback within one interval and stops polling when stopped', async () => {
    const { s, gh, deps } = await world();
    vi.useFakeTimers();
    try {
      const scheduler = createScheduler(deps, { tickMs: 60_000 }, null, {
        githubFetch: gh.impl,
        logger: { info() {} },
      });
      scheduler.start();
      await vi.advanceTimersByTimeAsync(100);
      gh.state.reviewComments.set(42, [feedback(1)]);
      await vi.advanceTimersByTimeAsync(PR_FEEDBACK_INTERVAL_MS);
      expect(userMessages(s)).toHaveLength(1);
      scheduler.stop();
      const reads = gh.calls.length;
      await vi.advanceTimersByTimeAsync(PR_FEEDBACK_INTERVAL_MS * 2);
      expect(gh.calls).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('correction loop', () => {
  test.each(['building', 'queued'] as const)(
    'Coordinator cannot complete an unguarded correction from %s',
    async (phase) => {
      const { s, deps, task, projectId } = await world();
      const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
        name: 'correction',
        color: '#000000',
      });
      updateTodo(deps, task.id, { tagIds: [((await res.json()) as { id: string }).id] });
      s.db.update(todo).set({ phase }).where(eq(todo.id, task.id)).run();
      const result = transitionTodos(deps, s.team.id, [task.id], 'done', {
        kind: 'agent',
        name: 'Coordinator',
      });
      expect(result.transitioned).toEqual([]);
      expect(result.skipped).toEqual([task.id]);
      expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.phase).toBe(phase);
      expect(
        s.db
          .select()
          .from(message)
          .all()
          .filter((row) => row.content === DONE_ROW),
      ).toHaveLength(0);
    },
  );

  test.each(['internal', 'manual'] as const)(
    'a correction can be abandoned through the %s phase path without a guard',
    async (path) => {
      const { s, deps, task, projectId } = await world();
      const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
        name: 'correction',
        color: '#000000',
      });
      const label = (await res.json()) as { id: string };
      updateTodo(deps, task.id, { tagIds: [label.id] });
      const closed =
        path === 'manual'
          ? updateTodo(deps, task.id, { phase: 'closed' }, { manualPhase: true })
          : setTodoPhase(deps, task.id, 'closed');
      expect(closed?.phase).toBe('closed');
    },
  );

  test('merged correction reconciliation settles once with one merge row and one completion row without a guard', async () => {
    const { s, deps, task, projectId } = await world();
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction',
      color: '#000000',
    });
    updateTodo(deps, task.id, { tagIds: [((await res.json()) as { id: string }).id] });
    const gh = mergeGithubFake({ 42: { state: 'closed', merged: true } }, () =>
      conversationBranch('build-feedback'),
    );
    const poller = createCiPoller({ ...deps, githubFetch: gh.fetch }, { githubFetch: gh.fetch });
    await poller.sweep();
    expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.phase).toBe('done');
    const rows = s.db.select().from(message).all();
    expect(rows.filter((row) => String(row.content).startsWith('PR #42'))).toHaveLength(1);
    expect(rows.filter((row) => row.content === DONE_ROW)).toHaveLength(1);
    await poller.sweep(Date.now() + 60_000);
    await createCiPoller({ ...deps, githubFetch: gh.fetch }, { githubFetch: gh.fetch }).sweep();
    expect(s.db.select().from(message).all()).toEqual(rows);
  });

  test('the API merge gate rejects an unguarded correction before any GitHub merge request', async () => {
    const { s, deps, task, projectId } = await world();
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction',
      color: '#000000',
    });
    updateTodo(deps, task.id, { tagIds: [((await res.json()) as { id: string }).id] });
    const gh = mergeGithubFake({ 42: { state: 'open', merged: false } }, () =>
      conversationBranch('build-feedback'),
    );
    s.db
      .insert(step)
      .values({
        id: 'pushed',
        buildId: 'build-feedback',
        kind: 'build',
        status: 'done',
        checkpointCommit: '1a2b3c4d'.repeat(5),
        createdAt: 1,
      })
      .run();
    await expect(
      requestMerge({ ...deps, githubFetch: gh.fetch }, 'build-feedback'),
    ).rejects.toThrow(/Correction.*test or gate/);
    expect(gh.puts()).toHaveLength(0);
    expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.phase).toBe('review');
  });

  test('the API correction merge completes after GitHub merges even if guard proof disappears during settlement', async () => {
    const { s, deps, task, projectId } = await world();
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction',
      color: '#000000',
    });
    updateTodo(deps, task.id, { tagIds: [((await res.json()) as { id: string }).id] });
    const checkpoint = '1a2b3c4d'.repeat(5);
    s.db
      .insert(step)
      .values({
        id: 'pushed',
        buildId: 'build-feedback',
        kind: 'build',
        status: 'done',
        checkpointCommit: checkpoint,
        createdAt: 1,
      })
      .run();
    recordCorrectionGuard(s.db, 'build-feedback', checkpoint, true);
    const gh = mergeGithubFake({ 42: { state: 'open', merged: false } }, () =>
      conversationBranch('build-feedback'),
    );
    gh.onPut = () => {
      s.db
        .delete(message)
        .where(eq(message.id, `correction-guard:build-feedback:${checkpoint}`))
        .run();
    };
    await expect(
      requestMerge({ ...deps, githubFetch: gh.fetch }, 'build-feedback'),
    ).resolves.toEqual({ delegated: true });
    expect(gh.puts()).toHaveLength(1);
    expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.phase).toBe('done');
  });

  test('post-merge completion does not reapply the correction guard', async () => {
    const { s, deps, task, projectId } = await world();
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction',
      color: '#000000',
    });
    updateTodo(deps, task.id, { tagIds: [((await res.json()) as { id: string }).id] });
    expect(() => finishTodoDone(deps, task.id, 'build-feedback')).not.toThrow();
    expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.phase).toBe('done');
  });

  test('a correction issue creates exactly one todo and a Coordinator prompt requiring the highest feasible guard and negative control', async () => {
    const { s, gh, deps } = await world();
    gh.state.open.push({
      number: 7,
      title: 'Prevent recurrence',
      state: 'open',
      body: 'Rejected sample',
      created_at: '2026-10-31T00:00:00Z',
      labels: [{ name: 'correction' }, { name: 'needs-triage' }],
    });
    gh.state.events.set(7, [
      {
        id: 1,
        actor: { login: 'cairnwright[bot]', id: 1, type: 'Bot' },
        event: 'labeled',
        commit_id: null,
        created_at: '2026-10-31T00:00:00Z',
        label: { name: 'correction', color: '000000' },
        performed_via_github_app: { slug: 'cairnwright' },
      },
    ]);
    s.db
      .insert(agent)
      .values({
        id: 'coordinator',
        teamId: s.team.id,
        displayName: 'Coordinator',
        provider: 'stub',
        modelId: 'stub',
      })
      .run();
    s.db
      .insert(chief)
      .values({
        id: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        agentId: 'coordinator',
        charter: '',
        watches: [],
        wakes: [],
        createdAt: 1,
      })
      .run();
    const intake = createIssueIntake(deps, { githubFetch: gh.impl, label: 'correction' });
    await intake.sweep();
    await intake.sweep();
    await createIssueIntake(deps, { githubFetch: gh.impl, label: 'correction' }).sweep();
    const tasks = s.db.select().from(todo).where(eq(todo.sourceRef, 'github:octo/demo#7')).all();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.spec).toContain('negative control');
    const prompts = s.db
      .select()
      .from(chiefMessage)
      .all()
      .map((m) => JSON.stringify(m.content))
      .join('\n');
    expect(prompts).toContain('negative control');
    expect(prompts).toContain('highest feasible guard');
    expect(prompts).toContain('lint');
    expect(setTodoPhase(deps, tasks[0]!.id, 'closed')?.phase).toBe('closed');
  });

  test.each(['checkpoint', 'ahead'] as const)(
    'a passing gate at the %s head permits completion when the daemon diff is unavailable',
    async (position) => {
      const { s, deps, task, projectId } = await world();
      const res = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
        name: 'correction',
        color: '#000000',
      });
      const label = (await res.json()) as { id: string };
      updateTodo(deps, task.id, { tagIds: [label.id] });
      const checkpoint = 'a'.repeat(40);
      const head = position === 'ahead' ? 'b'.repeat(40) : checkpoint;
      s.db
        .insert(step)
        .values({
          id: 'delivered',
          buildId: 'build-feedback',
          kind: 'build',
          status: 'done',
          checkpointCommit: checkpoint,
          createdAt: 1,
        })
        .run();
      s.db
        .insert(gateState)
        .values({
          buildId: 'build-feedback',
          ready: true,
          headSha: head,
          patchDigest: 'pd2:guard',
          policy: 'autonomous',
          blockers: [],
          evaluatedAt: 1,
        })
        .run();
      expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
        /test or gate/,
      );
      recordCorrectionGuard(s.db, 'build-feedback', 'c'.repeat(40), true);
      expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
        /test or gate/,
      );
      recordCorrectionGuard(s.db, 'build-feedback', checkpoint, false);
      recordCorrectionGuard(s.db, 'build-feedback', head, false);
      expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
        /test or gate/,
      );
      recordCorrectionGuard(s.db, 'build-feedback', head, true);
      recordCorrectionGuard(s.db, 'build-feedback', head, null);
      expect(updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })?.phase).toBe(
        'done',
      );
    },
  );

  test('manual done requires gate proof even when a delivered diff contains a test or legacy added status', async () => {
    const { s, deps, task, projectId } = await world();
    const imported = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction',
      color: '#000000',
    });
    expect(imported.status).toBe(201);
    const correctionTag = (await imported.json()) as { id: string };
    updateTodo(deps, task.id, { tagIds: [correctionTag.id] });
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
    const file = {
      status: 'added' as const,
      path: 'apps/server/src/fix.ts',
      additions: 2,
      deletions: 0,
      hunks: [],
    };
    s.db
      .update(build)
      .set({ changes: [file] })
      .run();
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
    s.db
      .update(build)
      .set({
        changes: [{ ...file, path: 'apps/server/test/fix.test.ts', additions: 0, deletions: 3 }],
      })
      .run();
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
    s.db
      .update(build)
      .set({ changes: [{ ...file, path: 'apps/server/test/fix.test.ts' }] })
      .run();
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
    s.db
      .update(build)
      .set({
        changes: [{ path: 'apps/server/test/fix.test.ts', additions: 2, deletions: 0, hunks: [] }],
      })
      .run();
    expect(() => updateTodo(deps, task.id, { phase: 'done' }, { manualPhase: true })).toThrow(
      /test or gate/,
    );
  });
});

test.each([
  [[{ path: 'apps/server/test/fix.test.ts', additions: 1, status: 'modified' }], false],
  [[{ path: '.github/workflows/guard.yml', additions: 1, status: 'modified' }], false],
  [[{ path: 'scripts/new-gate.mjs', additions: 1, status: 'modified' }], false],
  [null, false],
  [[], false],
  [[{ path: 'docs/new-gate.md', additions: 10 }], false],
  [[{ path: 'apps/server/test/fix.test.ts', additions: 0 }], false],
  [[{ path: 'apps/server/test/fix.test.ts', additions: 1, status: 'added' }], true],
  [[{ path: 'scripts/new-gate.mjs', additions: 1, status: 'added' }], true],
  [[{ path: 'scripts/new-gate.py', additions: 1, status: 'added' }], true],
  [[{ path: 'scripts/new-gate.test.py', additions: 1, status: 'added' }], true],
  [[{ path: '.github/workflows/guard.yml', additions: 1, status: 'added' }], true],
] as const)('correction done check %j returns %s', (files, allowed) => {
  expect(correctionDoneCheck(files)).toBe(allowed);
});
