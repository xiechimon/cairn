import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  externalEffect,
  mailAccount,
  schedule as scheduleTable,
  step,
  taskIssueClose,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newRecordId } from '../src/lib/ids.js';
import { sendBuildSteer, startBuilds } from '../src/services/builds.js';
import {
  type ConnectorBrokerDeps,
  type ConnectorCallContext,
  executeConnectorToolCall,
} from '../src/services/connector-broker.js';
import { drainEffects, effectRegistry } from '../src/services/external-effects.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import type { OutgoingMail, SendMail } from '../src/services/mail-smtp.js';
import { newMcpOAuthState } from '../src/services/mcp-servers.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { createSecret } from '../src/services/secrets.js';
import {
  flushSelfIssueWrites,
  updateAutonomousTodo,
  writebackSelfIssueTitle,
} from '../src/services/todos.js';
import { bootServer, deliverCodeStep, insertMachine, type TestServer } from './helpers.js';

const TOKEN = 'gho_testtoken';
const REPO = 'octo/repo';
const ISSUES_PATH = `/repos/${REPO}/issues`;

type GhResponse = { status?: number; body?: unknown };

function ghMock(routes: Record<string, GhResponse>) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const repoProbe = /^\/repos\/([^/]+\/[^/]+)$/.exec(new URL(url).pathname);
    const res =
      routes[`${method} ${new URL(url).pathname}`] ??
      (method === 'GET' && repoProbe !== null
        ? { status: 200, body: { full_name: repoProbe[1] } }
        : undefined);
    const status = res?.status ?? 404;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => res?.body ?? {},
      text: async () => JSON.stringify(res?.body ?? {}),
    };
  };
  return {
    impl,
    callsTo(method: string, path: string) {
      return calls.filter((c) => c.method === method && new URL(c.url).pathname === path);
    },
  };
}

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

