import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  chiefMessage,
  chiefThread,
  machine as machineTable,
  stepRoute as stepRouteTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
} from '../../apps/server/src/services/coordinator-context.js';
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

const FAKE = resolve(__dirname, '../../apps/daemon/test/fixtures/fake-claude.mjs');
const TOKEN = `sk-ant-oat01-${'f1R5t0Ne'.repeat(10)}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let workspacesDir = '';
const saved: Record<string, string | undefined> = {};
const seen: Record<string, unknown> = {};

beforeAll(async () => {
  setCoordinatorInServer(true);
  setCoordinatorServerContextEnabled(true);
  const userHome = makeTestTempDir('cairn-it-first-run-user-');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(join(userHome, '.claude', 'settings.json'), '{}\n');
  for (const [key, value] of Object.entries({
    HOME: userHome,
    CAIRN_CLAUDE_BIN: FAKE,
    CLAUDE_BIN: FAKE,
  })) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:1', bare: true });
  const home = makeTestTempDir('cairn-it-first-run-home-');
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'it-first-run',
    },
    {},
  );
  workspacesDir = config.workspacesDir;
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
  writeFileSync('/tmp/first-run-walkthrough.json', JSON.stringify(seen, null, 2));
  await handle?.stop();
  await handle?.done;
  await server?.close();
  setCoordinatorInServer(false);
  setCoordinatorServerContextEnabled(false);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const settings = () => api(server.url, 'GET', `/api/teams/${server.teamId}/routing-settings`);

describe('a fresh instance with one Claude subscription and nothing else', () => {
  test('signing in once makes the Coordinator and a task work without touching routing', async () => {
    seen.before = (await settings()).body;
    seen.beforeChief = (await api(server.url, 'GET', `/api/teams/${server.teamId}/chief`)).body;
    await waitFor(
      () => server.db.select().from(machineTable).get()?.claudeCodeReport?.installed === true,
      30_000,
    );

    const stored = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      { label: 'mine', token: TOKEN },
    );
    expect(stored.status).toBe(201);
    const id = (stored.body as { id: string }).id;
    seen.verify = (
      await api(server.url, 'POST', `/api/teams/${server.teamId}/claude-subscriptions/${id}/verify`)
    ).body;
    seen.after = (await settings()).body;
    seen.afterChief = (await api(server.url, 'GET', `/api/teams/${server.teamId}/chief`)).body;

    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: 'what is on the board?',
    });
    seen.sent = { status: sent.status, body: sent.body };
    const threadId = (sent.body as { thread?: { id: string } }).thread?.id ?? '';
    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 60_000).catch(() => undefined);
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
    seen.chiefSteps = steps.map((st) => ({ kind: st.kind, status: st.status }));
    seen.messages = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all()
      .map((m) => m.content);
    expect(JSON.stringify(seen.messages)).toContain('fake claude finished');

    const world = await seedWorld(server.url, server.teamId, {
      title: 'first run probe',
      spec: 'write a marker file',
    });
    startLegacyBuild(server, world.todoId, { withPlan: true });
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 90_000).catch((error) => {
      seen.taskPhase = server.todoPhase(world.todoId);
      seen.taskSteps = server.db
        .select()
        .from(stepTable)
        .all()
        .map((st) => ({
          kind: st.kind,
          status: st.status,
          hold: st.holdReason,
          machine: st.machineId,
        }));
      seen.taskRoutes = server.db.select().from(stepRouteTable).all();
      seen.daemonLog = daemonLogLines(paths.daemonLog).slice(-40);
      throw error;
    });
    const marker = readdirSync(workspacesDir)
      .map((name) => join(workspacesDir, name, 'fake-claude-edit.txt'))
      .find((file) => existsSync(file));
    expect(JSON.parse(readFileSync(marker as string, 'utf8'))).toEqual({
      via: 'env',
      tokenSha: sha(TOKEN),
    });
  }, 200_000);
});
