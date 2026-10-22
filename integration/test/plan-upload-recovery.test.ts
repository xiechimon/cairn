// #1026 + #1028（#904 调研副产物 2/4）终稿回传通道的失败恢复面——集成级：
// 真进程（daemon 子进程 SIGKILL 重启；server = bootRealServer 关停重开同
// 端口 + 同文件库 = 进程重启的持久化语义），失败注入 = 可控代理（按路径掐
// done）或 server 关停（上传窗 ECONNREFUSED）。
// 场景清单（先固化，代码是让场景通过的手段）：
//  1. 「PUT 成功 / done 失败 → 恢复」：plan.md 已落库（v1）、done 被掐 →
//     daemon 重启 recover 快路径补报——不重跑 agent 轮（stub 请求数不变、
//     无新会话行）、plan 表不出现同内容重复版本（行 id 不变）；
//  2. server 于收尾窗关停（上传重试耗尽 → journal 残留）→ 同端口重开 →
//     daemon 重启 → 快路径重取 URL 补报完成；
//  3. 旧预签名 URL 在 server 重启后的行为：同库重开（进程内存归零）→ 旧
//     URL PUT = 404（可解释）→ 重发 URL → PUT 200 落库（恢复不依赖进程
//     内存、不重跑会话）。

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { Agent, createServer as createTcpServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ClaimedStep, claimedStepSchema, ENV_VARS, PLAN_FILE_NAME } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  plan as planTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { createApiKey } from '../../apps/server/src/services/api-keys.js';
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

const DAEMON_DIR = fileURLToPath(new URL('../../apps/daemon', import.meta.url));
const PLAN_CONTENT =
  '# 方案\n\nContext: 恢复探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\n';

/** 可控代理（daemon → server 的机器面）：forward = 全转发（SSE/长轮询透传，
 * Host 保留 = 预签名 URL 的 origin 落在代理上，daemon 的 PUT 同样过代理）；
 * dropDone = 只掐 `/api/machine/done/*`（「PUT 成功 / done 失败」的确定性
 * 注入——连接级销毁 = done 请求网络失败，不碰上传路径）。 */
async function startProxy(target: string): Promise<{
  url: string;
  forward(): void;
  dropDone(): void;
  close(): Promise<void>;
}> {
  let drop = false;
  // 无 keep-alive 池 + 客户端断开即断上游（SSE 长连随 daemon SIGKILL 收口，
  // 不留孤儿上游连挂住测试进程事件循环）。
  const agent = new Agent({ keepAlive: false });
  const server = createTcpServer((req, res) => {
    if (drop && (req.url ?? '').startsWith('/api/machine/done/')) {
      req.destroy();
      res.destroy();
      return;
    }
    const upstream = request(
      `${target}${req.url}`,
      {
        method: req.method,
        headers: { ...req.headers, host: req.headers.host ?? '' },
        agent,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    // 断连追踪挂 res（IncomingMessage 的 'close' = 请求收完即触发，会提前
    // 炸上游；res 的 'close' 才是「客户端连接没了」——daemon SIGKILL 后 SSE
    // 长连在此收口，不留孤儿上游）。
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    forward: () => {
      drop = false;
    },
    dropDone: () => {
      drop = true;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        agent.destroy();
        server.close(() => resolve());
      }),
  };
}

let stub: StubLlm;
let server: RealServer;
let home: string;
const children: ChildProcess[] = [];
let proxyHandle: Awaited<ReturnType<typeof startProxy>> | null = null;

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await proxyHandle?.close();
  await server?.close();
  await stub?.close();
});

/** spawn 真 daemon 子进程。apiKey 显式传（#1028 重启对拍：server B 重 boot
 * 会签发新 key，但机器身份 = (apiKeyId, teamId)——daemon 2 必须持 A 的 key
 * enroll 才能复用 machineId，recover 才对得上步的归属机器）。 */
