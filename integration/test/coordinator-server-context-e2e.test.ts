import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  chiefMessage,
  chiefSummary,
  chiefThread,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../../apps/server/src/services/coordinator-context.js';
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

beforeAll(async () => {
  setCoordinatorServerContextEnabled(true);
  stub = await startStubLlm([
    { content: 'ANSWER-ONE' },
    { content: 'ANSWER-TWO' },
    { content: 'ANSWER-THREE' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-ctx-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'ctx-mbp' },
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
  await waitFor(
    () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
    30_000,
  );
}, 120_000);

afterAll(async () => {
  setCoordinatorServerContextEnabled(false);
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

async function turn(content: string): Promise<string> {
  const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/coordinator/messages`, {
    content,
  });
  expect(sent.status).toBeLessThan(300);
  const threadId = server.db
    .select()
    .from(chiefThread)
    .all()
    .find((t) => !t.id.includes('digest'))!.id;
  await waitFor(() => {
    const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
    const pending = server.db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.buildId, threadId), eq(stepTable.kind, 'chief')))
      .all()
      .some((s) => s.status === 'pending' || s.status === 'claimed');
    return th?.activeRun === null && !pending;
  }, 120_000);
  return threadId;
}

const texts = (messages: { role: string; content?: unknown }[]) =>
  messages.map(
    (m) => `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
  );

describe('D70 C3: the server owns the Coordinator context', () => {
  test('each turn is a fresh Pi session seeded with server history; the summary replaces what it covers', async () => {
    const patch = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);

    const threadId = await turn('QUESTION-ONE');
    await turn('QUESTION-TWO');
    const second = texts(stub.requests[1]!.messages);
    expect(second.filter((t) => t.includes('QUESTION-ONE'))).toHaveLength(1);
    expect(second.some((t) => t.startsWith('assistant:') && t.includes('ANSWER-ONE'))).toBe(true);
    expect(second.filter((t) => t.includes('QUESTION-TWO'))).toHaveLength(1);
    expect(second.at(-1)).toContain('QUESTION-TWO');

    const answerOne = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all()
      .find((m) => JSON.stringify(m.content).includes('ANSWER-ONE'))!;
    const rowid = server.db
      .select({ rowid: sql<number>`rowid` })
      .from(chiefMessage)
      .where(eq(chiefMessage.id, answerOne.id))
      .get()!;
    server.db
      .insert(chiefSummary)
      .values({
        threadId,
        summary: 'SUMMARY-MARK: the user asked QUESTION-ONE',
        coveredThroughId: answerOne.id,
        coveredAt: answerOne.createdAt,
        coveredRowid: rowid.rowid,
        compactedMessages: 2,
        generation: 1,
        updatedAt: Date.now(),
      })
      .run();

    await turn('QUESTION-THREE');
    const third = stub.requests[2]!;
    const system = texts(third.messages.filter((m) => m.role === 'system')).join('\n');
    const rest = texts(third.messages.filter((m) => m.role !== 'system'));
    expect(system).toContain('SUMMARY-MARK');
    expect(rest.some((t) => t.includes('ANSWER-ONE'))).toBe(false);
    expect(rest.some((t) => t.includes('ANSWER-TWO'))).toBe(true);
    expect(rest.filter((t) => t.includes('QUESTION-THREE'))).toHaveLength(1);

    const lines = daemonLogLines(paths.daemonLog);
    expect(lines.filter((l) => l.includes(`new session ${threadId}`)).length).toBe(3);
  }, 300_000);
});
