import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { step as stepTable, tokenUsage } from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let buildId = '';
let todoId = '';
const timing: Record<string, number> = {};

beforeAll(async () => {
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: `cat > plan.md <<'EOF'\n# 方案\n\nContext: 探针任务，README 当前无探针行。\nChanges: 在 README.md 追加一行 m3a probe。\nEdge cases: 无。\nVerification: 查 README.md 末行。\nEOF`,
        },
      },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "m3a probe line\\n" >> README.md' } },
    },
    { content: '修改已完成并验证通过。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  const home = makeTestTempDir('cairn-it-home-');
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'it-mbp' },
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
});

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

describe('M3a demo: server dispatches step → daemon executes for real → transcript persists', () => {
  test('plan step full chain (low-latency wake dispatch + real pi session + upload-urls + phase→confirm)', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: '探针任务',
      spec: '在 README 写一行探针。',
    });
    todoId = world.todoId;
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    const t0 = Date.now();
    await waitFor(() => server.todoPhase(todoId) === 'confirm', 120_000);
    timing.wakeToConfirmMs = Date.now() - t0;

    await waitFor(() => logLines().some((l) => l.includes('finished (0 running)')), 30_000);
    const lines = logLines();
    for (const canon of [
      'Loading pi runtime…',
      'Enrolled in team',
      'Online (machineId=',
      '[recover] no pending steps found',
      '[wake] push channel connected',
      'claim step=',
      `step `,
      'using model stub-gw/stub-model',
      '[workspace] 准备工作区...',
      `new session ${buildId}`,
      'finished (0 running)',
    ]) {
      expect(
        lines.some((l) => l.includes(canon)),
        `missing canon line: ${canon}`,
      ).toBe(true);
    }

    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const messages = (msgs.body as { messages: { role: string; content: unknown }[] }).messages;
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(assistant.length).toBeGreaterThan(0);
    expect(JSON.stringify(assistant)).toContain('方案已就绪');

    const usage = server.db.select().from(tokenUsage).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ buildId, model: 'stub-gw/stub-model' });
    expect((usage[0]!.input ?? 0) + (usage[0]!.output ?? 0)).toBeGreaterThan(0);

    const steps = server.db.select().from(stepTable).all();
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(steps[0]!.sessionId).toBeTruthy();

    const first = stub.requests[0]!;
    const flat = JSON.stringify(first.messages);
    expect(flat).toContain('集成测试执行 Agent');
    expect(flat).toContain('探针任务');
    expect(flat).toContain('在 README 写一行探针。');
  }, 150_000);

  test('confirm → build step = continue session (same conv pi session reuse, 02 §4.2/§5.7; T2 evidence A)', async () => {
    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    expect(logLines().some((l) => l.includes(`continue session ${buildId}`))).toBe(true);
    const second = stub.requests[2]!;
    expect(JSON.stringify(second.messages)).toContain('方案已就绪');
    expect(second.messages.length).toBeGreaterThan(stub.requests[0]!.messages.length);
  }, 150_000);

  test('claim cadence is isomorphic to server hold (r3 §1.5 ~75–76s at compressed test timescale; production default 75s pinned on the wire test)', async () => {
    const before = server.claimCount();
    await new Promise((r) => setTimeout(r, 3_200));
    const claims = server.claimCount() - before;
    timing.idleClaimsIn3200ms = claims;
    expect(claims).toBeGreaterThanOrEqual(2);
    expect(claims).toBeLessThanOrEqual(5);
  }, 30_000);

  test('low-latency wake dispatch latency evidence on disk (ticket AC: claim/wake timing comparison measured)', () => {
    expect(timing.wakeToConfirmMs).toBeLessThan(60_000);
    process.stdout.write(
      `\n[timing] wake→confirm (incl. real pi execution) = ${timing.wakeToConfirmMs}ms; idle claim cadence (hold=1s) = ${timing.idleClaimsIn3200ms}/3.2s\n`,
    );
  });
});
