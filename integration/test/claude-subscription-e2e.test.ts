import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  machine as machineTable,
  routingRule,
  stepRoute as stepRouteTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
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
const TOKEN = `sk-ant-oat01-${'a1B2c3D4'.repeat(10)}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let workspacesDir = '';
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  const userHome = makeTestTempDir('cairn-it-user-home-');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(
    join(userHome, '.claude', 'settings.json'),
    `${JSON.stringify({
      model: 'sonnet',
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
      },
    })}\n`,
  );
  for (const [key, value] of Object.entries({
    HOME: userHome,
    CAIRN_CLAUDE_BIN: FAKE,
    CLAUDE_BIN: FAKE,
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
  const home = makeTestTempDir('cairn-it-home-');
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'it-claude',
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
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('one setup-token, stored once, runs a Claude Code task on a host machine', () => {
  test('a wrong token fails verification, the right one is stored and verified, then a task completes with the token', async () => {
    const wrong = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      {
        label: 'wrong',
        token: `sk-ant-oat01-${'REVOKED9'.repeat(10)}`,
      },
    );
    expect(wrong.status).toBe(201);
    const wrongId = (wrong.body as { id: string }).id;
    const bad = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions/${wrongId}/verify`,
    );
    expect(bad.body).toEqual({ ok: false, reason: 'auth' });
    await api(server.url, 'DELETE', `/api/teams/${server.teamId}/claude-subscriptions/${wrongId}`);

    const created = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      { label: 'mine', token: TOKEN },
    );
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(TOKEN);
    const id = (created.body as { id: string }).id;
    const verified = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions/${id}/verify`,
    );
    expect(verified.body).toEqual({ ok: true });

    const machines = (await (
      await api(server.url, 'GET', `/api/teams/${server.teamId}/machines`)
    ).body) as { enabledRuntimes?: string[] }[];
    expect(machines[0]?.enabledRuntimes).toEqual(['pi', 'claude-code']);

    const world = await seedWorld(server.url, server.teamId, {
      title: 'subscription probe',
      spec: 'write a marker file',
    });
    const buildId = startLegacyBuild(server, world.todoId, { withPlan: true });
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    const marker = readdirSync(workspacesDir)
      .map((name) => join(workspacesDir, name, 'fake-claude-edit.txt'))
      .find((file) => existsSync(file));
    expect(marker).toBeDefined();
    expect(JSON.parse(readFileSync(marker as string, 'utf8'))).toEqual({
      via: 'env',
      tokenSha: sha(TOKEN),
    });
    const steps = server.db.select().from(stepTable).all();
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    expect(JSON.stringify(msgs.body)).toContain('fake claude finished the task');
    expect(JSON.stringify(msgs.body)).not.toContain(TOKEN);
    expect(readFileSync(paths.daemonLog, 'utf8')).not.toContain(TOKEN);
  }, 150_000);

  test('an unpinned route still runs on a machine whose own claude is not logged in, using the stored token', async () => {
    await waitFor(
      () =>
        server.db.select().from(machineTable).get()?.claudeCodeReport?.auth?.state ===
        'not-logged-in',
      30_000,
    );
    server.db.update(routingRule).set({ machineId: null }).run();
    expect(
      server.db
        .select()
        .from(routingRule)
        .all()
        .every((r) => r.machineId === null),
    ).toBe(true);
    const known = new Set(readdirSync(workspacesDir));

    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'unpinned probe', spec: 'write a marker file' },
      { projectName: 'it-project-unpinned' },
    );
    startLegacyBuild(server, world.todoId, { withPlan: true });
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    const fresh = readdirSync(workspacesDir).filter((name) => !known.has(name));
    const marker = fresh
      .map((name) => join(workspacesDir, name, 'fake-claude-edit.txt'))
      .find((file) => existsSync(file));
    expect(marker).toBeDefined();
    expect(JSON.parse(readFileSync(marker as string, 'utf8'))).toEqual({
      via: 'env',
      tokenSha: sha(TOKEN),
    });
    const route = server.db.select().from(stepRouteTable).all().at(-1);
    expect(route).toMatchObject({ harness: 'claude-code', provider: 'claude-code' });
    expect(route?.reason).not.toContain('rule default');
    expect(route?.rejected.some((r) => r.modelId === route?.modelId)).toBe(false);
  }, 150_000);
});
