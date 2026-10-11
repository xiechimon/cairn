// worktree 契约单测（02 §5.5 全表 × r3 §1.4 实测行为；真 git 落地——
// file:// 远端 bare repo 即 origin，凭证面归 integration（http + per-step key））。
// 覆盖：基座 clone/worktree add -b/reused/远端分支 base 二择/commitAll+push/
// countAhead/checkpoint 恢复（reset --hard + clean -fd → `Worktree restored`）/
// merge --no-edit 两态/孤儿回收 TTL 7×24h/防分叉护栏 REMOTE_BRANCH_DIVERGED/
// projectLock 串行化。

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRAND,
  conversationBranch,
  ORPHAN_WORKTREE_TTL_MS,
  RemoteBranchDivergedError,
} from '@pacman/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@pacman.local' };

function fakeLogger(): DaemonLogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (msg: string) => lines.push(msg);
  const prefixed = (prefix: string, msg: string) => push(`[${prefix}] ${msg}`);
  return {
    lines,
    raw: push,
    prefixed,
    supervisor: (m) => prefixed('supervisor', m),
    machine: (m) => prefixed('machine', m),
    step: (m) => prefixed('step', m),
    workspace: (m) => prefixed('workspace', m),
    recover: (m) => prefixed('recover', m),
    wake: (m) => prefixed('wake', m),
    mcp: (m) => prefixed('mcp', m),
    skills: (m) => prefixed('skills', m),
    gate: (m) => prefixed('gate', m),
    trust: (m) => prefixed('trust', m),
  };
}

let root: string; // workspacesRoot
let originDir: string; // bare origin（server 托管 repo 等价物）
let seedDir: string; // 种子提交工作区
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

const PROJECT_ID = 'proj-1';
const CONV_A = '01a0b86f-04f9-72a8-bba4-75c5cfd6598f'; // r3 §1.4 UUIDv7 样本形
const CONV_B = '01a0b870-1111-7222-8888-75c5cfd6598f';

async function seedOrigin(): Promise<void> {
  // bare origin：init + HEAD→main + 种子提交（README.md 一行）。
  await runGit(['init', '--bare', originDir]);
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: originDir });
  await runGit(['clone', originDir, seedDir]);
  writeFileSync(join(seedDir, 'README.md'), '# seed\n');
  await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
  await runGit(['add', '-A'], { cwd: seedDir });
  await runGit(['commit', '-m', 'seed'], { cwd: seedDir, env: commitEnv(IDENTITY) });
  await runGit(['push', 'origin', 'main'], { cwd: seedDir });
}

function prepareInput(conversationId: string) {
  return {
    projectId: PROJECT_ID,
    conversationId,
    cloneUrl: originDir,
    workspacesRoot: root,
    credentials: null,
  };
}

