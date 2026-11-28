import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  externalEffect,
  mailAccount,
  schedule as scheduleTable,
  step,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { sendBuildSteer, startBuilds } from '../src/services/builds.js';
import {
  type ConnectorBrokerDeps,
  type ConnectorCallContext,
  executeConnectorToolCall,
} from '../src/services/connector-broker.js';
import type { OutgoingMail, SendMail } from '../src/services/mail-smtp.js';
import { newMcpOAuthState } from '../src/services/mcp-servers.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { createSecret } from '../src/services/secrets.js';
import { readSchedule } from '../src/services/step-groups/schedule.js';
import { bootServer, insertMachine, type TestServer } from './helpers.js';

async function createTodo(s: TestServer, projectId: string, title: string): Promise<string> {
  const res = await s.app.request(`/api/projects/${projectId}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, spec: 'spec' }),
  });
  if (res.status !== 201) throw new Error(`createTodo: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

function boot() {
  const s = bootServer();
  insertMachine(s);
  return s;
}

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
    const fired = s.db
      .select()
      .from(step)
      .all()
      .filter((row) => readSchedule(s.db, row.id).scheduleId === record.id);
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
    const fired = s.db
      .select()
      .from(step)
      .all()
      .filter((row) => readSchedule(s.db, row.id).scheduleId === record.id);
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
