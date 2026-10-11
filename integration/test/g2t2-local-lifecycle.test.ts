// spec 12 / #362 G2-T2 集成 E2E：local 形态全生命周期实跑（m3b-demo 同构
// harness = 真 server + 真 daemon + stub LLM + 真 git）——
// 规划 → 确认 → 执行（bash 真改文件 + commit + push 回用户仓库）→ merge 202
// delegated → 合并步（git merge origin/main + push；#1211：落地 = conv 分支
// 落用户仓库，用户主检出的分支/工作树零触碰——合并到默认分支由用户自取）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 镜像 clone 落 <workspacesRoot>/<projectId>/repo，对象文件走硬链接
//      （nlink ≥ 2，近零成本）；托管存储面零写入（reposDir 无 bare repo——
//      applyMergeLanding hosted-only）
//   2. build 步收尾：conv 分支 pacman/conv-<buildId> push 回用户仓库
//      refs/heads（非 bare 收 push），携带探针行；用户工作树未被触碰
//      （reflog/main/HEAD/status 与种子态一致）
//   3. merge 步收尾：conv 分支 tip = merge 步 checkpointCommit 落用户仓库
//      refs/heads；用户当前分支 HEAD/reflog 零变化、工作树无探针行、status
//      干净（#1211：用户仓库只多 pacman/ 分支）
//   4. 脏工作区变体：用户对同一文件有未提交改动 → merge 步照常 done（落地
//      不读用户工作区）；用户 HEAD 不动、脏文件原样（永不动用户工作树）

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { commitEnv, runGit } from '../../apps/daemon/src/git.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { build as buildTable, step as stepTable } from '../../apps/server/src/db/schema.js';
import { systemGitOps } from '../../apps/server/src/lib/git.js';
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

const IDENTITY = { name: 'it-user', email: 'it-user@pacman.local' };
const PLAN_MD = [
  '# 方案',
  '',
  'Context: 探针任务，README 当前无探针行。',
  'Changes: 在 README.md 追加一行 g2t2 probe。',
  'Edge cases: 无。',
  'Verification: 读回 README.md 确认探针行在位。',
].join('\n');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

/** 用户本机 git 工作树仓种子（local 形态 clone 源 + 落地面）。 */
async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'pacman-g2t2-user-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  await runGit(['add', '-A'], { cwd: dir });
  await runGit(['commit', '-m', 'init'], { cwd: dir, env: commitEnv(IDENTITY) });
  return dir;
}

async function headOf(dir: string): Promise<string> {
  const r = await runGit(['rev-parse', 'HEAD'], { cwd: dir });
  return r.stdout.trim();
}

/** `git reflog main` 原文（#1211 判据：用户主检出 reflog 零新增）。 */
async function reflogMain(dir: string): Promise<string> {
  const r = await runGit(['reflog', 'main'], { cwd: dir });
  return r.stdout;
}

function nlinksUnder(dir: string): number[] {
  const out: number[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(statSync(p).nlink);
    }
  };
  walk(dir);
  return out;
}

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

/** 一轮生命周期消耗的 stub 轮次（plan toolCall + plan 收尾 + build toolCall +
 * build 收尾 + merge 收尾文本）。 */
