import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { createPiBackend } from '../../apps/daemon/src/backend/pi.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { MachineClient } from '../../apps/daemon/src/machine-client.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import {
  loadMachineJson,
  recordSession,
  resolveSessionFile,
  statePaths,
} from '../../apps/daemon/src/state.js';
import { machine, step } from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { api, bootRealServer, CONFINEMENT_READY_LAUNCH, seedWorld, waitFor } from './helpers.js';
import { startStubLlm } from './stub-llm.js';

test('two real runners keep named tasks, workspaces and results isolated across an offline restart', async () => {
  const turns = new Map<string, number>();
  const provider = await startStubLlm((request) => {
    const messages = JSON.stringify(request.messages);
    const marker = ['alpha-proof', 'beta-proof', 'beta-after-restart'].find((value) =>
      messages.includes(value),
    );
    if (marker === undefined) throw new Error('unexpected model request without task marker');
    const turn = turns.get(marker) ?? 0;
    turns.set(marker, turn + 1);
    return turn === 0
      ? {
          toolCall: {
            name: 'bash',
            arguments: { command: `printf '%s\\n' '${marker}' >> runner-proof.txt` },
          },
        }
      : { content: `Completed ${marker}.` };
  });
  const server = await bootRealServer({ providerBaseUrl: provider.url, claimHoldMs: 100 });
  const runners: MachineHandle[] = [];
  const polls = new Map<string, number>();
  const homes = {
    alpha: makeTestTempDir('two-runner-alpha-'),
    beta: makeTestTempDir('two-runner-beta-'),
  };
  async function boot(name: keyof typeof homes) {
    const home = homes[name];
    const paths = statePaths(home);
    const mcpConfigPath = join(home, 'mcp.json');
    writeFileSync(mcpConfigPath, '{}');
    let apiKey: string | undefined;
    if (loadMachineJson(paths) === null) {
      const key = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
        name: `RUNNER_${name.toUpperCase()}`,
        machineAccess: true,
        gitAccess: false,
        mcpAccess: false,
        toolGrants: { read: [], write: [] },
      });
      expect(key.status).toBe(201);
      apiKey = (key.body as { plaintext: string }).plaintext;
    }
    const config = loadDaemonConfig(
      {
        home,
        serverUrl: server.url,
        teamId: server.teamId,
        ...(apiKey !== undefined ? { apiKey } : {}),
        name,
        mcpConfigPath,
        skillsDir: server.skillsDir,
      },
      {},
    );
    const handle = await runMachine({
      config,
      paths,
      logger: createDaemonLogger({ logFile: paths.daemonLog }),
      backend: createPiBackend({
        agentDir: paths.agentRuntimeDir,
        sessionDir: paths.chatSessionsDir,
        skills: { skillsDir: config.skillsDir, cwd: home },
        resolveSessionFile: (id) => resolveSessionFile(paths, id),
        onSession: (id, file) => {
          if (file) recordSession(paths, id, file);
        },
      }),
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init);
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/api/machine/tasks/claim') && response.ok)
          polls.set(name, (polls.get(name) ?? 0) + 1);
        return response;
      },
      idleSleepPrevention: false,
      proxyEnv: {},
      capEnv: {},
      claudeCodeAuthProbe: async () => ({ state: 'not-logged-in', provider: 'firstParty' }),
      heartbeatIntervalMs: 200,
      presenceIntervalMs: 500,
      claimBackoffBaseMs: 50,
      confinementPreflight: CONFINEMENT_READY_LAUNCH,
    });
    runners.push(handle);
    return { handle, paths };
  }
  async function startTask(marker: string, machineId: string) {
    const world = await seedWorld(server.url, server.teamId, {
      title: marker,
      spec: `Write ${marker} into runner-proof.txt in this task's workspace.`,
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      routeOverride: { machineId },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
    return { ...world, buildId };
  }
  async function assertCompleted(
    task: Awaited<ReturnType<typeof startTask>>,
    owner: Awaited<ReturnType<typeof boot>>,
    other: Awaited<ReturnType<typeof boot>>,
    marker: string,
  ) {
    await waitFor(() => server.todoPhase(task.todoId) === 'review', 90_000);
    const steps = server.db.select().from(step).where(eq(step.buildId, task.buildId)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'done', machineId: owner.handle.machineId });
    expect(
      readFileSync(join(owner.paths.workspacesDir, task.buildId, 'runner-proof.txt'), 'utf8'),
    ).toBe(`${marker}\n`);
    expect(existsSync(join(other.paths.workspacesDir, task.buildId))).toBe(false);
    const transcript = await api(server.url, 'GET', `/api/conversations/${task.buildId}/messages`);
    expect(transcript.status).toBe(200);
    expect(JSON.stringify(transcript.body)).toContain(`Completed ${marker}.`);
    const client = new MachineClient({
      serverUrl: server.url,
      getToken: () => loadMachineJson(owner.paths)!.token,
    });
    const generation = steps[0]!.claimedAt!;
    await client.done(steps[0]!.id, { status: 'success', generation });
    await expect(
      client.done(steps[0]!.id, { status: 'failed', generation: generation - 1 }),
    ).rejects.toMatchObject({ status: 409 });
    const stranger = new MachineClient({
      serverUrl: server.url,
      getToken: () => loadMachineJson(other.paths)!.token,
    });
    await expect(
      stranger.done(steps[0]!.id, { status: 'failed', generation }),
    ).rejects.toMatchObject({ status: 404 });
    expect(server.db.select().from(step).where(eq(step.buildId, task.buildId)).all()).toEqual(
      steps,
    );
  }
  try {
    const alpha = await boot('alpha');
    const beta = await boot('beta');
    expect(alpha.handle.machineId).not.toBe(beta.handle.machineId);
    expect(loadMachineJson(alpha.paths)?.token).not.toBe(loadMachineJson(beta.paths)?.token);
    const first = await startTask('alpha-proof', alpha.handle.machineId);
    const second = await startTask('beta-proof', beta.handle.machineId);
    await assertCompleted(first, alpha, beta, 'alpha-proof');
    await assertCompleted(second, beta, alpha, 'beta-proof');

    await beta.handle.stop();
    await beta.handle.done;
    await alpha.handle.stop();
    await alpha.handle.done;
    await waitFor(
      () =>
        server.db.select().from(machine).where(eq(machine.id, beta.handle.machineId)).get()
          ?.online === false,
    );
    const queued = await startTask('beta-after-restart', beta.handle.machineId);
    expect(server.todoPhase(queued.todoId)).toBe('queued');
    const history = await api(server.url, 'GET', `/api/conversations/${first.buildId}/messages`);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain('Completed alpha-proof.');
    const returnedAlpha = await boot('alpha');
    expect(returnedAlpha.handle.machineId).toBe(alpha.handle.machineId);
    const before = polls.get('alpha') ?? 0;
    await waitFor(() => (polls.get('alpha') ?? 0) >= before + 3);
    expect(server.todoPhase(queued.todoId)).toBe('queued');
    expect(
      server.db.select().from(step).where(eq(step.buildId, queued.buildId)).all(),
    ).toMatchObject([{ status: 'pending', machineId: null }]);
    expect(turns.has('beta-after-restart')).toBe(false);
    expect(existsSync(join(alpha.paths.workspacesDir, queued.buildId))).toBe(false);

    const restarted = await boot('beta');
    expect(restarted.handle.machineId).toBe(beta.handle.machineId);
    await assertCompleted(queued, restarted, returnedAlpha, 'beta-after-restart');
    expect(
      readFileSync(join(beta.paths.workspacesDir, second.buildId, 'runner-proof.txt'), 'utf8'),
    ).toBe('beta-proof\n');
  } finally {
    await Promise.allSettled(
      runners.map(async (runner) => {
        await runner.stop();
        await runner.done;
      }),
    );
    await server.close();
    await provider.close();
  }
}, 180_000);
