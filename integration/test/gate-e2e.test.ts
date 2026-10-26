import { rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPiBackend } from '../../apps/daemon/src/backend/pi.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import {
  recordSession,
  resolveSessionFile,
  type StatePaths,
  statePaths,
} from '../../apps/daemon/src/state.js';
import { message as messageTable, todo as todoTable } from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  startExternalMcp,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let external: Awaited<ReturnType<typeof startExternalMcp>>;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let mcpConfig: string;
let buildId = '';
let world: { projectId: string; todoId: string };

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  external = await startExternalMcp();
  home = makeTestTempDir('cairn-gate-home-');
  mcpConfig = join(home, 'claude.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        demo: { url: external.url, headers: { Authorization: 'Bearer gate-secret' } },
      },
    }),
    'utf8',
  );
  stub = await startStubLlm([
    { toolCall: { name: 'bash', arguments: { command: 'rm -rf /' } } },
    { toolCall: { name: 'mcp__demo__echo', arguments: { text: 'gate-probe' } } },
    { toolCall: { name: 'bash', arguments: { command: 'printf "gate probe\\n" >> README.md' } } },
    { content: '闸双向验证完成。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
    mcpConfigPath: mcpConfig,
  });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'gate-mbp',
      mcpConfigPath: mcpConfig,
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
    backend: createPiBackend({
      agentDir: paths.agentRuntimeDir,
      sessionDir: paths.chatSessionsDir,
      skills: { skillsDir: config.skillsDir, cwd: config.home },
      resolveSessionFile: (sid) => resolveSessionFile(paths, sid),
      onSession: (sid, file) => {
        if (file) recordSession(paths, sid, file);
      },
      onMcpLog: (msg) => logger.mcp(msg),
      onSkillsLog: (msg) => logger.skills(msg),
      onGateLog: (msg) => logger.gate(msg),
      machineName: config.name,
      gateRules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
    }),
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  await external?.close();
  const diagTail = logLines().slice(-30).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('#929 command gate tool_call seam E2E: both directions + MCP coverage', () => {
  test('reject and allow each land where they should: irreversible bash form denied (reason into transcript), MCP call passes the same gate, legal bash change lands', async () => {
    const authed = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/agents/${AGENT_ID}`,
      { mcpServers: ['demo'] },
    );
    expect(authed.status).toBe(200);

    world = await seedWorld(
      server.url,
      server.teamId,
      { title: '命令闸探针', spec: '验证闸的双向行为。' },
      { projectName: 'gate-e2e' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    const lines = logLines();
    expect(lines.some((l) => l.includes('[gate] ask: rule=ask-rm-rf-root command=rm -rf /'))).toBe(
      true,
    );
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    const transcript = JSON.stringify(msgs);
    expect(transcript).toContain('command gate (ask-rm-rf-root)');
    expect(transcript).toContain('requires approval, and this daemon runs unattended');

    expect(
      lines.some((l) => l.includes('[gate] reject: rule=deny-echo tool=mcp__demo__echo')),
    ).toBe(true);
    expect(transcript).toContain('tool gate (deny-echo)');
    expect(external.calls).toEqual([]);

    expect(transcript).toContain('gate probe');
    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get();
    expect(todoRow?.phase).toBe('review');
  }, 150_000);
});
