import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  chiefMessage,
  chiefThread,
  notification as notificationTable,
  step as stepTable,
  tokenUsage,
} from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let threadId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    { toolCall: { name: 'projects', arguments: {} } },
    { content: '已查看团队项目清单。有什么可以帮你的？' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-m4a-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm4a-mbp' },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('M4a Chief E2E: pi session + remoteTools relay round trip (02 §4.3/r5 §3.1)', () => {
  test('bind → send message → claim chief step → pi relay tool → done → chief_message persisted', async () => {
    const patch = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);

    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '团队里现在有哪些项目？',
    });
    expect(sent.status).toBe(201);
    threadId = (sent.body as { thread: { id: string } }).thread.id;
    expect(threadId.startsWith('chief-')).toBe(true);

    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);

    const lines = logLines();
    expect(lines.some((l) => l.includes(`for conv ${threadId}`))).toBe(true);
    expect(lines.some((l) => l.includes(`new session ${threadId}`))).toBe(true);
    expect(lines.some((l) => l.includes('using model stub-gw/stub-model'))).toBe(true);

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
    expect(steps.some((st) => st.kind === 'chief' && st.status === 'done')).toBe(true);
    const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()!;
    expect(th.sessionId).not.toBe('');

    const msgs = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all();
    const flat = JSON.stringify(msgs.map((m) => m.content));
    expect(flat).toContain('已查看团队项目清单');
    expect(flat).toContain('projects');

    const notif = server.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message' && n.entityId === threadId);
    expect(notif).toBeDefined();
    expect(notif!.snippet).toContain('已查看团队项目清单');

    const usage = server.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, threadId)).all();
    expect(usage.length).toBeGreaterThanOrEqual(1);
  }, 150_000);
});