async function postGithubProject(s: TestServer, name = 'alpha'): Promise<string> {
  const res = await s.app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, kind: 'github', githubRepo: REPO }),
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function postPlainProject(s: TestServer, name: string): Promise<string> {
  const res = await s.app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) throw new Error(`postPlainProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function createTodo(s: TestServer, projectId: string, title: string): Promise<string> {
  const res = await s.app.request(`/api/projects/${projectId}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, spec: 'spec' }),
  });
  if (res.status !== 201) throw new Error(`createTodo: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

function ghDeps(s: TestServer, fetch: FetchLike) {
  return {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    githubFetch: fetch,
  };
}

function boot() {
  const s = bootServer();
  insertMachine(s);
  return s;
}

describe('github-issue-create intent is atomic with the delivery settle', () => {
  test('a rollback of the settle transaction sends no issue and keeps no intent', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 101 } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s);
    const todoId = await createTodo(s, projectId, 'self issue task');
    const deps = ghDeps(s, mock.impl);
    expect(() =>
      s.db.transaction(() => {
        deliverCodeStep(deps, todoId);
        throw new Error('killed between decision and act');
      }),
    ).toThrow('killed between decision and act');
    await flushSelfIssueWrites();
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(0);
    const rows = s.db
      .select()
      .from(externalEffect)
      .all()
      .filter((r) => r.kind === 'github-issue-create' && r.state !== 'cancelled');
    expect(rows).toHaveLength(0);
    s.dispose();
  });
});

describe('schedule fire act and mark are one commit', () => {
  async function schedulableTodo(s: TestServer) {
    const res = await s.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'sched-proj' }),
    });
    const projectId = ((await res.json()) as { id: string }).id;
    const todoId = await createTodo(s, projectId, 'schedulable');
    return { projectId, todoId };
  }

  test('a crash after the fired build commits leaves the schedule fully marked', async () => {
    const s = boot();
    const { projectId, todoId } = await schedulableTodo(s);
    const record = createSchedule(s.svc, {
      todoId,
      kind: 'once',
      at: Math.floor((Date.now() - 3_600_000) / 900_000) * 900_000,
      tz: 'UTC',
      prompt: 'fire me',
      teamId: s.team.id,
      createdBy: s.user.id,
    });
    vi.spyOn(s.hub, 'publishBuildDoc').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    const fired = s.db.select().from(step).where(eq(step.scheduleId, record.id)).all();
    const row = s.db.select().from(scheduleTable).where(eq(scheduleTable.id, record.id)).get();
    expect(fired).toHaveLength(1);
    expect(row?.lastRunStepId).toBe(fired[0]?.id);
    expect(row?.lastRunStatus).toBe('started');
    expect(row?.nextRunAt).toBeNull();
    void projectId;
    s.dispose();
  });

  test('a steer-path fire marks the schedule inside the same commit', async () => {
    const s = boot();
    const { projectId, todoId } = await schedulableTodo(s);
    const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
    const first = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, started?.id as string))
      .all()[0];
    s.db
      .update(step)
      .set({ status: 'done', finishedAt: Date.now() })
      .where(eq(step.id, first?.id as string))
      .run();
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, todoId)).run();
    const record = createSchedule(s.svc, {
      todoId,
      kind: 'once',
      at: Math.floor((Date.now() - 3_600_000) / 900_000) * 900_000,
      tz: 'UTC',
      prompt: 'continue',
      teamId: s.team.id,
      createdBy: s.user.id,
    });
    const before = s.db.select().from(scheduleTable).where(eq(scheduleTable.id, record.id)).get();
    await sendBuildSteer(
      s.svc,
      started?.id as string,
      { content: 'continue' },
      {
        afterTurn: true,
        human: false,
        schedule: {
          id: record.id,
          createdBy: s.user.id,
          at: Date.now(),
          expected: before?.nextRunAt ?? null,
          next: null,
          triggered: false,
        },
      },
    );
    const fired = s.db.select().from(step).where(eq(step.scheduleId, record.id)).all();
    const row = s.db.select().from(scheduleTable).where(eq(scheduleTable.id, record.id)).get();
    expect(fired).toHaveLength(1);
    expect(row?.lastRunStepId).toBe(fired[0]?.id);
    expect(row?.nextRunAt).toBeNull();
    s.dispose();
  });

  test('a stale schedule claim rolls the whole fired build back', async () => {
    const s = boot();
    const { projectId, todoId } = await schedulableTodo(s);
    const record = createSchedule(s.svc, {
      todoId,
      kind: 'once',
      at: Math.floor((Date.now() - 3_600_000) / 900_000) * 900_000,
      tz: 'UTC',
      prompt: 'fire me',
      teamId: s.team.id,
      createdBy: s.user.id,
    });
    const before = s.db.select().from(scheduleTable).where(eq(scheduleTable.id, record.id)).get();
    s.db
      .update(scheduleTable)
      .set({ nextRunAt: Date.now() + 3_600_000 })
      .where(eq(scheduleTable.id, record.id))
      .run();
    expect(() =>
      startBuilds(s.svc, {
        projectId,
        todoIds: [todoId],
        triggerSource: 'schedule',
        scheduledBy: s.user.id,
        schedule: {
          id: record.id,
          expected: before?.nextRunAt ?? null,
          at: Date.now(),
          next: null,
          triggered: false,
        },
      }),
    ).toThrow(/no longer due|due|claim/i);
    expect(s.db.select().from(step).all()).toHaveLength(0);
    const row = s.db.select().from(scheduleTable).where(eq(scheduleTable.id, record.id)).get();
    expect(row?.lastRunStepId).toBeNull();
    s.dispose();
  });
});

describe('issue close tombstone commits with the move', () => {
  test('a crash after a project move still queues the issue close', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 101 } },
    });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectA = await postGithubProject(s, 'alpha');
    const projectB = await postPlainProject(s, 'beta');
    const todoId = await createTodo(s, projectA, 'moved self issue task');
    s.db
      .update(todoTable)
      .set({ sourceKind: 'github-issue-self', sourceRef: `github:${REPO}#101` })
      .where(eq(todoTable.id, todoId))
      .run();
    const deps = ghDeps(s, mock.impl);
    vi.spyOn(s.hub, 'publishTodoDoc').mockImplementationOnce(() => {
      throw new Error('killed between decision and act');
    });
    expect(() => updateAutonomousTodo(deps, todoId, { projectId: projectB })).toThrow(
      'killed between decision and act',
    );
    const closes = s.db.select().from(taskIssueClose).all();
    expect(closes).toHaveLength(1);
    expect(closes[0]?.sourceRef).toBe(`github:${REPO}#101`);
    s.dispose();
  });
});