/** #1149：种子仓写 .agents/<name> 钩子（可执行位）。 */
function seedHook(name: 'setup' | 'resume', body: string): void {
  mkdirSync(join(seedDir, '.agents'), { recursive: true });
  const p = join(seedDir, '.agents', name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pacman-ws-root-'));
  originDir = join(mkdtempSync(join(tmpdir(), 'pacman-ws-origin-')), 'repo.git');
  seedDir = join(tmpdir(), `pacman-ws-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedOrigin();
});

describe('worktree 契约（02 §5.5 / r3 §1.4）', () => {
  test('prepare：基座 clone 落 <root>/<projectId>/repo + worktree add -b 落 <root>/<convId>，分支 pacman/conv-*', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(prepared.cwd).toBe(join(root, CONV_A));
    expect(prepared.baseRepoDir).toBe(join(root, PROJECT_ID, 'repo'));
    expect(prepared.branch).toBe(conversationBranch(CONV_A));
    expect(prepared.branch).toBe(`${BRAND.branchPrefix}${CONV_A}`);
    expect(prepared.defaultBranch).toBe('main');
    expect(prepared.reused).toBe(false);
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(await gitPrim.currentBranch(prepared.cwd)).toBe(prepared.branch);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(true);
  }, 30_000);

  test('同项目第二 conv：基座 fetch 复用（不重 clone）；同 conv 再来 = Worktree reused', async () => {
    await ws.prepare(prepareInput(CONV_A));
    logger.lines.length = 0;
    const b = await ws.prepare(prepareInput(CONV_B));
    expect(b.reused).toBe(false);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(false);
    const again = await ws.prepare(prepareInput(CONV_A));
    expect(again.reused).toBe(true);
    expect(logger.lines).toContain('[workspace] Worktree reused');
  }, 30_000);

  test('base 二择：origin/<convBranch> 已 fetch 时优先（异机续跑面）', async () => {
    // 从种子工作区把 conv 分支推上远端（带独有提交）。
    const branch = conversationBranch(CONV_A);
    await runGit(['checkout', '-b', branch], { cwd: seedDir });
    writeFileSync(join(seedDir, 'probe.txt'), 'remote-work\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'remote work'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', branch], { cwd: seedDir });

    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(existsSync(join(prepared.cwd, 'probe.txt'))).toBe(true); // base=origin/<convBranch>
    expect(await gitPrim.currentBranch(prepared.cwd)).toBe(branch);
  }, 30_000);

  test('commitAll + push：每步结束自动 push 本 conversation 工作分支；干净树 = committed false', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    writeFileSync(join(prepared.cwd, 'README.md'), '# seed\n\nprobe line\n');
    const first = await ws.commitAll(prepared.cwd, 'build: probe', IDENTITY);
    expect(first.committed).toBe(true);
    expect(first.head).toMatch(/^[0-9a-f]{40}$/);
    await ws.push(prepared.cwd, prepared.branch, null);
    // 远端分支在位且指向该提交（bare origin 直查 refs/heads）。
    const remoteRef = await runGit(['rev-parse', '--verify', `refs/heads/${prepared.branch}`], {
      cwd: originDir,
    });
    expect(remoteRef.code).toBe(0);
    expect(remoteRef.stdout.trim()).toBe(first.head);
    const clean = await ws.commitAll(prepared.cwd, 'build: noop', IDENTITY);
    expect(clean.committed).toBe(false);
    // countAhead：conv 分支领先 origin/main 1 提交（hasChanges 真值面）。
    expect(await ws.countAhead(prepared.cwd, prepared.defaultBranch)).toBe(1);
  }, 30_000);

  test('#958 闸 5：带简报标记的文件被剔出提交，无标记的同名文件照常提交', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    // ① 漏网的简报文件（agent 自己 git add 过 / 擦除失败留下的形态）。
    writeFileSync(
      join(prepared.cwd, 'AGENTS.md'),
      `<!-- BEGIN PACMAN-RUNTIME (auto-managed; do not edit) -->\n简报\n<!-- END PACMAN-RUNTIME -->\n`,
    );
    // ② agent 合法产出的普通文件——必须照常进提交（认内容不认名的理由）。
    writeFileSync(join(prepared.cwd, 'NOTES.md'), 'agent 的产物\n');
    const first = await ws.commitAll(prepared.cwd, 'build: marker scan', IDENTITY);
    expect(first.committed).toBe(true);
    const listed = await runGit(['show', '--name-only', '--pretty=format:', first.head ?? 'HEAD'], {
      cwd: prepared.cwd,
    });
    expect(listed.stdout).toContain('NOTES.md');
    expect(listed.stdout).not.toContain('AGENTS.md');
    // 剔除行进了 workspace 日志（可观测面）。
    expect(logger.lines.some((l) => l.includes('brief marker dropped from commit'))).toBe(true);
    // 文件仍在盘上（剔除的是提交，不是删除工作区内容——擦除归 runner）。
    expect(existsSync(join(prepared.cwd, 'AGENTS.md'))).toBe(true);
  }, 30_000);

  test('#958 闸 4：分支历史里带标记时 briefMarkerInRef 点名，干净分支为空', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    // 先证负例：干净分支查不到。
    expect(await ws.briefMarkerInRef(prepared.cwd, prepared.branch)).toEqual([]);

    // agent 在 bash 里自己提交（绕过 commitAll 的认标记剔除）——daemon 拦不住
    // 的那条路径，本函数是它唯一的可见性面。
    writeFileSync(
      join(prepared.cwd, 'AGENTS.md'),
      `<!-- BEGIN PACMAN-RUNTIME (auto-managed; do not edit) -->\n简报\n<!-- END PACMAN-RUNTIME -->\n`,
    );
    await runGit(['add', '-A'], { cwd: prepared.cwd });
    await runGit(
      [
        '-c',
        'user.name=it-agent',
        '-c',
        'user.email=it@pacman.local',
        'commit',
        '-m',
        'agent self-commit',
      ],
      {
        cwd: prepared.cwd,
      },
    );
    expect(await ws.briefMarkerInRef(prepared.cwd, prepared.branch)).toEqual(['AGENTS.md']);
  }, 30_000);

  test('checkpoint 恢复：reset --hard + clean -fd → Worktree restored（r3 §1.4/§3.5）', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const checkpoint = (await ws.commitAll(prepared.cwd, 'plan: v1', IDENTITY)).head;
    // 步后污染：改跟踪文件 + 落未跟踪文件。
    writeFileSync(join(prepared.cwd, 'README.md'), 'corrupted\n');
    writeFileSync(join(prepared.cwd, 'scratch.txt'), 'dirty\n');
    await ws.restoreCheckpoint(prepared.cwd, checkpoint!);
    expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('# seed\n');
    expect(existsSync(join(prepared.cwd, 'scratch.txt'))).toBe(false);
    expect(logger.lines).toContain('[workspace] Worktree restored');
  }, 30_000);

  test('merge --no-edit 两态：Already up to date / 真合并（main 前进时）', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const idle = await ws.mergeDefaultBranch(prepared.cwd, prepared.defaultBranch);
    expect(idle.output).toMatch(/Already up to date/i); // r3 §3.6 实测样本词

    // main 前进（种子工作区直推）→ conv 分支合并出 merge commit。
    await runGit(['checkout', 'main'], { cwd: seedDir });
    writeFileSync(join(seedDir, 'main-note.txt'), 'main moved\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'main: note'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    await gitPrim.fetch(prepared.baseRepoDir, null);
    const merged = await ws.mergeDefaultBranch(prepared.cwd, prepared.defaultBranch);
    expect(merged.output).not.toMatch(/Already up to date/i);
    expect(existsSync(join(prepared.cwd, 'main-note.txt'))).toBe(true);
  }, 30_000);

  test('防分叉护栏：origin/<branch> 领先且 worktree 不在该分支 → remote branch diverged', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    // worktree 切离 conv 分支。
    await runGit(['checkout', '-B', 'detached-probe', 'origin/main'], { cwd: prepared.cwd });
    // 远端 conv 分支被推进（异机面）。
    const branch = conversationBranch(CONV_A);
    await runGit(['checkout', '-B', branch], { cwd: seedDir });
    writeFileSync(join(seedDir, 'other.txt'), 'elsewhere\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'elsewhere'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', '-f', 'origin', branch], { cwd: seedDir });
    await expect(ws.prepare(prepareInput(CONV_A))).rejects.toBeInstanceOf(
      RemoteBranchDivergedError,
    );
    await expect(ws.prepare(prepareInput(CONV_A))).rejects.toThrow(/remote branch diverged/);
  }, 30_000);

  test('孤儿回收：龄超 TTL(7×24h) 的 conv worktree 清理三步；活步/新目录不动', async () => {
    const stale = await ws.prepare(prepareInput(CONV_A));
    const fresh = await ws.prepare(prepareInput(CONV_B));
    // 陈旧化：目录 mtime 拨回 8 天前（提交时刻同参与取新——种子提交是刚刚，
    // 故同时把 worktree HEAD 指回旧提交不可行；直接以 now 注入 +8d 判龄）。
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale.cwd, old, old);

    const removed = await ws.cleanupOrphans({
      workspacesRoot: root,
      ttlMs: ORPHAN_WORKTREE_TTL_MS,
      now: Date.now(),
      activeConversationIds: [],
    });
    // 龄 = max(目录 mtime, 最后提交时刻)（lastActivity [设计]）：种子提交是
    // 「刚刚」→ 真实 now 下两目录都不满足 TTL。
    expect(removed).toEqual([]);
    // now 前移 8d（> TTL 7×24h）：CONV_A 回收、活步 CONV_B 护栏不动。
    const removedByNow = await ws.cleanupOrphans({
      workspacesRoot: root,
      ttlMs: ORPHAN_WORKTREE_TTL_MS,
      now: Date.now() + 8 * 24 * 60 * 60 * 1000,
      activeConversationIds: [CONV_B],
    });
    expect(removedByNow).toContain(CONV_A); // 陈旧回收
    expect(removedByNow).not.toContain(CONV_B); // 活步护栏
    expect(existsSync(stale.cwd)).toBe(false);
    expect(existsSync(fresh.cwd)).toBe(true);
    // 分支清理（branch -D）：基座内 conv A 分支已删。
    expect(await gitPrim.hasLocalBranch(stale.baseRepoDir, stale.branch)).toBe(false);
    expect(await gitPrim.hasLocalBranch(fresh.baseRepoDir, fresh.branch)).toBe(true);
  }, 30_000);

  test('projectLock：同项目并发 prepare 串行化（clone 竞态护栏）', async () => {
    const [a, b] = await Promise.all([
      ws.prepare(prepareInput(CONV_A)),
      ws.prepare(prepareInput(CONV_B)),
    ]);
    expect(a.cwd).toBe(join(root, CONV_A));
    expect(b.cwd).toBe(join(root, CONV_B));
    // 基座只 clone 一次（第二进 = fetch 路径）。
    expect(logger.lines.filter((l) => l.includes('Cloning'))).toHaveLength(1);
  }, 30_000);
});

describe('#1149 环境生命周期钩子（prepare 两挂点）', () => {
  test('fresh 检出 → .agents/setup 跑，hooks 槽带 ok note（含 stdout）', async () => {
    // 钩子经种子提交进仓（真实路径：hook 在 worktree 树上）。
    seedHook('setup', '#!/bin/sh\necho setup-ran-marker\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(prepared.hooks).toHaveLength(1);
    expect(prepared.hooks![0]).toMatchObject({
      name: 'setup',
      status: 'ok',
      exitCode: 0,
    });
    expect(prepared.hooks![0]!.output).toContain('setup-ran-marker');
    expect(logger.lines.some((l) => l.includes('setup hook: running'))).toBe(true);
  }, 30_000);

  test('无钩子仓：hooks 缺省 []，零钩子日志行（行为与现状一致）', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(prepared.hooks).toEqual([]);
    expect(logger.lines.some((l) => l.includes('hook'))).toBe(false);
  }, 30_000);

  test('reused → .agents/resume 跑（setup 不重跑）；失败/超时非致命，步继续', async () => {
    seedHook('setup', '#!/bin/sh\necho setup-ran\n');
    seedHook('resume', '#!/bin/sh\necho resume-ran-marker\necho boom >&2\nexit 1\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const first = await ws.prepare(prepareInput(CONV_A));
    expect(first.reused).toBe(false);
    expect(first.hooks![0]!.name).toBe('setup');
    // 第二进 = reused → resume（exit 1，非致命——步继续，note 照落）。
    const second = await ws.prepare(prepareInput(CONV_A));
    expect(second.reused).toBe(true);
    expect(second.hooks).toHaveLength(1);
    expect(second.hooks![0]!.name).toBe('resume');
    expect(second.hooks![0]!.status).toBe('failed');
    expect(second.hooks![0]!.output).toContain('resume-ran-marker');
    // 非致命日志行点名（policy 层 warn 形）。
    expect(logger.lines.some((l) => l.includes('resume hook failed (non-fatal'))).toBe(true);
  }, 30_000);

  test('setup 失败 → prepare 抛错（步失败面）；worktree 回滚 → 重试重新走 fresh→setup', async () => {
    seedHook('setup', '#!/bin/sh\necho boom >&2\nexit 3\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    await expect(ws.prepare(prepareInput(CONV_A))).rejects.toThrow(/exited 3/);
    // 回滚真值：convDir 已清（重试认领重新走 fresh → setup 重跑）。
    expect(existsSync(join(root, CONV_A))).toBe(false);
    expect(
      await gitPrim.hasLocalBranch(join(root, PROJECT_ID, 'repo'), conversationBranch(CONV_A)),
    ).toBe(false);
  }, 30_000);

  test('陈旧重建（worktree 目录被手工删）→ 仍走 fresh → setup 重跑', async () => {
    seedHook('setup', '#!/bin/sh\necho setup-again-marker\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const first = await ws.prepare(prepareInput(CONV_A));
    expect(first.hooks![0]!.output).toContain('setup-again-marker');
    rmSync(join(root, CONV_A), { recursive: true, force: true });
    const second = await ws.prepare(prepareInput(CONV_A));
    expect(second.reused).toBe(false);
    expect(second.hooks![0]!.output).toContain('setup-again-marker');
  }, 30_000);

  test('钩子消费步级凭据：credentials 非空 → GIT_CONFIG_COUNT=2 进钩子 env', async () => {
    seedHook('setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const prepared = await ws.prepare({
      ...prepareInput(CONV_A),
      credentials: { username: 'x-access-token', password: 'step-token' },
    });
    expect(prepared.hooks![0]!.output).toContain('cred=2');
  }, 30_000);

  test('钩子超时 → setup 面致命（步失败），resume 面非致命', async () => {
    seedHook('setup', '#!/bin/sh\nsleep 10\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const short = new WorkspaceManager({ logger, hookTimeoutMs: 300 });
    await expect(short.prepare(prepareInput(CONV_A))).rejects.toThrow(/timed out/);
    expect(existsSync(join(root, CONV_A))).toBe(false); // 回滚面
  }, 30_000);
});
