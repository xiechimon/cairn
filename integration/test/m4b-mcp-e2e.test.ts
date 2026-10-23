// M4b MCP 双面 E2E（02 §7，00/D4 薄桥两侧实跑；spec 13/#368 本地 config 制）：
// ① client 面（外部 MCP → Agent）：本机 config 文件登记（~/.claude.json 同形
//    fixture，server 展示面与 daemon 执行面各读各机——本测单机退化形读同一
//    份）+ per-Agent 授权（PATCH agents mcpServers[] slug 勾选，未知键容忍）
//    → claim 载荷携带 slug 列表（string[]，版本墙内）→ daemon 读本机 config
//    解析端点 → per-turn 连接 → pi 工具 `mcp__<slug>__<tool>` 真调用外部
//    server → transcript 工具行落库；坏端点降级不阻断（canon 行 `[mcp] dead:
//    connect failed — …`，r3 §1.5）；config 未命中 slug 走扩展降级行（`[mcp]
//    ghost: not in local config — …`，spec 13）。
// ② server 面（外部 MCP 客户端 ← cairn）：真 sdk Client（StreamableHTTP）连
//    /api/mcp，Bearer apiKey + key 级白名单（initialize/tools/list/tools/call
//    全往返）；未授工具 call 被拒（limits every call）；create_todo 以 key 属主
//    身份落库。

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
  // spec 13（#368）：MCP 登记面 = 本机 config 文件——一个活端点（headers
  // 凭证只落此文件）+ 一个死端点；server 展示面与 daemon 执行面同指本
  // fixture（单机退化形；多机 = 各读各机，见 spec 13 Q6）。
  mcpConfig = join(home, 'claude.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        demo: { url: external.url, headers: { Authorization: 'Bearer demo-secret' } },
        dead: { url: 'http://127.0.0.1:1/mcp' },
        // #930 授权面排除方向：config 有、agent 未勾选 → 不得出现（勾选表
        // 唯一决定谁能出现）。
        unselected: { url: 'http://127.0.0.1:1/mcp' },
      },
    }),
    'utf8',
  );
  stub = await startStubLlm([
    // worker 执行步轮 1：读外部资源（#930 resources 能力立证——pi 原生
    // read_mcp_resource 工具，仅 server 声明 resources 能力时注册）。
    {
      toolCall: { name: 'read_mcp_resource', arguments: { server: 'demo', uri: 'demo://note' } },
    },
    // 轮 2：调桥接工具 mcp__demo__echo（外部 MCP server 真调用）。
    { toolCall: { name: 'mcp__demo__echo', arguments: { text: 'm4b-bridge' } } },
    // 轮 3：真做一处改动（#703 闸 2——执行步无改动过不了 review 闸）。
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mcp probe line\\n" >> README.md' } },
    },
    // 轮 4：收尾。
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

describe('MCP client 面 E2E：本机 config 登记 + per-Agent slug 授权 + daemon 本机解析桥接（spec 13）', () => {
  test('server 展示面 = config 投影（密钥值不上接口）；授权后执行步真调外部工具；死端点/未知 slug 降级不阻断', async () => {
    // server 展示面：GET mcp-servers = 本机 config 投影（record 保形；
    // headers 值永不出接口——只 hasCredential/credentialKeys 键名）。
    const list = await api(server.url, 'GET', `/api/teams/${server.teamId}/mcp-servers`);
    expect(list.status).toBe(200);
    const rows = list.body as {
      slug: string;
      transport: string;
      hasCredential: boolean;
      credentialKeys: string[];
    }[];
    // 展示面 = 整个 config 的投影（含未勾选的 unselected——登记面人人可
    // 见）；「勾选表决定谁能出现」钉在下方装载行与 transcript 断言。
    expect(rows.map((r) => r.slug).sort()).toEqual(['dead', 'demo', 'unselected']);
    expect(rows.find((r) => r.slug === 'demo')).toMatchObject({
      transport: 'http',
      hasCredential: true,
      credentialKeys: ['Authorization'],
    });
    expect(JSON.stringify(rows)).not.toContain('demo-secret');

    // per-Agent 授权（「授权在每个 Agent 的页面上单独进行」的 REST 面）：
    // 值 = config 键名；ghost 未在 config——静默容忍（解析在 daemon 侧跳过）。
    const authed = await api(
      server.url,
      'PATCH',
      `/api/teams/${server.teamId}/agents/${AGENT_ID}`,
      {
        mcpServers: ['demo', 'dead', 'ghost'],
      },
    );
    expect(authed.status).toBe(200);

    // 派工执行步（无 repo 裸任务目录即可——本测证桥接不证 git）。
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

    // 外部 MCP server 真收到调用（薄桥端到端实证：daemon 本机 config 解析 →
    // pi 原生 MCP → 外部 server），工具名映射 mcp__demo__echo。
    expect(external.calls).toEqual([{ name: 'echo', args: { text: 'm4b-bridge' } }]);

    // transcript 工具行落库（bridge 工具名 = mcp__<slug>__<tool>，r3 §5.1）。
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain('mcp__demo__echo');

    // #930 新增能力立证（resources 工具可用）：首轮请求的 tools 声明含
    // read_mcp_resource（server 有 resources 时 pi 注册直报），调用结果进
    // transcript（资源内容真实可读——「挑一条断言，别只声明」）。
    const firstRequest = stub.requests[0] as
      | { tools?: { function?: { name?: string } }[] }
      | undefined;
    const firstRequestTools = firstRequest?.tools ?? [];
    const declared = firstRequestTools.map((t) => t.function?.name ?? '').filter((n) => n !== '');
    expect(declared).toContain('mcp__demo__echo');
    expect(declared).toContain('read_mcp_resource');
    expect(JSON.stringify(msgs)).toContain('demo-note-content');

    // 降级面三行（回合照常完成，r3 §1.5 canon 行形 + spec 13 扩展行）：
    // 死端点 = connect failed；config 未命中 = not in local config；
    // loaded 行打出实际加载集与来源文件（多机跑偏一眼可见，premortem 护栏二）。
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
    // 装载行整行精确匹配 = 授权面排除方向同时钉住：config 里勾选表
    // （PATCH mcpServers=[demo, dead, ghost]）没勾的 `unselected` 不得出现
    // （substring 匹配会漏「demo, dead, unselected」形，故用整行相等）。
    const loadedLine = lines.find((l) => l.startsWith(`[mcp] loaded from ${mcpConfig}`));
    expect(loadedLine).toBe(`[mcp] loaded from ${mcpConfig}: demo, dead`);
    expect(JSON.stringify(msgs)).not.toContain('mcp__unselected');
  }, 150_000);
});

describe('M4b MCP server 面 E2E：真 sdk Client 连 /api/mcp（02 §7.2）', () => {
  test('Bearer key + 白名单全往返：initialize/list/call；未授工具被拒；属主身份落库', async () => {
    // key：MCP 访问开 + 部分授权（读 Todos/Projects + 写 Create Todo）。
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

    // tools/list = 授出三件（key's tool selection limits every call）。
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(['create_todo', 'projects', 'todos']);

    // tools/call create_todo → 以 key 属主身份落库（r3 §5.2）。
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

    // 未授工具（machines 未勾）→ 拒绝面（isError 或 JSON-RPC error）。
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

  test('注册表白名单保形：24 件 = 读 11 + 写 13（02/A10 单源对拍）', () => {
    expect(MCP_TOOL_REGISTRY).toHaveLength(24);
    expect(MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read')).toHaveLength(11);
    expect(MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write')).toHaveLength(13);
  });
});
