import {
  AGENT_TOOL_PUSH,
  type MachineCapabilities,
  type MachineClaimBody,
  type RunnerOfflineContent,
  type StepKind,
  type TodoOutputKind,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage as chiefMessageTable,
  claudeSubscription as claudeSubscriptionTable,
  machine as machineTable,
  noticeMark as noticeMarkTable,
  notification as notificationTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { claimStep } from '../src/services/machines.js';
import { RUNNER_OFFLINE_NOTICE_MS, sweepOfflineRunners } from '../src/services/runner-offline.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import { NO_MACHINE_ALERT_MS, sweepUnplaceableSteps } from '../src/services/unplaceable-steps.js';
import {
  bootServer,
  insertClaudeSubscription,
  issueApiKey,
  seedPolicy,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const REPO = 'octo/app';
let seqCounter = 11_200;

interface World {
  s: TestServer;
  projectId: string;
}

function githubFetchOk(input: string | URL | Request): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith(`/repos/${REPO}`)) {
    return Promise.resolve(
      new Response(JSON.stringify({ full_name: REPO, id: 12345 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.resolve(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }));
}

let sharedServer: TestServer;
const sharedProjectId = 'proj-push-main';

beforeAll(() => {
  sharedServer = bootServer({ claimHoldMs: 20, githubFetch: githubFetchOk });
  sharedServer.db
    .insert(projectTable)
    .values({
      id: sharedProjectId,
      name: 'push gate',
      teamId: sharedServer.team.id,
      repoKind: 'github',
      githubRepo: REPO,
    })
    .run();
  upsertGithubConnection(
    { db: sharedServer.db, box: sharedServer.secretBox },
    { teamId: sharedServer.team.id, login: 'octo', accessToken: 'test-token', scope: 'repo' },
  );
});

afterAll(() => {
  sharedServer.dispose();
});

beforeEach(() => {
  sharedServer.db.delete(notificationTable).run();
  sharedServer.db.delete(noticeMarkTable).run();
  sharedServer.db.delete(chiefMessageTable).run();
  sharedServer.db.delete(stepTable).run();
  sharedServer.db.delete(buildTable).run();
  sharedServer.db.delete(todoTable).run();
  sharedServer.db.delete(machineTable).run();
  sharedServer.db.delete(claudeSubscriptionTable).run();
  sharedServer.db
    .update(teamTable)
    .set({ defaultMachineId: null })
    .where(eq(teamTable.id, sharedServer.team.id))
    .run();
  seedSessionRoute(sharedServer, {
    provider: 'stub-gw',
    modelId: 'stub-model',
    tools: [AGENT_TOOL_PUSH],
  });
});

function setupWorld(): World {
  return { s: sharedServer, projectId: sharedProjectId };
}

async function enrollMachine(
  w: World,
  opts: { name: string; capabilities?: unknown },
): Promise<{ machineId: string; token: string }> {
  const apiKey = await issueApiKey(w.s);
  const res = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: w.s.team.id,
      name: opts.name,
      cliVersion: '0.1.0',
      ...(opts.capabilities !== undefined ? { capabilities: opts.capabilities } : {}),
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { machineId: string; token: string };
  w.s.db
    .update(machineTable)
    .set({ online: true })
    .where(eq(machineTable.id, body.machineId))
    .run();
  return body;
}

function insertPendingStep(
  w: World,
  opts: {
    kind?: StepKind;
    prompt?: string | null;
    homeMachineId?: string | null;
    requiredMcpServers?: string[];
    projectId?: string;
    output?: TodoOutputKind;
  } = {},
): { stepId: string; createdAt: number; homeMachineId: string | null } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  const todoId = `todo-push-${suffix}`;
  const buildId = `build-push-${suffix}`;
  const stepId = `step-push-${suffix}`;
  const homeMachineId = opts.homeMachineId ?? null;
  const routeOverride =
    homeMachineId !== null || opts.requiredMcpServers !== undefined
      ? {
          ...(homeMachineId !== null ? { machineId: homeMachineId } : {}),
          ...(opts.requiredMcpServers !== undefined
            ? { requiredCapabilities: { mcpServers: opts.requiredMcpServers } }
            : {}),
        }
      : null;
  w.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: w.s.team.id,
      projectId: opts.projectId ?? w.projectId,
      seqNum: seqCounter,
      title: `push gate ${suffix}`,
      spec: 'probe',
      phase: 'queued',
      phaseAt: now,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      ...(routeOverride !== null ? { routeOverride } : {}),
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: opts.kind ?? 'build',
      machineId: null,
      status: 'pending',
      prompt: opts.prompt ?? null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { stepId, createdAt: now + 1, homeMachineId };
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAs(w: World, machineId: string, body?: MachineClaimBody) {
  return claimStep(
    machineDepsOf(w),
    machineId,
    w.s.team.id,
    10,
    'http://localhost',
    undefined,
    body,
  );
}

function baseCapabilities(githubPush?: MachineCapabilities['githubPush']): MachineCapabilities {
  return {
    mcpServers: [],
    skills: [],
    ...(githubPush === undefined ? {} : { githubPush }),
  };
}

function pushReport(
  state: 'write' | 'no-write' | 'unauthenticated' | 'unknown',
  repo = REPO,
  checkedAt = Date.now(),
): NonNullable<MachineCapabilities['githubPush']> {
  return { login: 'ok', checkedAt, repos: [{ repo, state, checkedAt }] };
}

describe('GitHub push capability claim gate', () => {
  test.each([
    ['missing report', undefined],
    ['unauthenticated', { login: 'unauthenticated' as const, checkedAt: Date.now(), repos: [] }],
    ['no-write', pushReport('no-write')],
    ['unknown', pushReport('unknown')],
    ['wrong repo', pushReport('write', 'octo/other')],
    ['stale write', pushReport('write', REPO, Date.now() - 16 * 60_000)],
  ])('%s cannot claim a GitHub build step', async (_name, githubPush) => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: `runner-${_name}`,
      capabilities: baseCapabilities(githubPush),
    });
    const pending = insertPendingStep(w);
    expect(await claimAs(w, runner.machineId)).toBeNull();
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, pending.stepId)).get()?.status,
    ).toBe('pending');
  });

  test('fresh exact-repo write can claim the same GitHub build step', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'runner-write',
      capabilities: baseCapabilities(pushReport('write')),
    });
    const pending = insertPendingStep(w);
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(pending.stepId);
  });

  test('repository-evidence verify requires the report; attachment-evidence verify does not', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'runner-verify',
      capabilities: baseCapabilities(),
    });
    const repositoryStep = insertPendingStep(w, {
      kind: 'verify',
      prompt: 'repository evidence prompt',
    });
    expect(await claimAs(w, runner.machineId, { verifyAttachments: true })).toBeNull();
    expect(
      w.s.db.select().from(stepTable).where(eq(stepTable.id, repositoryStep.stepId)).get()?.status,
    ).toBe('pending');
    w.s.db.delete(stepTable).where(eq(stepTable.id, repositoryStep.stepId)).run();

    const attachmentStep = insertPendingStep(w, {
      kind: 'verify',
      prompt: `${JSON.stringify({ kind: 'verify', evidence: 'attachments', evidenceDirectory: '.cairn-verify/t/' })}\nattachments prompt`,
    });
    expect((await claimAs(w, runner.machineId, { verifyAttachments: true }))?.step.id).toBe(
      attachmentStep.stepId,
    );
  });
});

