import {
  type ClaimedStep,
  claimedStepSchema,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  machineRecordSchema,
  machineShellPrecheckResponseSchema,
  SHELL_COMMAND_CHAR_LIMIT,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  shellCommand as shellCommandTable,
  step as stepTable,
} from '../src/db/schema.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

const AGENT_ID = 'agent-shell-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  token: string;
  machineId: string;
  startWorkerBuild(): Promise<string>;
  claimWorkerStep(): Promise<ClaimedStep>;
  precheck(
    stepId: string,
    command: string,
    cred?: string,
  ): Promise<{ res: Response; body: Record<string, unknown> }>;
  result(
    runId: string,
    body: unknown,
    cred?: string,
  ): Promise<{ res: Response; body: Record<string, unknown> }>;
  auditRows(): Array<typeof shellCommandTable.$inferSelect>;
}

async function setupWorld(opts: { shellEnabled?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-shell-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'shell-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  expect(enrollRes.status).toBe(200);
  const machineJson = (await enrollRes.json()) as { machineId: string; token: string };
  if (opts.shellEnabled) {
    s.db
      .update(machineTable)
      .set({ shellEnabled: true })
      .where(eq(machineTable.id, machineJson.machineId))
      .run();
  }
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'shell 探针任务', spec: '跑一行探针命令' },
  });
  void ((await todoRes.json()) as { id: string }).id;
  let todoSeq = 0;
  async function startWorkerBuild(): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: `shell 探针任务 ${++todoSeq}`, spec: '跑一行探针命令' },
    });
    const freshTodo = ((await res.json()) as { id: string }).id;
    const buildRes = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [freshTodo],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    expect(buildRes.status).toBe(201);
    const body = (await buildRes.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  return {
    s,
    token: machineJson.token,
    machineId: machineJson.machineId,
    async startWorkerBuild() {
      return startWorkerBuild();
    },
    async claimWorkerStep() {
      await startWorkerBuild();
      const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      const body = (await claimRes.json()) as { step: ClaimedStep | null };
      return claimedStepSchema.parse(body.step);
    },
    async precheck(stepId, command, cred) {
      const res = await call(s.app, 'POST', `/api/machine/shell/${stepId}`, {
        cred: cred ?? machineJson.token,
        body: { command },
      });
      return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    async result(runId, body, cred) {
      const res = await call(s.app, 'POST', `/api/machine/shell/${runId}/result`, {
        cred: cred ?? machineJson.token,
        body,
      });
      return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    auditRows() {
      return s.db.select().from(shellCommandTable).all();
    },
  };
}

async function claimAndPrecheck(
  w: World,
  command = 'ls -la',
): Promise<{ step: ClaimedStep; res: Response; body: Record<string, unknown> }> {
  const step = await w.claimWorkerStep();
  const { res, body } = await w.precheck(step.step.id, command);
  return { step, res, body };
}

describe('claim payload: localTools registration surface (XMON-108 R1)', () => {
  async function claimWith(agentTools: string[], shellEnabled: boolean): Promise<ClaimedStep> {
    const w = await setupWorld({ shellEnabled });
    w.s.db.update(agentTable).set({ tools: agentTools }).where(eq(agentTable.id, AGENT_ID)).run();
    const step = await w.claimWorkerStep();
    w.s.dispose();
    return step;
  }

  test('dual-gate matrix: remote_shell present only when the agent switch AND the machine switch are both on (four combinations)', async () => {
    expect((await claimWith(['远程 shell'], true)).localTools).toContain(LOCAL_TOOL_REMOTE_SHELL);
    expect((await claimWith([], true)).localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
    expect((await claimWith(['远程 shell'], false)).localTools).not.toContain(
      LOCAL_TOOL_REMOTE_SHELL,
    );
    expect((await claimWith([], false)).localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
  });

  test('create_tag judged only by the agent tool, unrelated to the machine flag (leader ruling: no matching gate at the machine layer)', async () => {
    expect((await claimWith(['创建标签'], false)).localTools).toContain(LOCAL_TOOL_CREATE_TAG);
    expect((await claimWith(['创建标签'], true)).localTools).toContain(LOCAL_TOOL_CREATE_TAG);
    const both = await claimWith(['远程 shell', '创建标签', '推送分支'], true);
    expect(both.localTools).toEqual([LOCAL_TOOL_REMOTE_SHELL, LOCAL_TOOL_CREATE_TAG]);
  });

  test('all-off = carries [] (least-privilege same law as skills/tools; default kept for legacy servers)', async () => {
    expect((await claimWith([], true)).localTools).toEqual([]);
  });
});

describe('claim payload: chief steps do not carry localTools (XMON-108 R1)', () => {
  test('chief step localTools default (chief has no worktree / no local-tool semantics)', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    const key = await issueApiKey(s);
    s.db
      .insert(agentTable)
      .values({
        id: 'chief-agent-1',
        teamId: s.team.id,
        displayName: 'chief-agent',
        modelId: 'stub-model',
        provider: 'stub-gw',
      })
      .run();
    const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-mbp', cliVersion: '0.1.0' },
    });

    bindAllAgents(s);
    const { token } = (await enrollRes.json()) as { token: string };
    const patchRes = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
      body: { agent: { agentId: 'chief-agent-1', thinkingLevel: null } },
    });
    expect(patchRes.status).toBe(200);
    const msgRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: '帮我看一下这个仓库的结构。' },
    });
    expect(msgRes.status).toBe(201);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    expect(body.step).not.toBeNull();
    const step = claimedStepSchema.parse(body.step);
    expect(step.step.kind).toBe('chief');
    expect(step.localTools).toBeUndefined();
    const pre = await call(s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: token,
      body: { command: 'ls' },
    });
    expect(pre.status).toBe(409);
    s.dispose();
  });
});

