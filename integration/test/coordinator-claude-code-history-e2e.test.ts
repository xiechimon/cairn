import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { setCoordinatorInServer } from '../../apps/server/src/services/coordinator-context.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const FAKE = resolve(__dirname, '../../apps/daemon/test/fixtures/fake-claude.mjs');
const TOKEN = `sk-ant-oat01-${'h15t0ry0'.repeat(10)}`;

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home = '';
let claudeLog = '';
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  claudeLog = join(makeTestTempDir('cairn-it-coord-hist-log-'), 'claude.log');
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
    FAKE_CLAUDE_PROMPT_LOG: claudeLog,
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
  if (home) rmSync(home, { recursive: true, force: true });
  setCoordinatorInServer(false);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('a thread that ran on the in-server runtime keeps its earlier conversation when it moves to Claude Code', () => {
  test('the first Claude turn after a stale session id gets the fenced history before the new message, and no stored row carries it', async () => {
    const stored = await api(
      server.url,
      'POST',
      `/api/teams/${server.teamId}/claude-subscriptions`,
      { label: 'mine', token: TOKEN },
    );
    expect(stored.status).toBe(201);
    const patched = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/routing-rules/coordinator`,
      { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
    );
    expect(patched.status).toBe(200);

    const chiefRow = await api(server.url, 'GET', `/api/teams/${server.teamId}/chief`);
    expect(chiefRow.status).toBe(200);
    const chiefId = server.db.select().from(chiefTable).get()?.id as string;
    const user = server.db.select().from(chiefTable).get()?.userId as string;
    const threadId = 'chief-history-e2e';
    server.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId: user,
        teamId: server.teamId,
        title: 'moved from the server runtime',
        createdAt: 10,
        updatedAt: 10,
        sessionId: 'stale-pi-session-id',
        sessionOpenedAt: 10,
      })
      .run();
    const earlier: [string, 'user' | 'assistant', unknown, number][] = [
      ['h1', 'user', 'remember the launch is on friday', 20],
      ['h2', 'assistant', 'noted: launch on friday', 21],
      ['h3', 'assistant', { kind: 'toolcall', call: { name: 'projects', arguments: {} } }, 22],
      ['h4', 'user', `my key is ${TOKEN}`, 23],
    ];
    for (const [id, role, content, createdAt] of earlier) {
      server.db.insert(chiefMessage).values({ id, threadId, role, content, createdAt }).run();
    }

    const sent = await api(server.url, 'POST', `/api/conversations/${threadId}/messages`, {
      content: 'when is the launch?',
    });
    expect(sent.status).toBeLessThan(300);
    await waitFor(
      () =>
        server.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.buildId, threadId))
          .all()
          .some((st) => st.kind === 'chief' && st.status === 'done'),
      120_000,
    );

    const userTurns = readFileSync(claudeLog, 'utf8')
      .split('\n')
      .filter((line) => line.includes('firstUserText'))
      .map((line) => (JSON.parse(line) as { firstUserText: string }).firstUserText);
    expect(userTurns).toHaveLength(1);
    const text = userTurns[0] as string;
    expect(text.startsWith('【此前的对话')).toBe(true);
    expect(text).toContain('> 用户：remember the launch is on friday');
    expect(text).toContain('> Coordinator：noted: launch on friday');
    expect(text).not.toContain('projects');
    expect(text).not.toContain(TOKEN);
    expect(text.indexOf('> 用户：remember')).toBeLessThan(text.indexOf('when is the launch?'));
    expect(text.endsWith('when is the launch?')).toBe(true);

    const rows = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all();
    expect(JSON.stringify(rows.map((row) => row.content))).not.toContain('【此前的对话');
    expect(daemonLogLines(paths.daemonLog).join('\n')).not.toContain(TOKEN);
  }, 150_000);
});