function lifecycleTurns(probeLine: string) {
  return [
    {
      toolCall: { name: 'bash', arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` } },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    { toolCall: { name: 'bash', arguments: { command: `printf "${probeLine}\\n" >> README.md` } } },
    { content: '修改已完成并验证通过。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
  ];
}

beforeAll(async () => {
  stub = await startStubLlm([
    ...lifecycleTurns('g2t2 probe line'),
    ...lifecycleTurns('g2t2 dirty probe'),
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'pacman-g2t2-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'g2t2-mbp' },
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
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${logLines().slice(-40).join('\n')}\n`,
  );
});

describe('G2-T2 local 形态全生命周期（spec 12：镜像 clone + push 回用户仓库 = 落地，主检出零触碰）', () => {
  let userRepo: string;
  let projectId: string;
  let todoId: string;
  let buildId: string;

  test('失败方式 1-3：plan/build → conv 分支 push 回用户仓库 → merge → conv 分支更新即落地，用户主检出零变化（#1211）', async () => {
    userRepo = await seedUserRepo();
    const headSeed = await headOf(userRepo);
    const reflogSeed = await reflogMain(userRepo);
    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'G2-T2 local 探针', spec: '在 README.md 追加一行 g2t2 probe line。' },
      { repoKind: 'local', localPath: userRepo, projectName: 'g2t2-local' },
    );
    projectId = world.projectId;
    todoId = world.todoId;

    const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(todoId) === 'confirm', 120_000);

    // —— 失败方式 1：镜像 clone 落 <workspacesRoot>/<projectId>/repo，硬链接面 ——
    const baseRepo = join(paths.workspacesDir, projectId, 'repo');
    expect(existsSync(join(baseRepo, '.git'))).toBe(true);
    const objectLinks = nlinksUnder(join(baseRepo, '.git', 'objects'));
    expect(objectLinks.filter((n) => n >= 2).length).toBeGreaterThan(0);
    // 托管存储面零写入（applyMergeLanding hosted-only；local 不落 server reposDir）。
    const hostedDir = join(server.reposDir, server.teamId);
    expect(existsSync(hostedDir) ? readdirSync(hostedDir) : []).toEqual([]);

    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    // —— 失败方式 2：conv 分支已 push 回用户仓库（非 bare 收 push），带探针行 ——
    const branch = `pacman/conv-${buildId}`;
    const branchSha = await systemGitOps.resolveCommit(userRepo, `refs/heads/${branch}`);
    expect(branchSha).toMatch(/^[0-9a-f]{40}$/);
    const readme = await systemGitOps.readFileAt(userRepo, branchSha!, 'README.md');
    expect(new TextDecoder().decode(readme!.content)).toContain('g2t2 probe line');
    expect(logLines().some((l) => l.includes(`pushed ${branch}`))).toBe(true);
    // build 步后用户主检出零触碰：HEAD/reflog 停种子态、工作树无探针行。
    expect(await headOf(userRepo)).toBe(headSeed);
    expect(await reflogMain(userRepo)).toBe(reflogSeed);
    expect(readFileSync(join(userRepo, 'README.md'), 'utf8')).not.toContain('g2t2 probe line');

    // —— 失败方式 3：merge 202 delegated → 合并步 → conv 分支更新即落地 ——
    const mergeRes = await api(server.url, 'POST', `/api/builds/${buildId}/merge`, {});
    expect(mergeRes.status).toBe(202);
    expect(mergeRes.body).toEqual({ delegated: true });
    await waitFor(() => server.todoPhase(todoId) === 'done', 120_000);

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const mergeStep = steps.find((s) => s.kind === 'merge')!;
    expect(mergeStep.status).toBe('done');
    // 落地面：用户仓库 refs/heads 的 conv 分支 = merge 步 checkpoint（#1211：
    // 分支即交付，合并到默认分支由用户自取）。
    const landed = await systemGitOps.resolveCommit(userRepo, `refs/heads/${branch}`);
    expect(landed).toBe(mergeStep.checkpointCommit);
    // 主检出零变化：main HEAD/reflog 停种子态、工作树无探针行、status 干净。
    expect(await headOf(userRepo)).toBe(headSeed);
    expect(await reflogMain(userRepo)).toBe(reflogSeed);
    expect(readFileSync(join(userRepo, 'README.md'), 'utf8')).not.toContain('g2t2 probe line');
    const status = await runGit(['status', '--porcelain'], { cwd: userRepo });
    expect(status.stdout.trim()).toBe('');
  }, 200_000);

  test('失败方式 4：脏工作区 → merge 步照常 done（#1211：落地不读用户工作区）；用户 HEAD/脏文件原样', async () => {
    const dirtyRepo = await seedUserRepo();
    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'G2-T2 脏区探针', spec: '在 README.md 追加一行 g2t2 dirty probe。' },
      { repoKind: 'local', localPath: dirtyRepo, projectName: 'g2t2-dirty' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const dirtyBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);
    await api(server.url, 'POST', `/api/builds/${dirtyBuildId}/steps`, { action: 'confirm' });
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);

    // 用户对同一文件叠加未提交改动——merge 步不读用户工作区，照常落地。
    writeFileSync(join(dirtyRepo, 'README.md'), '# user repo\nUSER UNCOMMITTED WORK\n');
    const headBefore = await headOf(dirtyRepo);

    const mergeRes = await api(server.url, 'POST', `/api/builds/${dirtyBuildId}/merge`, {});
    expect(mergeRes.status).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'done', 120_000);

    const buildRow = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, dirtyBuildId))
      .get()!;
    expect(buildRow.errorMessage).toBeNull();
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, dirtyBuildId))
      .all();
    expect(steps.find((s) => s.kind === 'merge')!.status).toBe('done');
    // conv 分支照常落用户仓库；用户工作树永不被触碰：HEAD 不动、脏文件原样。
    const dirtyLanded = await systemGitOps.resolveCommit(
      dirtyRepo,
      `refs/heads/pacman/conv-${dirtyBuildId}`,
    );
    expect(dirtyLanded).toMatch(/^[0-9a-f]{40}$/);
    expect(await headOf(dirtyRepo)).toBe(headBefore);
    expect(readFileSync(join(dirtyRepo, 'README.md'), 'utf8')).toContain('USER UNCOMMITTED WORK');
  }, 200_000);
});
