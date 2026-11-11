import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBackend } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../../apps/daemon/src/backend/pi.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { runMachine } from '../../apps/daemon/src/machine-loop.js';
import { statePaths } from '../../apps/daemon/src/state.js';
import { step } from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { api, bootRealServer, CONFINEMENT_READY_LAUNCH, seedWorld, waitFor } from './helpers.js';

test('a running daemon step completes after a same-port server restart without a daemon restart', async () => {
  const dbPath = join(makeTestTempDir('deploy-restart-db-'), 'server.db');
  const home = makeTestTempDir('deploy-restart-daemon-');
  let finish = () => {};
  const running = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let starts = 0;
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      starts += 1;
      return {
        sessionId: 'deploy-survivor',
        events: (async function* () {
          await running;
          writeFileSync(
            join(opts.cwd, 'plan.md'),
            '# Restart probe\n\n## Verification\n\nRun the probe.\n',
          );
          yield { type: 'text_delta' as const, text: 'survived restart' };
          yield { type: 'done' as const, usage: [] };
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession() {
      throw new Error('unexpected session recovery');
    },
  };
  let server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9', dbPath });
  const port = Number(new URL(server.url).port);
  const config = loadDaemonConfig({
    home,
    serverUrl: server.url,
    apiKey: server.apiKey,
    teamId: server.teamId,
    name: 'deploy-survivor',
  });
  const daemon = await runMachine({
    config,
    paths: statePaths(home, config.workspacesDir),
    logger: createDaemonLogger({}),
    backend,
    idleSleepPrevention: false,
    heartbeatIntervalMs: 100,
    presenceIntervalMs: 60_000,
    claimBackoffBaseMs: 10,
    proxyEnv: {},

    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  try {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'Server restart probe',
      spec: 'Keep this step running across a transport restart.',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
    });
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
    await waitFor(() => starts === 1, 30_000);
    const before = server.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
    expect(before.status).toBe('claimed');
    await server.close();
    server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9', dbPath, port });
    await waitFor(
      () =>
        (server.db.select().from(step).where(eq(step.id, before.id)).get()?.lastHeartbeatAt ?? 0) >
        (before.lastHeartbeatAt ?? 0),
      10_000,
    );
    finish();
    await waitFor(
      () => server.db.select().from(step).where(eq(step.id, before.id)).get()?.status === 'done',
      30_000,
    );
    expect(starts).toBe(1);
  } finally {
    finish();
    await daemon.stop();
    await daemon.done;
    await server.close();
  }
}, 60_000);
