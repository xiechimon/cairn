import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { build as buildTable, todo as todoTable } from '../../apps/server/src/db/schema.js';
import { systemGitOps } from '../../apps/server/src/lib/git.js';
import { storeInfoReport } from '../../apps/server/src/services/info-handoff.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const REPORT_MARK = 'INFO-REPORT-1626: 结论是登录走 OAuth';
const PROJECT = 'info-fastlane';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

function userTexts(messages: { role: string; content?: unknown }[]): string[] {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p): p is { type: 'text'; text: string } => p?.type === 'text')
              .map((p) => p.text)
              .join('')
          : '',
    );
}

beforeAll(async () => {
  home = makeTestTempDir('cairn-info-fastlane-home-');
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "oauth login\\n" >> README.md' },
      },
    },
    { content: '按报告完成改动。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成工作，然后简短汇报。',
  });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'info-fastlane-mbp',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  handle = await runMachine({
    config,
    paths,
    logger: createDaemonLogger({ logFile: paths.daemonLog }),
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,

    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  await waitFor(
    () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
    30_000,
  );
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('#1626 info-class fast lane: info card report handed to the downstream code card', () => {
  test('an info card report is a retrievable attachment that refuses merge; the downstream code card brief carries the report and delivers as usual', async () => {
    const project = await api(server.url, 'POST', '/api/projects', {
      name: PROJECT,
      teamId: server.teamId,
      repoKind: 'hosted',
    });
    const projectId = (project.body as { id: string }).id;
    const bareDir = join(server.reposDir, server.teamId, `${PROJECT}.git`);

    const infoRes = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: '调研登录方案',
      spec: '调研登录方案并写报告。',
      output: 'info',
    });
    expect(infoRes.status).toBe(201);
    const infoTodo = infoRes.body as { id: string; output: string };
    expect(infoTodo.output).toBe('info');

    const infoBuildId = 'info-seeded-build';
    server.db
      .insert(buildTable)
      .values({
        id: infoBuildId,
        todoId: infoTodo.id,
        withPlan: false,
        triggerSource: 'user',
        changes: null,
        createdAt: Date.now(),
      })
      .run();
    server.db
      .update(todoTable)
      .set({ phase: 'review', latestBuildId: infoBuildId })
      .where(eq(todoTable.id, infoTodo.id))
      .run();
    storeInfoReport(
      { db: server.db, attachmentsDir: server.attachmentsDir },
      {
        buildId: infoBuildId,
        teamId: server.teamId,
        createdBy: server.svc.user.id,
        report: `# 调研报告\n${REPORT_MARK}\n`,
      },
    );

    const infoBuild = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, infoBuildId))
      .get()!;
    expect(infoBuild.reportAttachmentId).not.toBeNull();
    const attachment = await fetch(`${server.url}/api/attachments/${infoBuild.reportAttachmentId}`);
    expect(attachment.status).toBe(200);
    expect(await attachment.text()).toContain(REPORT_MARK);

    const mergeRes = await api(server.url, 'POST', `/api/builds/${infoBuildId}/merge`, {});
    expect(mergeRes.status).toBe(409);

    const done = await api(server.url, 'PATCH', `/api/todos/${infoTodo.id}`, { phase: 'done' });
    expect(done.status).toBe(200);

    const codeRes = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: '按报告接入登录',
      spec: '按前置调研报告在 README 记录方案。',
    });
    const codeTodoId = (codeRes.body as { id: string }).id;
    server.db
      .update(todoTable)
      .set({ blockedBy: [infoTodo.id] })
      .where(eq(todoTable.id, codeTodoId))
      .run();
    const requestsBefore = stub.requests.length;
    const codeStart = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [codeTodoId],
    });
    expect(codeStart.status).toBe(201);
    const codeBuildId = (codeStart.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(codeTodoId) === 'done', 120_000);

    const firstCodeRequest = stub.requests[requestsBefore]!;
    const brief = userTexts(firstCodeRequest.messages).join('\n');
    expect(brief).toContain('报告附件内容');
    expect(brief).toContain(REPORT_MARK);

    const codeHead = await systemGitOps.resolveCommit(
      bareDir,
      `refs/heads/cairn/conv-${codeBuildId}`,
    );
    expect(codeHead).toMatch(/^[0-9a-f]{40}$/);
    const readme = await systemGitOps.readFileAt(bareDir, codeHead!, 'README.md');
    expect(new TextDecoder().decode(readme!.content)).toContain('oauth login');
    const codeTodo = server.db.select().from(todoTable).where(eq(todoTable.id, codeTodoId)).get()!;
    expect(codeTodo.hasChanges).toBe(true);
  }, 300_000);
});