describe('chief write point -> claim reflects it (XMON-115)', () => {
  test('chief session relay set_remote_shell grant -> next worker claim localTools includes remote_shell; revoke -> not included', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .insert(agentTable)
      .values({
        id: 'chief-agent-115',
        teamId: w.s.team.id,
        displayName: 'chief-agent-115',
        modelId: 'stub-model',
        provider: 'stub-gw',
        machineId: w.machineId,
      })
      .run();
    const patchRes = await call(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      body: { agent: { agentId: 'chief-agent-115', thinkingLevel: null } },
    });
    expect(patchRes.status).toBe(200);
    const msgRes = await call(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      body: { content: '给 agent-shell-1 开远程 shell。' },
    });
    expect(msgRes.status).toBe(201);
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: {},
    });
    const chiefStep = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
    expect(chiefStep.step.kind).toBe('chief');
    const grantRes = await call(w.s.app, 'POST', `/api/machine/tool/${chiefStep.step.id}`, {
      cred: w.token,
      body: { name: 'set_remote_shell', params: { agentId: AGENT_ID, enabled: true } },
    });
    expect(grantRes.status).toBe(200);
    expect(((await grantRes.json()) as { text: string }).text).toContain('"remoteShell":true');
    const after = await w.claimWorkerStep();
    expect(after.localTools).toContain(LOCAL_TOOL_REMOTE_SHELL);
    const revokeRes = await call(w.s.app, 'POST', `/api/machine/tool/${chiefStep.step.id}`, {
      cred: w.token,
      body: { name: 'set_remote_shell', params: { agentId: AGENT_ID, enabled: false } },
    });
    expect(revokeRes.status).toBe(200);
    const afterRevoke = await w.claimWorkerStep();
    expect(afterRevoke.localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
    w.s.dispose();
  });
});

describe('PATCH /api/machines/{id}: shellEnabled passthrough (XMON-108 R1)', () => {
  test('PATCH succeeds + echo consistent (acceptance #5 read-back); single field does not clash with enabledRuntimes', async () => {
    const w = await setupWorld();
    const runtimeRes = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { enabledRuntimes: ['pi'] },
    });
    const on = machineRecordSchema.parse(await runtimeRes.json());
    expect(on.enabledRuntimes).toEqual(['pi']);
    expect(on.shellEnabled).toBe(false);
    const res = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: true },
    });
    const patched = machineRecordSchema.parse(await res.json());
    expect(patched.shellEnabled).toBe(true);
    expect(patched.enabledRuntimes).toEqual(['pi']);
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.shellEnabled).toBe(true);
    const off = machineRecordSchema.parse(
      await (
        await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
          body: { shellEnabled: false },
        })
      ).json(),
    );
    expect(off.shellEnabled).toBe(false);
    w.s.dispose();
  });

  test('empty body = no-op 200 echoing the current value (no blow-up, no write)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const res = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, { body: {} });
    expect(res.status).toBe(200);
    const body = machineRecordSchema.parse(await res.json());
    expect(body.shellEnabled).toBe(true);
    w.s.dispose();
  });

  test('unknown id -> 404 {error}; non-boolean -> 400', async () => {
    const w = await setupWorld();
    const unknown = await call(w.s.app, 'PATCH', '/api/machines/nope', {
      body: { shellEnabled: true },
    });
    expect(unknown.status).toBe(404);
    expect(Object.keys((await unknown.json()) as Record<string, unknown>)).toEqual(['error']);
    const bad = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: 'yes' },
    });
    expect(bad.status).toBe(400);
    w.s.dispose();
  });
});

