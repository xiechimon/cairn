import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { runMachine } from '../../apps/daemon/src/machine-loop.js';
import { statePaths } from '../../apps/daemon/src/state.js';
import { step } from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, daemonLogLines, seedWorld, waitFor } from './helpers.js';
import { startStubLlm } from './stub-llm.js';

test('message_todo reaches a running daemon and logs the delivered step', async () => {
  const stub = await startStubLlm([{ content: 'Working on the task.', delayMs: 8_000 }]);
  const server = await bootRealServer({ providerBaseUrl: stub.url });
  const home = mkdtempSync(join(tmpdir(), 'cairn-message-todo-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'message-todo-machine',
      skillsDir: server.skillsDir,
      mcpConfigPath: server.mcpConfigPath,
    },
    {},
  );
  const paths = statePaths(config.home, config.workspacesDir);
  const handle = await runMachine({
    config,
    paths,
    logger: createDaemonLogger({ logFile: paths.daemonLog }),
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  try {
    await waitFor(
      () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
      30_000,
    );
    const world = await seedWorld(server.url, server.teamId, {
      title: 'Message a running worker',
      spec: 'Respond briefly.',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
    await waitFor(
      () => daemonLogLines(paths.daemonLog).some((line) => line.includes(`new session ${buildId}`)),
      30_000,
    );
    const running = server.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
    const issued = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
      name: 'message-todo',
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: [], write: ['Message Todo'] },
    });
    expect(issued.status).toBe(201);
    const response = await fetch(`${server.url}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${(issued.body as { plaintext: string }).plaintext}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'message_todo',
          arguments: { todoId: world.todoId, content: 'Include regression coverage.' },
        },
      }),
    });
    const result = (await response.json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(result.result.isError).not.toBe(true);
    expect(JSON.parse(result.result.content[0]!.text)).toMatchObject({
      posted: true,
      delivered: 'steer',
    });
    await waitFor(
      () =>
        daemonLogLines(paths.daemonLog).some((line) =>
          line.includes(`steer delivered step=${running.id}`),
        ),
      30_000,
    );
    process.stdout.write(`Verified daemon log: steer delivered step=${running.id}\n`);
  } finally {
    await handle.stop();
    await handle.done;
    await server.close();
    await stub.close();
    rmSync(home, { recursive: true, force: true });
  }
});