function spawnDaemon(serverUrl: string, name: string, apiKey: string): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      serverUrl,
      '--api-key',
      apiKey,
      '--team',
      server.teamId,
      '--name',
      name,
    ],
    {
      cwd: DAEMON_DIR,
      env: {
        ...process.env,
        [ENV_VARS.home]: home,
        // 代理变量清空：本机 dev 代理不得介入 localhost 集成链路。
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  return child;
}

function logLines(): string[] {
  return daemonLogLines(join(home, 'daemon.log'));
}

async function startBuild(
  title: string,
  spec: string,
  projectName: string,
): Promise<{ buildId: string; todoId: string; projectId: string }> {
  const world = await seedWorld(server.url, server.teamId, { title, spec }, { projectName });
  const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
    todoIds: [world.todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: true,
  });
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
  return { buildId, todoId: world.todoId, projectId: world.projectId };
}

/** journal 残留读取（#1026 快路径素材面：state + doneBody）。注意排除
 * `step-<id>.transcript.json` 缓冲文件（同名前缀，非 journal 条目）。 */
function readJournal(): { state: string; doneBody?: unknown } | null {
  const dir = join(home, 'outbox');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(
    (f) => f.startsWith('step-') && f.endsWith('.json') && !f.endsWith('.transcript.json'),
  );
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as {
      state: string;
      doneBody?: unknown;
    };
  } catch {
    return null;
  }
}

function planRows(buildId: string) {
  return server.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
}

/** 等待 plan.md 产物落库（v1 在位——「PUT 成功」腿的物证）。 */
async function waitForPlanRow(buildId: string) {
  await waitFor(() => planRows(buildId).length > 0);
}