describe('GitHub push capability queue reason and presence repo list', () => {
  test('queue names the online runner and reports github-push-missing', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'mac-mini-no-github',
      capabilities: baseCapabilities(),
    });
    const pending = insertPendingStep(w, { homeMachineId: runner.machineId });
    const info = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: pending.stepId,
      createdAt: pending.createdAt,
      homeMachineId: runner.machineId,
    });
    expect(info?.waitingFor).toEqual({ machineId: runner.machineId, name: 'mac-mini-no-github' });
    expect(info?.blocked).toEqual({ kind: 'github-push-missing', missing: [] });
  });

  test('presence response lists active GitHub repos only', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'presence-runner',
      capabilities: baseCapabilities(),
    });
    w.s.db
      .insert(projectTable)
      .values({
        id: 'proj-push-archived',
        name: 'archived',
        teamId: w.s.team.id,
        repoKind: 'github',
        githubRepo: 'octo/archived',
        archivedAt: Date.now(),
      })
      .run();
    w.s.db
      .insert(projectTable)
      .values({ id: 'proj-push-plain', name: 'plain', teamId: w.s.team.id })
      .run();
    const res = await w.s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${runner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ cliVersion: '0.1.0', capabilities: baseCapabilities() }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { githubRepos?: string[] }).toEqual({
      ok: true,
      githubRepos: [REPO],
    });
  });

  test('capable second runner claims the GitHub build step when default runner lacks GitHub login', async () => {
    const w = setupWorld();
    const withoutLogin = await enrollMachine(w, {
      name: 'runner-without-gh',
      capabilities: baseCapabilities({
        login: 'unauthenticated',
        checkedAt: Date.now(),
        repos: [],
      }),
    });
    w.s.db
      .update(teamTable)
      .set({ defaultMachineId: withoutLogin.machineId })
      .where(eq(teamTable.id, w.s.team.id))
      .run();
    const capable = await enrollMachine(w, {
      name: 'runner-with-gh',
      capabilities: baseCapabilities(pushReport('write')),
    });
    const pending = insertPendingStep(w);
    expect(await claimAs(w, withoutLogin.machineId)).toBeNull();
    expect((await claimAs(w, capable.machineId))?.step.id).toBe(pending.stepId);
  });

  test('pool with multiple online runners lacking push emits unnamed github-push-missing', async () => {
    const w = setupWorld();
    await enrollMachine(w, {
      name: 'runner-a',
      capabilities: baseCapabilities({
        login: 'unauthenticated',
        checkedAt: Date.now(),
        repos: [],
      }),
    });
    await enrollMachine(w, {
      name: 'runner-b',
      capabilities: baseCapabilities(pushReport('no-write')),
    });
    w.s.db
      .update(teamTable)
      .set({ defaultMachineId: null })
      .where(eq(teamTable.id, w.s.team.id))
      .run();
    const pending = insertPendingStep(w);
    const info = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: pending.stepId,
      createdAt: pending.createdAt,
      homeMachineId: null,
    });
    expect(info?.waitingFor).toBeNull();
    expect(info?.blocked).toEqual({ kind: 'github-push-missing', missing: [] });
  });

  test('mixed pool with an otherwise-capable runner lacking push and an incompatible runner emits github-push-missing', async () => {
    const w = setupWorld();
    await enrollMachine(w, {
      name: 'runner-needs-gh',
      capabilities: {
        ...baseCapabilities({
          login: 'unauthenticated',
          checkedAt: Date.now(),
          repos: [],
        }),
        mcpServers: ['playwright'],
      },
    });
    await enrollMachine(w, {
      name: 'runner-no-mcp',
      capabilities: baseCapabilities(pushReport('write')),
    });
    w.s.db
      .update(teamTable)
      .set({ defaultMachineId: null })
      .where(eq(teamTable.id, w.s.team.id))
      .run();
    const pending = insertPendingStep(w, { requiredMcpServers: ['playwright'] });
    const info = stepQueueProjector(w.s.db, w.s.team.id).project({
      id: pending.stepId,
      createdAt: pending.createdAt,
      homeMachineId: null,
    });
    expect(info?.waitingFor).toBeNull();
    expect(info?.blocked).toEqual({ kind: 'github-push-missing', missing: [] });
  });

  test('non-push steps are not blocked without githubPush', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'runner-non-push',
      capabilities: baseCapabilities(),
    });
    const hostedId = 'proj-push-hosted';
    w.s.db
      .insert(projectTable)
      .values({
        id: hostedId,
        name: 'hosted',
        teamId: w.s.team.id,
        repoKind: 'hosted',
        repoName: 'hosted-repo',
      })
      .run();
    const localId = 'proj-push-local';
    w.s.db
      .insert(projectTable)
      .values({
        id: localId,
        name: 'local',
        teamId: w.s.team.id,
        repoKind: 'local',
        localPath: '/tmp/local-repo',
      })
      .run();
    seedRoute(w.s, 'review', { provider: 'stub-gw', modelId: 'stub-model' });
    seedPolicy(w.s, 'review', { tools: [AGENT_TOOL_PUSH] });

    const hostedStep = insertPendingStep(w, { projectId: hostedId });
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(hostedStep.stepId);

    const localStep = insertPendingStep(w, { projectId: localId, homeMachineId: runner.machineId });
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(localStep.stepId);

    const planStep = insertPendingStep(w, { kind: 'plan' });
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(planStep.stepId);

    const reviewStep = insertPendingStep(w, { kind: 'review' });
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(reviewStep.stepId);

    seedPolicy(w.s, 'session', { tools: [] });
    const noPushToolStep = insertPendingStep(w);
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(noPushToolStep.stepId);

    insertClaudeSubscription(w.s);
    seedSessionRoute(w.s, {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      tools: [AGENT_TOOL_PUSH],
    });
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'runner-non-push',
          models: [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' }],
        },
      })
      .where(eq(machineTable.id, runner.machineId))
      .run();
    const infoStep = insertPendingStep(w, { output: 'info' });
    expect((await claimAs(w, runner.machineId))?.step.id).toBe(infoStep.stepId);
  });

  test('presence update to write wakes a waiting claimStep and claims the step', async () => {
    const w = setupWorld();
    const runner = await enrollMachine(w, {
      name: 'runner-wake',
      capabilities: baseCapabilities({
        login: 'unauthenticated',
        checkedAt: Date.now(),
        repos: [],
      }),
    });
    const pending = insertPendingStep(w);
    const waitingClaim = claimStep(
      machineDepsOf(w),
      runner.machineId,
      w.s.team.id,
      5_000,
      'http://localhost',
    );
    await new Promise((r) => setTimeout(r, 40));
    const res = await w.s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${runner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        cliVersion: '0.1.0',
        capabilities: baseCapabilities(pushReport('write')),
      }),
    });
    expect(res.status).toBe(200);
    const claimed = await waitingClaim;
    expect(claimed?.step.id).toBe(pending.stepId);
  });

  test('runner-offline excludes alternatives lacking GitHub push write and recommends a capable alternative', async () => {
    const w = setupWorld();
    const t0 = Date.now();
    const sweepAt = t0 + RUNNER_OFFLINE_NOTICE_MS + 10_000;
    const offlineHome = await enrollMachine(w, {
      name: 'runner-offline-home',
      capabilities: baseCapabilities(pushReport('write', REPO, t0)),
    });
    w.s.db
      .update(machineTable)
      .set({ online: false, lastSeenAt: t0 })
      .where(eq(machineTable.id, offlineHome.machineId))
      .run();
    await enrollMachine(w, {
      name: 'runner-online-no-gh',
      capabilities: baseCapabilities({
        login: 'unauthenticated',
        checkedAt: sweepAt,
        repos: [],
      }),
    });
    insertPendingStep(w, { homeMachineId: offlineHome.machineId });

    sweepOfflineRunners(w.s.svc, sweepAt);
    const firstRow = w.s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, `runner-offline-${offlineHome.machineId}`))
      .get();
    expect(firstRow).toBeDefined();
    const firstContent = JSON.parse(String(firstRow?.content)) as RunnerOfflineContent;
    expect(firstContent.alternative).toBeNull();

    const capable = await enrollMachine(w, {
      name: 'runner-online-with-gh',
      capabilities: baseCapabilities(pushReport('write', REPO, sweepAt + 1)),
    });
    sweepOfflineRunners(w.s.svc, sweepAt + 1);
    const secondRow = w.s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.id, `runner-offline-${offlineHome.machineId}`))
      .get();
    const secondContent = JSON.parse(String(secondRow?.content)) as RunnerOfflineContent;
    expect(secondContent.alternative).toEqual(
      expect.objectContaining({
        machineId: capable.machineId,
        name: 'runner-online-with-gh',
      }),
    );
  });

  test('sweepUnplaceableSteps raises a no_machine alert with gh auth login guidance', async () => {
    const w = setupWorld();
    const sweepAt = Date.now() + NO_MACHINE_ALERT_MS + 60_000;
    const runner = await enrollMachine(w, {
      name: 'runner-stuck-gh',
      capabilities: baseCapabilities({
        login: 'unauthenticated',
        checkedAt: sweepAt,
        repos: [],
      }),
    });
    insertPendingStep(w, { homeMachineId: runner.machineId });

    sweepUnplaceableSteps(w.s.svc, sweepAt);
    const alerts = w.s.db
      .select()
      .from(notificationTable)
      .all()
      .filter((row) => row.type === 'no_machine');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.snippet).toContain('runner-stuck-gh');
    expect(alerts[0]?.snippet).toContain('gh auth login');
  });
});
