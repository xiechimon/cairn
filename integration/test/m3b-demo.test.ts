import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../../apps/server/src/db/schema.js';
import { systemGitOps } from '../../apps/server/src/lib/git.js';
import { readFile } from '../../apps/server/src/services/git.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world: { projectId: string; todoId: string };
let buildId = '';
let bareDir = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m3b probe line\\n" >> README.md' },
      },
    },
    { content: '修改已完成并验证通过：README.md 末行为 m3b probe line。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
    { status: 400 },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m3b probe line\\n" >> README.md' },
      },
    },
    { content: '重跑修改已完成。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
  });
  home = makeTestTempDir('cairn-m3b-home-');
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm3b-mbp' },
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

    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${logLines().slice(-60).join('\n')}\n`,
  );
});

describe('M3b demo: single-machine full lifecycle todo→done (02 §4.2 main sequence)', () => {
  test('create → session: worktree contract lands + real bash change → commit/push → review + hasChanges (git ground truth)', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'M3b 生命周期探针', spec: '在 README.md 追加一行 m3b probe line。' },
      { repoKind: 'hosted', projectName: 'm3b-lifecycle' },
    );
    bareDir = join(server.reposDir, server.teamId, 'm3b-lifecycle.git');
    expect(existsSync(bareDir)).toBe(true);

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    try {
      await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);
    } catch (err) {
      const b = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
      const s = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
      throw new Error(
        `${err instanceof Error ? err.message : err} | phase=${server.todoPhase(world.todoId)} buildErr=${b?.errorMessage ?? null} steps=${JSON.stringify(s.map((r) => [r.kind, r.status]))}`,
      );
    }

    const branch = `cairn/conv-${buildId}`;
    const branchSha = await systemGitOps.resolveCommit(bareDir, `refs/heads/${branch}`);
    expect(branchSha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(paths.workspacesDir, buildId))).toBe(true);
    expect(existsSync(join(paths.workspacesDir, world.projectId, 'repo', '.git'))).toBe(true);

    const readme = await systemGitOps.readFileAt(bareDir, branchSha!, 'README.md');
    expect(readme).not.toBeNull();
    expect(new TextDecoder().decode(readme!.content)).toContain('m3b probe line');

    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    expect(todoRow.hasChanges).toBe(true);

    const lines = logLines();
    for (const canon of [
      '[workspace] 准备工作区...',
      'Cloning',
      `pushed ${branch}`,
      `new session ${buildId}`,
    ]) {
      expect(
        lines.some((l) => l.includes(canon)),
        `missing canon line: ${canon}`,
      ).toBe(true);
    }

    const stepRows = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(stepRows).toHaveLength(1);
    expect(stepRows[0]!.kind).toBe('session');
    expect(stepRows[0]!.status).toBe('done');
    expect(stepRows[0]!.checkpointCommit).toBe(branchSha);

    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const messages = (msgs.body as { messages: { content: unknown }[] }).messages;
    expect(JSON.stringify(messages)).toContain('README.md');

    const gitKeys = server.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.gitAccess, true))
      .all();
    expect(gitKeys).toHaveLength(0);
    const residue = scanForPattern(home, /credential\.helper|password=/);
    expect(residue).toEqual([]);
    const gitConfig = readFileSync(
      join(paths.workspacesDir, world.projectId, 'repo', '.git', 'config'),
      'utf8',
    );
    expect(gitConfig).not.toContain('credential');
    expect(gitConfig).not.toContain('cairn_');
  }, 150_000);

  test('review → merge 202 delegated → merge step → main fast-forward → done (02 §4.2/A6 + r3 §3.6)', async () => {
    const mergeRes = await api(server.url, 'POST', `/api/builds/${buildId}/merge`, {});
    expect(mergeRes.status).toBe(202);
    expect(mergeRes.body).toEqual({ delegated: true });

    await waitFor(() => server.todoPhase(world.todoId) === 'done', 120_000);

    const mainFile = await readFile(server, world.projectId, 'README.md', 'main');
    expect(mainFile.content).toContain('m3b probe line');

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const mergeStep = steps.find((s) => s.kind === 'merge')!;
    expect(mergeStep.status).toBe('done');
    const mainSha = await systemGitOps.resolveCommit(bareDir, 'refs/heads/main');
    expect(mainSha).toBe(mergeStep.checkpointCommit);
    expect(mainSha).toBe(mainFile.commit);

    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const flat = JSON.stringify((msgs.body as { messages: unknown[] }).messages);
    expect(flat).toContain('发起了合并');
    expect(flat).toContain('git merge origin/main 结果为');
    expect(flat).toContain('🎉 任务已完成');

    const usage = server.db.select().from(tokenUsage).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.buildId).toBe(buildId);
  }, 150_000);

  test('failure requires manual rerun (02/A6): provider 400 → failed → no auto rerun → POST builds rerun = new conv/new branch', async () => {
    const world2 = await seedWorld(
      server.url,
      server.teamId,
      { title: 'M3b 失败探针', spec: '这个任务的第一轮会失败。' },
      { repoKind: 'hosted', projectName: 'm3b-failure' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
    });
    const failedBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world2.todoId) === 'failed', 150_000);
    const buildRow = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, failedBuildId))
      .get()!;
    expect(buildRow.errorMessage).toBeTruthy();
    const failedStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, failedBuildId))
      .all();
    expect(failedStep).toHaveLength(1);
    expect(failedStep[0]!.status).toBe('failed');

    await new Promise((r) => setTimeout(r, 2_500));
    const stepsAfter = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, failedBuildId))
      .all();
    expect(stepsAfter).toHaveLength(1);

    const rerun = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
    });
    expect(rerun.status).toBe(201);
    const rerunBuildId = (rerun.body as { builds: { id: string }[] }).builds[0]!.id;
    expect(rerunBuildId).not.toBe(failedBuildId);
    await waitFor(() => server.todoPhase(world2.todoId) === 'review', 120_000);
    expect(existsSync(join(paths.workspacesDir, rerunBuildId))).toBe(true);
    const bareDir2 = join(server.reposDir, server.teamId, 'm3b-failure.git');
    const branch2 = await systemGitOps.resolveCommit(
      bareDir2,
      `refs/heads/cairn/conv-${rerunBuildId}`,
    );
    expect(branch2).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(paths.workspacesDir, failedBuildId))).toBe(true);
  }, 200_000);
});

function scanForPattern(dir: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = statSync(p);
      if (st.size > 8 * 1024 * 1024) continue;
      try {
        if (pattern.test(readFileSync(p, 'utf8'))) hits.push(p);
      } catch {}
    }
  };
  walk(dir);
  return hits;
}
