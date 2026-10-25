import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
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
let home: string;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command:
            "printf '# 方案\n\nContext: steer 探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\n' > plan.md",
        },
      },
      delayMs: 8_000,
    },
    { content: '收到，补上。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-w3-steer-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'w3-steer-mbp',
    },
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
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('W3 steer E2E: message while building → pending → signal → pull-confirm → session.steer', () => {
  test('full-chain delivery + rendering + undisturbed step finish + gate reject', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'steer 探针',
      spec: '写一行 steer 探针。',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 30_000);

    const sent = await api(server.url, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '顺便把测试补上',
    });
    expect(sent.status).toBe(201);

    await waitFor(() => logLines().some((l) => l.includes('steer delivered')), 30_000);

    const face = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const faceBody = face.body as { messages: { role: string; content: unknown }[] };
    expect(faceBody.messages.some((m) => m.role === 'user' && m.content === '顺便把测试补上')).toBe(
      true,
    );

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    const late = await api(server.url, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '晚到的一条',
    });
    expect(late.status).toBe(409);
    expect(Object.keys(late.body as object)).toEqual(['error']);
  }, 240_000);
});