describe('preflight POST /api/machine/shell/{stepId} (XMON-108 R1)', () => {
  test('both gates open -> 200 {allowed, runId} + running audit row persisted before returning', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res, body, step } = await claimAndPrecheck(w, 'git status');
    expect(res.status).toBe(200);
    const parsed = machineShellPrecheckResponseSchema.parse(body);
    expect(parsed.allowed).toBe(true);
    expect(parsed.runId).toBeTruthy();
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(parsed.runId);
    expect(row.status).toBe('running');
    expect(row.command).toBe('git status');
    expect(row.stepId).toBe(step.step.id);
    expect(row.machineId).toBe(w.machineId);
    expect(row.agentId).toBe(AGENT_ID);
    expect(row.teamId).toBe(w.s.team.id);
    expect(row.exitCode).toBeNull();
    expect(row.finishedAt).toBeNull();
    w.s.dispose();
  });

  test('agent without "remote shell" -> 403 naming the permission tab + denied audit row (with reason)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { res, body } = await claimAndPrecheck(w, 'rm -rf /');
    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('未获「远程 shell」授权');
    expect(String(body.error)).toContain('Agent 详情页权限 tab');
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('denied');
    expect(rows[0]!.command).toBe('rm -rf /');
    expect(rows[0]!.errorMessage).toContain('未获「远程 shell」授权');
    expect(rows[0]!.finishedAt).not.toBeNull();
    w.s.dispose();
  });

  test('machine shell off -> 403 naming the machine + denied audit row', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res, body } = await claimAndPrecheck(w, 'ls');
    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('未开启 shell 访问');
    expect(String(body.error)).toContain('机器');
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('denied');
    w.s.dispose();
  });

  test('machine gate off mid-step -> next command immediately 403 (acceptance #3: re-read every call, not a one-time claim gate)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    const first = await w.precheck(step.step.id, 'echo one');
    expect(first.res.status).toBe(200);
    const off = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: false },
    });
    expect(off.status).toBe(200);
    const second = await w.precheck(step.step.id, 'echo two');
    expect(second.res.status).toBe(403);
    const rows = await w.auditRows();
    expect(rows.map((r) => r.status)).toEqual(['running', 'denied']);
    w.s.dispose();
  });

  test('agent tool removed mid-step -> next command immediately 403 (both gates re-read every call)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    expect((await w.precheck(step.step.id, 'echo one')).res.status).toBe(200);
    w.s.db.update(agentTable).set({ tools: [] }).where(eq(agentTable.id, AGENT_ID)).run();
    const second = await w.precheck(step.step.id, 'echo two');
    expect(second.res.status).toBe(403);
    expect(String(second.body.error)).toContain('Agent 详情页权限 tab');
    w.s.dispose();
  });

  test('protocol errors: correct codes for unclaimed step / wrapped-up step / unknown step; protocol errors land no audit row', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const buildId = await w.startWorkerBuild();
    const pendingStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()[0]!;
    expect(pendingStep.status).toBe('pending');
    const unclaimed = await w.precheck(pendingStep.id, 'ls');
    expect(unclaimed.res.status).toBe(404);
    const step = await w.claimWorkerStep();
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: w.token,
      body: { status: 'success' },
    });
    expect(doneRes.status).toBe(200);
    const finished = await w.precheck(step.step.id, 'ls');
    expect(finished.res.status).toBe(409);
    const unknown = await w.precheck('step-nope', 'ls');
    expect(unknown.res.status).toBe(404);
    expect(await w.auditRows()).toHaveLength(0);
    w.s.dispose();
  });

  test('another machine preflights a step this machine already claimed -> 404 (ownedStep same law); bad body -> 400', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    const key2 = await issueApiKey(w.s);
    const enroll2 = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: key2,
      body: { teamId: w.s.team.id, name: 'shell-mbp-2', cliVersion: '0.1.0' },
    });

    const token2 = ((await enroll2.json()) as { token: string }).token;
    const foreign = await w.precheck(step.step.id, 'ls', token2);
    expect(foreign.res.status).toBe(404);
    const empty = await call(w.s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: w.token,
      body: { command: '' },
    });
    expect(empty.status).toBe(400);
    const long = await call(w.s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: w.token,
      body: { command: 'x'.repeat(SHELL_COMMAND_CHAR_LIMIT + 1) },
    });
    expect(long.status).toBe(400);
    w.s.dispose();
  });
});

