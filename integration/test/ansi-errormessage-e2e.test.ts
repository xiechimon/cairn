import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { build as buildTable, step as stepTable } from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, seedWorld, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const BIOME_FIXTURE = fileURLToPath(new URL('./fixtures/biome-ansi-coloured.txt', import.meta.url));

const EXPECTED_HEAD =
  'git commit failed (1): apps/daemon/test/1262-ansi-probe.ts:1:7 lint/correctness/noUnusedVariables';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let todoId = '';
let buildId = '';

afterAll(async () => {
  const diagPhase = todoId !== '' && server ? server.todoPhase(todoId) : 'n/a';
  const diagLog =
    home !== undefined && existsSync(paths.daemonLog)
      ? readFileSync(paths.daemonLog, 'utf8').split('\n').slice(-50).join('\n')
      : '(no log)';
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  process.stdout.write(`\n[diag] todo phase: ${diagPhase}\n[diag] daemon.log tail:\n${diagLog}\n`);
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

describe('#1262 E2E: lint-failed commit → errorMessage persisted as plain text', () => {
  test('pre-commit colored biome output → failed → build.errorMessage unescaped, first line readable', async () => {
    stub = await startStubLlm([
      {
        toolCall: {
          name: 'bash',
          arguments: { command: 'printf "1262 probe\\n" >> README.md' },
        },
      },
      { content: '修改完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
    home = mkdtempSync(join(tmpdir(), 'cairn-1262-home-'));
    const config = loadDaemonConfig(
      {
        serverUrl: server.url,
        apiKey: server.apiKey,
        teamId: server.teamId,
        home,
        name: '1262-mbp',
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
    await waitFor(
      () =>
        existsSync(paths.daemonLog) &&
        readFileSync(paths.daemonLog, 'utf8').includes('[wake] push channel connected'),
      30_000,
    );

    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: '1262 ANSI 探针', spec: '在 README.md 追加一行。' },
      { repoKind: 'hosted', projectName: 'ansi-lint-hook' },
    );
    todoId = world.todoId;

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    const baseGitDir = join(paths.workspacesDir, world.projectId, 'repo', '.git');
    await waitFor(() => existsSync(baseGitDir), 60_000);
    const hookPath = join(baseGitDir, 'hooks', 'pre-commit');
    writeFileSync(hookPath, `#!/bin/sh\ncat "${BIOME_FIXTURE}" >&2\nexit 1\n`, { mode: 0o755 });
    chmodSync(hookPath, 0o755);

    await waitFor(() => server.todoPhase(todoId) === 'failed', 120_000);

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps.some((s) => s.status === 'failed')).toBe(true);

    const buildRow = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).not.toBeNull();
    expect(buildRow.errorMessage).not.toContain('\x1b');
    expect(buildRow.errorMessage).not.toContain(']8;;');
    const firstLine = buildRow.errorMessage!.split('\n')[0]!;
    expect(firstLine.startsWith(EXPECTED_HEAD)).toBe(true);
  });
});
