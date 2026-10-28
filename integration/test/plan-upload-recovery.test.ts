import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { Agent, createServer as createTcpServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ClaimedStep, claimedStepSchema, ENV_VARS, PLAN_FILE_NAME } from '@cairn/shared';
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
  '# 方案\nKind: fix\n\nContext: 恢复探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\n';

async function startProxy(target: string): Promise<{
  url: string;
  forward(): void;
  dropDone(): void;
  close(): Promise<void>;
}> {
  let drop = false;
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

async function waitForPlanRow(buildId: string) {
  await waitFor(() => planRows(buildId).length > 0);
}

describe('#1026/#1028 final-report failure recovery (real process restarts)', () => {
  test('PUT succeeded / done failed → daemon restart fast-path replays: no rerun, no duplicate version', async () => {
    stub = await startStubLlm([
      {
        toolCall: {
          name: 'bash',
          arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_CONTENT}EOF` },
        },
      },
      { content: '规划完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500 });
    home = mkdtempSync(join(tmpdir(), 'cairn-plan-uploads-'));
    proxyHandle = await startProxy(server.url);
    const { buildId } = await startBuild(
      '幂等恢复探针',
      '写一行探针到 README.md',
      'it-project-idem',
    );

    proxyHandle.dropDone();
    const first = spawnDaemon(proxyHandle.url, 'idem-mbp', server.apiKey);
    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 90_000);
    await waitFor(() => logLines().some((l) => l.includes('done report failed')), 30_000);

    await waitForPlanRow(buildId);
    const firstRow = planRows(buildId)[0]!;
    const residue = readJournal();
    expect(residue?.state).toBe('awaiting-upload');
    expect(residue?.doneBody).toMatchObject({ status: 'success' });
    const stepRow = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    expect(stepRow.status).toBe('claimed');
    const requestsBefore = stub.requests.length;

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

    const rows = planRows(buildId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstRow.id);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.content).toBe(PLAN_CONTENT);
    expect(stub.requests.length).toBe(requestsBefore);
    const lines = logLines();
    expect(lines.filter((l) => l.includes(`new session ${buildId}`))).toHaveLength(1);
    expect(lines.some((l) => l.includes(`continue session ${buildId}`))).toBe(false);
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

  test('server shutdown in the final window → same-port reopen → old URL 404 (explainable) → reissued URL persists → daemon restart fast-path replays', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'cairn-plan-restart-')), 'cairn.db');
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
    home = mkdtempSync(join(tmpdir(), 'cairn-plan-restart-home-'));

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

    const daemonWorld = await startBuild(
      '重启恢复探针',
      '写一行重启探针到 README.md',
      'it-project-restart',
    );
    const apiKeyOfFirstServer = server.apiKey;
    const first = spawnDaemon(server.url, 'restart-mbp', apiKeyOfFirstServer);
    await waitFor(() => logLines().some((l) => l.includes('Enrolled in team')), 30_000);
    const daemonMachine = server.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.name, 'restart-mbp'))
      .get();
    if (daemonMachine === undefined)
      throw new Error('daemon machine row missing (enroll not persisted)');
    server.db
      .update(agentTable)
      .set({ machineId: daemonMachine.id })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await waitFor(
      () => logLines().some((l) => l.includes(`new session ${daemonWorld.buildId}`)),
      90_000,
    );
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

    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500, dbPath, port });
    expect(server.url).toBe(`http://127.0.0.1:${port}`);

    const staleRes = await fetch(oldUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/markdown' },
      body: PLAN_CONTENT,
    });
    expect(staleRes.status).toBe(404);
    expect(await staleRes.json()).toMatchObject({ error: 'upload not found' });

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
    expect(stub.requests.length).toBe(requestsBefore);
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