describe('write-back POST /api/machine/shell/{runId}/result (XMON-108 R1)', () => {
  async function allowOne(w: World): Promise<{ runId: string; step: ClaimedStep }> {
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { body, step } = await claimAndPrecheck(w);
    const parsed = machineShellPrecheckResponseSchema.parse(body);
    return { runId: parsed.runId, step };
  }

  test('done write-back: status/exitCode/output/finishedAt persisted', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const { res } = await w.result(runId, { status: 'done', exitCode: 0, output: 'total 0\n' });
    expect(res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('done');
    expect(row.exitCode).toBe(0);
    expect(row.output).toBe('total 0\n');
    expect(row.finishedAt).not.toBeNull();
    w.s.dispose();
  });

  test('failed write-back: errorMessage persisted, exitCode not', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const { res } = await w.result(runId, {
      status: 'failed',
      errorMessage: 'command timed out after 60s',
    });
    expect(res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toBe('command timed out after 60s');
    expect(row.exitCode).toBeNull();
    expect(row.finishedAt).not.toBeNull();
    w.s.dispose();
  });

  test('repeated terminal write-back = idempotent 200 without rewriting (network retry does not change the ledger)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    await w.result(runId, { status: 'done', exitCode: 0, output: 'first' });
    const again = await w.result(runId, { status: 'failed', errorMessage: 'retry noise' });
    expect(again.res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('done');
    expect(row.output).toBe('first');
    expect(row.errorMessage).toBeNull();
    w.s.dispose();
  });

  test('denied row write-back -> 409 (a denied runId was never issued, protocol error)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res } = await claimAndPrecheck(w);
    expect(res.status).toBe(403);
    const deniedRow = (await w.auditRows())[0]!;
    const denied = await w.result(deniedRow.id, { status: 'done', exitCode: 0 });
    expect(denied.res.status).toBe(409);
    expect(deniedRow.status).toBe('denied');
    w.s.dispose();
  });

  test('unknown runId -> 404; another machine write-back -> 403 (sync-result same law)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const unknown = await w.result('run-nope', { status: 'done' });
    expect(unknown.res.status).toBe(404);
    const key2 = await issueApiKey(w.s);
    const enroll2 = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: key2,
      body: { teamId: w.s.team.id, name: 'shell-mbp-2', cliVersion: '0.1.0' },
    });
    const token2 = ((await enroll2.json()) as { token: string }).token;
    const foreign = await w.result(runId, { status: 'done' }, token2);
    expect(foreign.res.status).toBe(403);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('running');
    w.s.dispose();
  });

  test('out-of-vocabulary status (running/pending) -> 400 (schema pins the shape)', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const bad = await w.result(runId, { status: 'running' });
    expect(bad.res.status).toBe(400);
    w.s.dispose();
  });
});

describe('migration: machine.shellEnabled backfill false (XMON-108 R1)', () => {
  test('new rows (seed/enroll) and existing rows read shellEnabled=false (legacy default off)', async () => {
    const w = await setupWorld();
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.shellEnabled).toBe(false);
    seedLocalMachine(w.s.db, w.s.team.id);
    const seeded = w.s.db.select().from(machineTable).where(eq(machineTable.kind, 'local')).all();
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.shellEnabled).toBe(false);
    w.s.dispose();
  });
});
