import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_TOOL_SHELL } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  agent as agentTable,
  machine as machineTable,
  message as messageTable,
  shellCommand as shellCommandTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
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

const MARKER = 'SHELL-E2E-MARKER-110';
const COMMAND = `echo ${MARKER}`;
const MACHINE_NAME = 'shell-e2e-mbp';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world: { projectId: string; todoId: string };
let buildId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    { toolCall: { name: 'remote_shell', arguments: { command: COMMAND } } },
    { toolCall: { name: 'bash', arguments: { command: 'printf "shell probe\\n" >> README.md' } } },
    { content: '命令已执行。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  server.db
    .update(agentTable)
    .set({ tools: ['合并分支', '推送分支', AGENT_TOOL_SHELL] })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  home = mkdtempSync(join(tmpdir(), 'cairn-it-shell-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: MACHINE_NAME,
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
  await waitFor(
    () =>
      server.db.select().from(machineTable).where(eq(machineTable.name, MACHINE_NAME)).get() !==
      undefined,
    30_000,
  );
  server.db
    .update(machineTable)
    .set({ shellEnabled: true })
    .where(eq(machineTable.name, MACHINE_NAME))
    .run();
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

describe('XMON-110 remote_shell full-chain E2E (precheck → execute → audit row final state)', () => {
  test('one real command walks the whole chain: audit row done + exitCode/output correct + agent receives the output', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'shell 全链探针', spec: '执行命令并汇报输出。' },
      { projectName: 'shell-e2e' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    const rows = server.db.select().from(shellCommandTable).all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.command).toBe(COMMAND);
    expect(row.status).toBe('done');
    expect(row.exitCode).toBe(0);
    expect(row.output ?? '').toContain(MARKER);
    expect(row.errorMessage).toBeNull();
    expect(row.finishedAt).not.toBeNull();
    const stepIds = server.db
      .select({ id: stepTable.id })
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .map((s) => s.id);
    expect(stepIds).toContain(row.stepId);

    expect(logLines().some((l) => l.includes('shell allowed') && l.includes(`run=${row.id}`))).toBe(
      true,
    );
    expect(logLines().some((l) => l.includes('shell done') && l.includes('exit=0'))).toBe(true);

    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain(MARKER);
  }, 150_000);
});
