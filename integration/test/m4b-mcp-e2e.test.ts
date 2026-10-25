import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { message as messageTable, todo as todoTable } from '../../apps/server/src/db/schema.js';
import { createApiKey } from '../../apps/server/src/services/api-keys.js';
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
let world: { projectId: string; todoId: string };
let buildId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  external = await startExternalMcp();
  home = mkdtempSync(join(tmpdir(), 'cairn-m4b-mcp-home-'));
  mcpConfig = join(home, 'claude.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        demo: { url: external.url, headers: { Authorization: 'Bearer demo-secret' } },
        dead: { url: 'http://127.0.0.1:1/mcp' },
        unselected: { url: 'http://127.0.0.1:1/mcp' },
      },
    }),
    'utf8',
  );
  stub = await startStubLlm([
    {
      toolCall: { name: 'read_mcp_resource', arguments: { server: 'demo', uri: 'demo://note' } },
    },
    { toolCall: { name: 'mcp__demo__echo', arguments: { text: 'm4b-bridge' } } },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mcp probe line\\n" >> README.md' } },
    },
    { content: '已通过外部 MCP 工具 echo 验证连通。' },
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
      name: 'm4b-mcp-mbp',
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
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  await external?.close();
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('MCP client face E2E: local config registration + per-Agent slug authorization + daemon local resolution bridge (spec 13)', () => {
  test('server projection = config mirror (secret values never leave the API); authorized build step calls external tools for real; dead endpoint/unknown slug degrade without blocking', async () => {
    const list = await api(server.url, 'GET', `/api/teams/${server.teamId}/mcp-servers`);
    expect(list.status).toBe(200);
    const rows = list.body as {
      slug: string;
      transport: string;
      hasCredential: boolean;
      credentialKeys: string[];
    }[];
    expect(rows.map((r) => r.slug).sort()).toEqual(['dead', 'demo', 'unselected']);
    expect(rows.find((r) => r.slug === 'demo')).toMatchObject({
      transport: 'http',
      hasCredential: true,
      credentialKeys: ['Authorization'],
    });
    expect(JSON.stringify(rows)).not.toContain('demo-secret');

    const authed = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/agents/${AGENT_ID}`,
      {
        mcpServers: ['demo', 'dead', 'ghost'],
      },
    );
    expect(authed.status).toBe(200);

    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'MCP 桥接探针', spec: '调用外部 echo 工具验证连通。' },
      { projectName: 'm4b-mcp' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    expect(external.calls).toEqual([{ name: 'echo', args: { text: 'm4b-bridge' } }]);

    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain('mcp__demo__echo');

    const firstRequest = stub.requests[0] as
      | { tools?: { function?: { name?: string } }[] }
      | undefined;
    const firstRequestTools = firstRequest?.tools ?? [];
    const declared = firstRequestTools.map((t) => t.function?.name ?? '').filter((n) => n !== '');
    expect(declared).toContain('mcp__demo__echo');
    expect(declared).toContain('read_mcp_resource');
    expect(JSON.stringify(msgs)).toContain('demo-note-content');

    const lines = logLines();
    expect(
      lines.some((l) =>
        l.includes('[mcp] dead: connect failed — its tools are unavailable this turn'),
      ),
    ).toBe(true);
    expect(
      lines.some((l) =>
        l.includes('[mcp] ghost: not in local config — its tools are unavailable this turn'),
      ),
    ).toBe(true);
    const loadedLine = lines.find((l) => l.startsWith(`[mcp] loaded from ${mcpConfig}`));
    expect(loadedLine).toBe(`[mcp] loaded from ${mcpConfig}: demo, dead`);
    expect(JSON.stringify(msgs)).not.toContain('mcp__unselected');
  }, 150_000);
});

describe('M4b MCP server face E2E: real sdk Client against /api/mcp (02 §7.2)', () => {
  test('Bearer key + allowlist full round trip: initialize/list/call; unauthorized tool denied; owner identity persisted', async () => {
    const key = createApiKey(
      { db: server.db },
      {
        teamId: server.teamId,
        name: 'mcp-client-e2e',
        gitAccess: false,
        mcpAccess: true,
        toolGrants: { read: ['Todos', 'Projects'], write: ['Create Todo'] },
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key.plaintext}` } },
    });
    const client = new Client({ name: 'e2e-mcp-client', version: '1.0' });
    await client.connect(transport);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(['create_todo', 'projects', 'todos']);

    const created = await client.callTool({
      name: 'create_todo',
      arguments: { projectId: world.projectId, title: 'MCP 客户端建的任务', spec: '外部客户端建' },
    });
    const text = JSON.stringify(created.content);
    expect(text).toContain('MCP 客户端建的任务');
    const row = server.db
      .select()
      .from(todoTable)
      .all()
      .find((t) => t.title === 'MCP 客户端建的任务');
    expect(row).toBeDefined();
    expect(row!.ownerId).not.toBeNull();

    let denied = false;
    try {
      const res = await client.callTool({ name: 'machines', arguments: {} });
      denied = res.isError === true;
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);

    await client.close();
  }, 120_000);

  test('registry allowlist shape: 24 = 11 read + 13 write (02/A10 single-source cross-check)', () => {
    expect(MCP_TOOL_REGISTRY).toHaveLength(24);
    expect(MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read')).toHaveLength(11);
    expect(MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write')).toHaveLength(13);
  });
});
