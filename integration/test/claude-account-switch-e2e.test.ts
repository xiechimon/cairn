import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  chiefThread,
  routingRule,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { enqueueStep } from '../../apps/server/src/services/builds.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
} from '../../apps/server/src/services/coordinator-context.js';
import { setTodoPhase } from '../../apps/server/src/services/todos.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  seedWorld,
  startLegacyBuild,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const FAKE = resolve(__dirname, '../../apps/daemon/test/fixtures/fake-claude.mjs');
const TOKEN_A = `sk-ant-oat01-${'aAaA0001'.repeat(10)}`;
const TOKEN_B = `sk-ant-oat01-${'bBbB0002'.repeat(10)}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const PROJECT_DIR_NAME = 'e2e-account-switch';

interface RunLine {
  resume: string | null;
  newSession: string | null;
  sessionId: string;
  tokenSha: string;
}

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home = '';
let runLog = '';
let accountA = '';
let accountB = '';
const saved: Record<string, string | undefined> = {};

function runs(): RunLine[] {
  try {
    return readFileSync(runLog, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as RunLine);
  } catch {
    return [];
  }
}

function stepsOf(buildId: string) {
  return server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

async function enable(id: string): Promise<void> {
  const res = await api(
    server.url,
    'POST',
    `/api/teams/${server.teamId}/claude-subscriptions/${id}/enable`,
  );
  expect(res.status).toBe(200);
}

async function planToConfirm(
  title: string,
  project: string,
): Promise<{ buildId: string; todoId: string }> {
  const world = await seedWorld(
    server.url,
    server.teamId,
    { title, spec: 'write a marker file' },
    { projectName: project },
  );
  const buildId = startLegacyBuild(server, world.todoId, { withPlan: true });
  await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);
  return { buildId, todoId: world.todoId };
}

beforeAll(async () => {
  setCoordinatorInServer(true);
  setCoordinatorServerContextEnabled(true);
  const userHome = makeTestTempDir('cairn-it-switch-user-');
  const configDir = join(userHome, '.claude');
  const transcripts = join(configDir, 'projects', PROJECT_DIR_NAME);
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(
    join(configDir, 'settings.json'),
    `${JSON.stringify({
      model: 'sonnet',
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
      },
    })}\n`,
  );
  runLog = join(makeTestTempDir('cairn-it-switch-log-'), 'runs.log');
  for (const [key, value] of Object.entries({
    HOME: userHome,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_PROJECT_DIR_NAME: PROJECT_DIR_NAME,
    CAIRN_CLAUDE_BIN: FAKE,
    CLAUDE_BIN: FAKE,
    FAKE_CLAUDE_HONOR_SESSION_ID: '1',
    FAKE_CLAUDE_TRANSCRIPT_DIR: transcripts,
    FAKE_CLAUDE_RUN_LOG: runLog,
  })) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  stub = await startStubLlm([{ content: 'unused' }]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  server.db
    .update(routingRule)
    .set({ provider: 'claude-code', modelId: 'claude-sonnet-5-5' })
    .run();
  home = makeTestTempDir('cairn-it-switch-home-');
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'it-switch',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  handle = await runMachine({
    config,
    paths,
    logger: createDaemonLogger({ logFile: paths.daemonLog }),
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  await waitFor(
    () => daemonLogLines(paths.daemonLog).some((l) => l.includes('[wake] push channel connected')),
    30_000,
  );
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  setCoordinatorInServer(false);
  setCoordinatorServerContextEnabled(false);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('after the owner switches the enabled Claude account', () => {
  let planA: { buildId: string; todoId: string };
  let heldBuild: { buildId: string; todoId: string };
  let threadId = '';
  let threadSessionOnA = '';

  test('on account A a Coordinator turn and two planned tasks run with A and record their sessions', async () => {
    const first = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      {
        label: 'A',
        token: TOKEN_A,
      },
    );
    const second = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      {
        label: 'B',
        token: TOKEN_B,
      },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    accountA = (first.body as { id: string }).id;
    accountB = (second.body as { id: string }).id;
    expect((first.body as { enabled: boolean }).enabled).toBe(true);
    expect((second.body as { enabled: boolean }).enabled).toBe(false);

    const patched = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/routing-rules/coordinator`,
      { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
    );
    expect(patched.status).toBe(200);

    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: 'what is on the board?',
    });
    expect(sent.status).toBe(201);
    threadId = (sent.body as { thread: { id: string } }).thread.id;
    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);
    const turn = stepsOf(threadId).find((st) => st.kind === 'chief');
    expect(turn).toMatchObject({ status: 'done', claudeSubscriptionId: accountA });
    threadSessionOnA =
      server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()?.sessionId ??
      '';
    expect(threadSessionOnA).not.toBe('');
    expect(runs().at(-1)).toMatchObject({ tokenSha: sha(TOKEN_A), newSession: threadSessionOnA });

    planA = await planToConfirm('person continues', 'it-switch-a');
    heldBuild = await planToConfirm('automatic continuation', 'it-switch-b');
    for (const built of [planA, heldBuild]) {
      expect(stepsOf(built.buildId).find((st) => st.kind === 'plan')).toMatchObject({
        status: 'done',
        claudeSubscriptionId: accountA,
      });
    }
    expect(runs().filter((line) => line.tokenSha === sha(TOKEN_A))).toHaveLength(3);
  }, 300_000);

  test('after the switch a person-created continuation and the next Coordinator turn start new sessions with B', async () => {
    await enable(accountB);
    const before = runs().length;
    const planSession = stepsOf(planA.buildId).find((st) => st.kind === 'plan')?.sessionId;
    expect(planSession).toBeTruthy();

    const confirmed = await api(server.url, 'POST', `/api/builds/${planA.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(
      () => stepsOf(planA.buildId).some((st) => st.kind === 'build' && st.status === 'done'),
      120_000,
    );
    const built = stepsOf(planA.buildId).find((st) => st.kind === 'build');
    expect(built).toMatchObject({ byPerson: true, claudeSubscriptionId: accountB });
    const workerRun = runs()[before] as RunLine;
    expect(workerRun).toMatchObject({ resume: null, tokenSha: sha(TOKEN_B) });
    expect(workerRun.newSession).not.toBeNull();
    expect(workerRun.sessionId).not.toBe(planSession);

    const next = await api(server.url, 'POST', `/api/conversations/${threadId}/messages`, {
      content: 'and what changed since?',
    });
    expect(next.status).toBeLessThan(300);
    await waitFor(
      () =>
        stepsOf(threadId).filter((st) => st.kind === 'chief' && st.status === 'done').length === 2,
      120_000,
    );
    const turn = stepsOf(threadId)
      .filter((st) => st.kind === 'chief')
      .at(-1);
    expect(turn).toMatchObject({ claudeSubscriptionId: accountB });
    const chiefRun = runs().at(-1) as RunLine;
    expect(chiefRun).toMatchObject({ resume: null, tokenSha: sha(TOKEN_B) });
    expect(chiefRun.sessionId).not.toBe(threadSessionOnA);
    expect(
      server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()?.sessionId,
    ).toBe(chiefRun.sessionId);
  }, 300_000);

  test('an automatic continuation of a session that ran on A is held as account-switched, and resumes with A once A is enabled again', async () => {
    const todoRow = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, heldBuild.buildId))
      .get();
    expect(todoRow).toBeDefined();
    setTodoPhase(server.svc, heldBuild.todoId, 'building');
    const held = enqueueStep(server.svc, heldBuild.buildId, 'build', server.teamId);
    await waitFor(
      () =>
        server.db
          .select()
          .from(stepTable)
          .all()
          .every((st) => st.id === held.id || (st.status !== 'pending' && st.status !== 'claimed')),
      120_000,
    );
    const before = runs().length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 6_000));
    expect(stepsOf(heldBuild.buildId).find((st) => st.id === held.id)).toMatchObject({
      status: 'pending',
      machineId: null,
    });
    expect(runs()).toHaveLength(before);
    const listed = await api(server.url, 'GET', `/api/builds/${heldBuild.buildId}/steps`);
    const shown = (listed.body as { id: string; queue?: { blocked?: { kind: string } } }[]).find(
      (st) => st.id === held.id,
    );
    expect(shown?.queue?.blocked?.kind).toBe('account-switched');

    await enable(accountA);
    await waitFor(
      () => stepsOf(heldBuild.buildId).some((st) => st.id === held.id && st.status === 'done'),
      120_000,
    );
    const planSession = stepsOf(heldBuild.buildId).find((st) => st.kind === 'plan')?.sessionId;
    const resumed = runs()[before] as RunLine;
    expect(runs()).toHaveLength(before + 1);
    expect(resumed).toMatchObject({ resume: planSession, tokenSha: sha(TOKEN_A) });
    expect(stepsOf(heldBuild.buildId).find((st) => st.id === held.id)).toMatchObject({
      claudeSubscriptionId: accountA,
    });
    expect(readFileSync(paths.daemonLog, 'utf8')).not.toContain(TOKEN_A);
    expect(readFileSync(paths.daemonLog, 'utf8')).not.toContain(TOKEN_B);
  }, 300_000);
});