describe('#1026/#1028 终稿回传失败恢复（真进程重启）', () => {
  test('PUT 成功 / done 失败 → daemon 重启快路径补报：不重跑会话、无重复版本', async () => {
    stub = await startStubLlm([
      // pi 内建 bash 真执行：round 1 写 plan.md（产物闸 1 素材）。
      {
        toolCall: {
          name: 'bash',
          arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_CONTENT}EOF` },
        },
      },
      { content: '规划完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500 });
    home = mkdtempSync(join(tmpdir(), 'pacman-plan-uploads-'));
    proxyHandle = await startProxy(server.url);
    const { buildId } = await startBuild(
      '幂等恢复探针',
      '写一行探针到 README.md',
      'it-project-idem',
    );

    // 「done 失败」注入：代理从 t=0 起只掐 done——上传路径全程放行。
    proxyHandle.dropDone();
    const first = spawnDaemon(proxyHandle.url, 'idem-mbp', server.apiKey);
    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 90_000);
    // done 被掐（收尾 catch 落「done report failed」行 = runStep 已退、残留
    // 定型——代理全程掐 done，不存在 done 侥幸成功面）。
    await waitFor(() => logLines().some((l) => l.includes('done report failed')), 30_000);

    // 残留态 = 票面场景：「PUT 成功」（plan v1 已落库、行 id 钉住）+「done
    // 失败」（步仍 claimed、journal awaiting-upload 携终稿快照）。
    await waitForPlanRow(buildId);
    const firstRow = planRows(buildId)[0]!;
    const residue = readJournal();
    expect(residue?.state).toBe('awaiting-upload');
    expect(residue?.doneBody).toMatchObject({ status: 'success' });
    const stepRow = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    expect(stepRow.status).toBe('claimed');
    const requestsBefore = stub.requests.length;

    // 恢复：done 放行 + daemon 真重启（SIGKILL → 重生）→ recover 快路径。
    proxyHandle.forward();
    first.kill('SIGKILL');
    await new Promise<void>((resolve) => first.once('exit', () => resolve()));
    const second = spawnDaemon(proxyHandle.url, 'idem-mbp', server.apiKey);
    await waitFor(
      () => logLines().some((l) => l.includes('[recover] 1 pending step(s) found')),
      60_000,
    );
    await waitFor(
      () => logLines().some((l) => l.includes('awaiting upload — replaying final report')),
      30_000,
    );
    await waitFor(
      () =>
        server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()?.status ===
        'done',
      60_000,
    );

    // ① 不出现同内容重复版本：仍 1 行、同 id、同 version（快路径的重传被
    // 「步+内容」幂等吸收，不是没传——done 到达前上传必须已成功）。
    const rows = planRows(buildId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstRow.id);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.content).toBe(PLAN_CONTENT);
    // ② 不新增 agent 轮次：stub 请求数不变、会话行只有首个 daemon 的一条。
    expect(stub.requests.length).toBe(requestsBefore);
    const lines = logLines();
    expect(lines.filter((l) => l.includes(`new session ${buildId}`))).toHaveLength(1);
    expect(lines.some((l) => l.includes(`continue session ${buildId}`))).toBe(false);
    // 快路径补报完成即清残留——但 journal.remove 落在 daemon 侧 done 响应
    // 回来之后（runner.ts 快路径：client.done → journal.remove），而上面的
    // status 翻转是 server 侧观测，两者隔一个响应往返的窗：负载机上即读会
    // 抢在 unlink 前（CI run 38012389260 输在这个窗）。语义是「最终清掉」，
    // 断言按语义等有界等待，不钉实现时序。
    await waitFor(() => readJournal() === null, 30_000);

    second.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5_000);
      second.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }, 240_000);

  test('server 收尾窗关停 → 同端口重开 → 旧 URL 404（可解释）→ 重发 URL 落库 → daemon 重启快路径补报', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pacman-plan-restart-')), 'pacman.db');
    let serverClosed = false;
    stub = await startStubLlm(
      [
        {
          toolCall: {
            name: 'bash',
            arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_CONTENT}EOF` },
          },
        },
        { content: '规划完成。' },
      ],
      {
        // 末轮响应送出即关 server：daemon 消费完末轮进收尾，上传窗撞关停
        // （确定序：res.end 同步调 close——listener 立刻停收，新连接即刻
        // 拒绝；此刻 daemon 还在自己的事件循环里消费 SSE 流）。
        onConsumed: () => {
          if (stub.requests.length >= 2 && !serverClosed) {
            serverClosed = true;
            void server.close();
          }
        },
      },
    );
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500, dbPath });
    const port = Number(new URL(server.url).port);
    home = mkdtempSync(join(tmpdir(), 'pacman-plan-restart-home-'));

    // —— 直连腿（#1028 ①）：本机机器领步 → 预签名 URL → server 重启 → 旧
    // URL 404 → 重发 URL → PUT 200 落库。——
    // 直连机用独立 key：机器身份 = (apiKeyId, teamId)，与 daemon 共用一把 key
    // 会在 daemon enroll 时被 enrollMachine 复用同一条机器行并轮换 token——
    // 直连 token 即刻失效。
    const probeKey = createApiKey(
      { db: server.db },
      {
        teamId: server.teamId,
        name: 'probe-key',
        gitAccess: false,
        mcpAccess: false,
        toolGrants: { read: [], write: [] },
      },
    );
    const direct = await startBuild('旧 URL 探针', '直连机器面探针', 'it-project-stale-url');
    const enrollRes = await fetch(`${server.url}/api/machine/enroll`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${probeKey.plaintext}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ teamId: server.teamId, name: 'probe-mbp', cliVersion: '0.1.0' }),
    });
    const { token } = (await enrollRes.json()) as { token: string };
    const claimRes = await fetch(`${server.url}/api/machine/tasks/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const claimedDirect = claimedStepSchema.parse(
      ((await claimRes.json()) as { step: ClaimedStep }).step,
    );
    const urlsRes = await fetch(`${server.url}/api/machine/upload-urls/${claimedDirect.step.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ name: PLAN_FILE_NAME }] }),
    });
    const oldUrl = ((await urlsRes.json()) as { uploads: { url: string }[] }).uploads[0]!.url;

    // —— daemon 腿（#1028 ②③）：收尾窗 server 关停（上传重试耗尽 → 残留）。——
    const daemonWorld = await startBuild(
      '重启恢复探针',
      '写一行重启探针到 README.md',
      'it-project-restart',
    );
    const apiKeyOfFirstServer = server.apiKey;
    const first = spawnDaemon(server.url, 'restart-mbp', apiKeyOfFirstServer);
    // #1259：本腿双机（probe 直连机 + daemon 机）共用 AGENT_ID——probe 先
    // enroll 吃掉了 helpers 的首台绑定缺省；daemon 腿的步只归 daemon 机，
    // 在它 enroll 落行后把归属机改绑到它（此后 claim 长轮询即领到）。
    await waitFor(() => logLines().some((l) => l.includes('Enrolled in team')), 30_000);
    const daemonMachine = server.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.name, 'restart-mbp'))
      .get();
    if (daemonMachine === undefined) throw new Error('daemon 机器行缺席（enroll 未落库）');
    server.db
      .update(agentTable)
      .set({ machineId: daemonMachine.id })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await waitFor(
      () => logLines().some((l) => l.includes(`new session ${daemonWorld.buildId}`)),
      90_000,
    );
    // 重试耗尽（收尾 catch 落「transcript upload failed」行 = runStep 已退、
    // 残留定型）。
    await waitFor(() => logLines().some((l) => l.includes('transcript upload failed')), 30_000);
    expect(serverClosed).toBe(true);
    const daemonStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, daemonWorld.buildId))
      .get()!;
    expect(daemonStep.status).toBe('claimed');
    expect(planRows(daemonWorld.buildId)).toHaveLength(0);
    const requestsBefore = stub.requests.length;

    // —— server 重启：同 dbPath + 同端口（进程内存归零、DB 持久面全在）。——
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500, dbPath, port });
    expect(server.url).toBe(`http://127.0.0.1:${port}`);

    // 旧预签名 URL 的行为有明确定义：同库重启后 404（uploads Map 是进程
    // 内存，不在 DB——不 401 不 500，是可解释的 upload not found）。
    const staleRes = await fetch(oldUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/markdown' },
      body: PLAN_CONTENT,
    });
    expect(staleRes.status).toBe(404);
    expect(await staleRes.json()).toMatchObject({ error: 'upload not found' });

    // 重发即愈（恢复不依赖进程内存、不重跑会话）：新 URL → PUT 200 → 落库。
    const reissueRes = await fetch(
      `${server.url}/api/machine/upload-urls/${claimedDirect.step.id}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: [{ name: PLAN_FILE_NAME }] }),
      },
    );
    const reissued = ((await reissueRes.json()) as { uploads: { url: string }[] }).uploads[0]!.url;
    const rePut = await fetch(reissued, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/markdown' },
      body: PLAN_CONTENT,
    });
    expect(rePut.status).toBe(200);
    expect(planRows(direct.buildId)).toHaveLength(1);

    // —— daemon 重启：recover 快路径 → 重取 URL 补报（不重跑 agent 轮）。——
    first.kill('SIGKILL');
    await new Promise<void>((resolve) => first.once('exit', () => resolve()));
    const second = spawnDaemon(server.url, 'restart-mbp', apiKeyOfFirstServer);
    await waitFor(
      () => logLines().some((l) => l.includes('awaiting upload — replaying final report')),
      60_000,
    );
    await waitFor(
      () =>
        server.db.select().from(stepTable).where(eq(stepTable.buildId, daemonWorld.buildId)).get()
          ?.status === 'done',
      60_000,
    );
    expect(planRows(daemonWorld.buildId)).toHaveLength(1);
    expect(stub.requests.length).toBe(requestsBefore); // 无新 agent 轮
    const lines = logLines();
    expect(lines.filter((l) => l.includes(`new session ${daemonWorld.buildId}`))).toHaveLength(1);
    expect(lines.some((l) => l.includes(`continue session ${daemonWorld.buildId}`))).toBe(false);

    second.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5_000);
      second.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }, 240_000);
});
