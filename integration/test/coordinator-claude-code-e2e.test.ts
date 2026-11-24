import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { setCoordinatorInServer } from '../../apps/server/src/services/coordinator-context.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { api, bootRealServer, daemonLogLines, type RealServer, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const FAKE = resolve(__dirname, '../../apps/daemon/test/fixtures/fake-claude.mjs');
const TOKEN = `sk-ant-oat01-${'c0D3d00d'.repeat(10)}`;

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home = '';
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  setCoordinatorInServer(true);
  const userHome = makeTestTempDir('cairn-it-coord-cc-user-');
  mkdirSync(join(userHome, '.claude'), { recursive: true });
  writeFileSync(
    join(userHome, '.claude', 'settings.json'),
    `${JSON.stringify({ model: 'sonnet', env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' } })}\n`,
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
  home = makeTestTempDir('cairn-it-coord-cc-home-');
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'it-coordinator-cc',
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
  if (home) rmSync(home, { recursive: true, force: true });
  setCoordinatorInServer(false);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('a Coordinator rule that selects Claude Code runs the turn on the Runner with the stored token', () => {
  test('in-server flags on, claude-code rule: the Runner claims the chief step, the reply lands, the token never leaks', async () => {
    const stored = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      { label: 'mine', token: TOKEN },
    );
    expect(stored.status).toBe(201);
    const machineRow = server.db.select().from(machineTable).get();
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
    const threadId = (sent.body as { thread: { id: string } }).thread.id;

    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
    const chiefStep = steps.find((st) => st.kind === 'chief');
    expect(chiefStep).toMatchObject({ status: 'done', machineId: machineRow?.id });
    expect(steps.filter((st) => st.kind === 'chief')).toHaveLength(1);

    const messages = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all();
    expect(JSON.stringify(messages.map((m) => m.content))).toContain('fake claude finished');
    expect(JSON.stringify(messages)).not.toContain(TOKEN);
    const log = daemonLogLines(paths.daemonLog).join('\n');
    expect(log).not.toContain(TOKEN);
    expect(log).toContain(`for conv ${threadId}`);

    const envelope = await api(
      server.url,
      'GET',
      `/api/teams/${server.teamId}/chief?threadId=${encodeURIComponent(threadId)}`,
    );
    expect(envelope.status).toBe(200);
    expect((envelope.body as { context: unknown }).context).toMatchObject({
      tokens: 15,
      contextWindow: 200_000,
      compactAt: 167_000,
    });

    const second = await api(server.url, 'POST', `/api/conversations/${threadId}/messages`, {
      content: 'and what changed since?',
    });
    expect(second.status).toBeLessThan(300);
    await waitFor(
      () =>
        server.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.buildId, threadId))
          .all()
          .filter((st) => st.kind === 'chief' && st.status === 'done').length === 2,
      120_000,
    );
    const thread = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
    expect(thread?.sessionId).not.toBe('');
    const replies = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all()
      .filter((m) => JSON.stringify(m.content).includes('fake claude finished'));
    expect(replies).toHaveLength(2);
  }, 150_000);
});
