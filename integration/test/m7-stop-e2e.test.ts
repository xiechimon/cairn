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
  stub = await startStubLlm([{ content: '这轮永远不会说完…', delayMs: 8_000 }]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-m7-stop-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm7-stop-mbp',
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

describe('M7 stop E2E: stop button → pending → signal → pull-confirm → pi abort → done(stopped) → accounting', () => {
  test('full-chain delivery + accounting + gate fallback + transcript rows kept + gate re-reject', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'stop 探针',
      spec: '写一行 stop 探针。',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 30_000);

    const stopped = await api(server.url, 'POST', `/api/builds/${buildId}/stop`, {
      discard: true,
    });
    expect(stopped.status).toBe(202);
    expect(stopped.body).toEqual({ delegated: true });

    await waitFor(() => logLines().some((l) => l.includes('stop delivered step=')), 30_000);
    await waitFor(() => logLines().some((l) => l.includes('step stopped by user')), 30_000);

    await waitFor(() => server.todoPhase(world.todoId) === 'todo', 60_000);
    const steps = await api(server.url, 'GET', `/api/builds/${buildId}/steps`);
    const stepRows = steps.body as { status: string }[];
    expect(stepRows.some((s) => s.status === 'stopped')).toBe(true);
    const buildFace = await api(server.url, 'GET', `/api/builds/${buildId}`);
    expect((buildFace.body as { errorMessage: string | null }).errorMessage).toBe('已取消');

    const messages = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const face = messages.body as { messages: { role: string; content: unknown }[] };
    expect(
      face.messages.some((m) => m.role === 'user' && String(m.content).includes('stop 探针')),
    ).toBe(true);

    const late = await api(server.url, 'POST', `/api/builds/${buildId}/stop`, { discard: true });
    expect(late.status).toBe(409);
    expect(Object.keys(late.body as object)).toEqual(['error']);
  }, 240_000);
});
