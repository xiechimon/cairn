import { readFileSync, rmSync } from 'node:fs';

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
} from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const ASK_ARGS = {
  questions: [
    {
      header: '缩进',
      question: 'Tabs 还是 spaces？',
      options: [{ label: 'Tabs' }, { label: 'Spaces', description: '软缩进' }],
    },
    {
      header: '优先级',
      question: '本轮先做哪件事？',
      multiSelect: true,
      options: [{ label: '先修测试' }, { label: '先写文档' }],
    },
    { header: '备注', question: '有什么要补充的吗？', options: [] },
  ],
};

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let machineToken = '';

function askRowsOf(threadId: string) {
  return server.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((r) => r.id.startsWith('ask-'));
}

async function waitForValue<T>(
  fn: () => T | null,
  timeoutMs = 60_000,
  intervalMs = 100,
): Promise<T> {
  let last: T | null = null;
  await waitFor(
    () => {
      last = fn();
      return last !== null;
    },
    timeoutMs,
    intervalMs,
  );
  return last as T;
}

async function teamApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api(server.url, method, path, body);
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> };
}

async function machineAskOnce(
  stepId: string,
  requestId: string,
  holdMs = 0,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${server.url}/api/machine/ask/${stepId}?holdMs=${holdMs}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${machineToken}`,
    },
    body: JSON.stringify({ requestId, questions: ASK_ARGS.questions }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function diagTail(): string {
  try {
    return readFileSync(join(home, 'daemon.log'), 'utf8').split('\n').slice(-50).join('\n');
  } catch {
    return '(daemon.log unreadable)';
  }
}

beforeAll(async () => {
  stub = await startStubLlm([
    { toolCall: { name: 'ask_user', arguments: ASK_ARGS } },
    { content: '已收到你的答复，本轮照此执行。' },
    { toolCall: { name: 'ask_user', arguments: ASK_ARGS } },
    { content: '已收到你的答复，本轮照此执行。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = makeTestTempDir('cairn-ask-home-');
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'ask-mbp' },
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
  await waitForValue(() => {
    try {
      machineToken = (
        JSON.parse(readFileSync(join(home, 'machine.json'), 'utf8')) as { token: string }
      ).token;
      return machineToken;
    } catch {
      return null;
    }
  }, 30_000);
}, 120_000);

afterAll(async () => {
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail()}\n`,
  );
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('#1049 chief ask_user blocking Q&A full chain (pi backend)', () => {
  test('question → card (row + notification) → answer card → same turn continues (D2/D3/D4)', async () => {
    const patch = await teamApi('PATCH', `/api/teams/${server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);
    const sent = await teamApi('POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '开工前先问清楚三件事',
    });
    expect(sent.status).toBe(201);
    const threadId = (sent.body as { thread: { id: string } }).thread.id;

    const askRow = await waitForValue(() => askRowsOf(threadId)[0] ?? null);
    const requestId = askRow.id;
    const content = JSON.parse(askRow.content as string) as {
      status: string;
      questions: unknown[];
    };
    expect(content.status).toBe('pending');
    expect(content.questions).toHaveLength(3);

    const midStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .find((st) => st.kind === 'chief');
    expect(midStep?.status).toBe('claimed');
    const midThread = server.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get();
    expect(midThread?.activeRun).not.toBeNull();

    const notif = server.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message' && n.entityId === threadId);
    expect(notif).toBeDefined();

    const reAsk = await machineAskOnce(midStep?.id ?? '', requestId);
    expect(reAsk.status).toBe(200);
    expect(reAsk.body.status).toBe('pending');
    expect(askRowsOf(threadId)).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 2_000));
    const stillRow = askRowsOf(threadId)[0];
    expect((JSON.parse(stillRow?.content as string) as { status: string }).status).toBe('pending');

    const answered = await teamApi(
      'POST',
      `/api/teams/${server.teamId}/chief/threads/${threadId}/questions/${requestId}/answer`,
      {
        answers: [
          { header: '缩进', choices: ['Spaces'] },
          { header: '优先级', choices: ['先修测试', '先写文档'] },
          { header: '备注', text: '按优先级来' },
        ],
      },
    );
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('answered');

    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((st) => st.kind === 'chief');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('done');
    expect(steps[0]?.id).toBe(midStep?.id);
    const flat = JSON.stringify(
      server.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all(),
    );
    expect(flat).toContain('已收到你的答复');
    const finalContent = JSON.parse(askRowsOf(threadId)[0]?.content as string) as {
      status: string;
      answers: { choices?: string[]; text?: string }[];
    };
    expect(finalContent.status).toBe('answered');
    expect(finalContent.answers?.[0]?.choices).toEqual(['Spaces']);
    expect(finalContent.answers?.[1]?.choices).toEqual(['先修测试', '先写文档']);
    expect(finalContent.answers?.[2]?.text).toBe('按优先级来');
  }, 180_000);

  test('user cancels → cancelled tool result → model converges in the same turn (D4 user-side exit)', async () => {
    const sent = await teamApi('POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '再问一次，这次我会取消',
    });
    const threadId = (sent.body as { thread: { id: string } }).thread.id;
    const askRow = await waitForValue(() => askRowsOf(threadId)[0] ?? null);

    const cancelled = await teamApi(
      'POST',
      `/api/teams/${server.teamId}/chief/threads/${threadId}/questions/${askRow.id}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(200);

    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((st) => st.kind === 'chief');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('done');
    expect(
      (JSON.parse(askRowsOf(threadId)[0]?.content as string) as { status: string }).status,
    ).toBe('cancelled');
    const flat = JSON.stringify(
      server.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all(),
    );
    expect(flat).toContain('已收到你的答复');
  }, 180_000);
});