describe('github issue title writeback is a durable effect', () => {
  test('a crash after the title commit still delivers the PATCH exactly once', async () => {
    const patchPath = `/repos/${REPO}/issues/101`;
    const mock = ghMock({ [`PATCH ${patchPath}`]: { status: 200, body: {} } });
    const s = bootServer({ githubFetch: mock.impl });
    seedConnection(s);
    const projectId = await postGithubProject(s);
    const todoId = await createTodo(s, projectId, 'titled task');
    s.db
      .update(todoTable)
      .set({ sourceKind: 'github-issue-self', sourceRef: `github:${REPO}#101` })
      .where(eq(todoTable.id, todoId))
      .run();
    let kill = true;
    const flaky: FetchLike = async (input, init) => {
      if (kill && init?.method === 'PATCH') {
        kill = false;
        throw new Error('killed between decision and act');
      }
      return mock.impl(input, init);
    };
    const deps = ghDeps(s, flaky);
    updateAutonomousTodo(deps, todoId, { title: 'renamed' }, { issueTitleWriteback: true });
    await writebackSelfIssueTitle(deps, todoId, 'renamed').catch(() => undefined);
    const firstCount = mock.callsTo('PATCH', patchPath).length;
    await drainEffects(s.db, effectRegistry, { now: Date.now() + 60_000 });
    expect(mock.callsTo('PATCH', patchPath).length).toBeGreaterThan(firstCount);
    const row = s.db
      .select()
      .from(externalEffect)
      .all()
      .find((r) => r.kind === 'github-issue-title');
    expect(row?.state).toBe('delivered');
    s.dispose();
  });
});

describe('mail send is recorded before dispatch and replays on duplicate calls', () => {
  function mailWorld(sendMail: SendMail) {
    const s = bootServer();
    const accountId = newRecordId();
    const secret = createSecret(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, name: 'mail.smtp', value: 'pw' },
    );
    s.db
      .insert(mailAccount)
      .values({
        id: accountId,
        teamId: s.team.id,
        userId: s.user.id,
        provider: 'imap',
        mailbox: 'INBOX',
        status: 'watching',
        generation: 1,
        address: 'me@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        secretId: secret.id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const deps: ConnectorBrokerDeps = {
      db: s.db,
      mcp: {
        db: s.db,
        box: s.secretBox,
        mcpConfigPath: `${s.reposDir}/absent-mcp.json`,
        fetch: globalThis.fetch,
        oauthFetch: globalThis.fetch,
        oauthState: newMcpOAuthState(),
      },
      reposDir: s.reposDir,
      hub: s.hub,
      convHub: s.convHub,
      user: s.user,
      sendMail,
    };
    const ctx: ConnectorCallContext = {
      teamId: s.team.id,
      threadId: 'thread-mail',
      scopeProjectId: null,
      mcpGrant: [],
    };
    return { s, deps, ctx };
  }

  const args = { to: 'boss@example.com', subject: 'hello', body: 'world' };

  test('an identical re-call after delivery does not send a second copy', async () => {
    const calls: OutgoingMail[] = [];
    const { s, deps, ctx } = mailWorld(async (_config, mail) => {
      calls.push(mail);
    });
    const first = await executeConnectorToolCall(deps, ctx, 'connector_cairn-mail__send', args);
    expect(JSON.parse(first)).toMatchObject({ sent: true });
    const second = await executeConnectorToolCall(deps, ctx, 'connector_cairn-mail__send', args);
    expect(JSON.parse(second)).toMatchObject({ sent: true });
    expect(calls).toHaveLength(1);
    s.dispose();
  });

  test('a send whose claim went stale answers unknown instead of resending', async () => {
    const calls: OutgoingMail[] = [];
    const { s, deps, ctx } = mailWorld(async (_config, mail) => {
      calls.push(mail);
    });
    await executeConnectorToolCall(deps, ctx, 'connector_cairn-mail__send', args);
    const row = s.db
      .select()
      .from(externalEffect)
      .all()
      .find((r) => r.kind === 'mail-send');
    expect(row).toBeDefined();
    s.db
      .update(externalEffect)
      .set({ state: 'sending', claimFence: 1, receipt: null })
      .where(eq(externalEffect.id, row?.id as string))
      .run();
    await expect(
      executeConnectorToolCall(deps, ctx, 'connector_cairn-mail__send', args),
    ).rejects.toThrow(/unknown|not retried|interrupted/i);
    expect(calls).toHaveLength(1);
    s.dispose();
  });
});
