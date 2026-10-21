// local 形态执行面（spec 12 G2-T2，#362）：镜像 clone 硬链接证据 + conv 分支
// 落地面（#1211：push 即交付，用户主检出零触碰）+ per-step 凭证不进 argv。
// 真 git 落地（workspace.test.ts 同律；用户仓库 = 非 bare 工作树仓，origin 即
// 用户仓库本体）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 硬链接面：基座 clone 的 .git/objects 文件 nlink ≥ 2（与用户仓库共享
//      inode）且占比 ≥ 50%；对照直接 copy 全部 nlink == 1（硬链接数 0）
//   2. push 落地：worktree 提交 + push 回用户仓库 → 用户仓库 refs/heads 多出
//      conv 分支（tip = worktree HEAD）；用户当前分支 HEAD/reflog/工作树零
//      变化——即便 ff 可行也不推进用户分支（#1211：合并到默认分支由用户自取）
//   3. 脏工作区：用户仓库有未提交改动 → push 照常成功（push 只写
//      refs/heads/<conv>，不碰用户工作树）；用户 HEAD 与脏文件内容原样
//   4. 凭证 argv 面：PATH shim 捕获全部 git fork+exec 命令行——带凭证
//      clone/fetch/push 全程 token 不出现在 argv；对照 env 面
//      最后一条 GIT_CONFIG_VALUE_* 携带 token（凭证确实经 env credential.helper 注入）

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch, type GitCredentials } from '@pacman/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@pacman.local' };
const PROJECT_ID = 'proj-local-1';
const CONV_A = '01a0b86f-aaaa-72a8-bba4-75c5cfd6598f';
/** 探针 token（argv 泄漏断言的判别串；形近真实 GitHub token 但为假值）。 */
const PROBE_TOKEN = 'ghp_PROBE0000000000000000000000000000';
const PROBE_CRED: GitCredentials = { username: 'x-access-token', password: PROBE_TOKEN };

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
    skills: (m) => prefixed('skills', m),
    gate: (m) => prefixed('gate', m),
    trust: (m) => prefixed('trust', m),
    mcp: (m) => prefixed('mcp', m),
  };
}

let userRepo: string; // 用户本机 git 工作树仓（local 形态 clone 源 + 落地面）
let root: string; // workspacesRoot
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

/** 用户仓库种子：非 bare、main 分支、README.md + 数据文件若干提交
 * （多个松散 object → 硬链接占比断言有分母）。 */
async function seedUserRepo(dir: string): Promise<void> {
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  await runGit(['add', '-A'], { cwd: dir });
  await runGit(['commit', '-m', 'init'], { cwd: dir, env: commitEnv(IDENTITY) });
  for (const i of [1, 2, 3]) {
    writeFileSync(join(dir, `data-${i}.txt`), `payload ${i}\n`.repeat(64));
    await runGit(['add', '-A'], { cwd: dir });
    await runGit(['commit', '-m', `data ${i}`], { cwd: dir, env: commitEnv(IDENTITY) });
  }
}

function prepareInput(conversationId: string, cloneUrl: string) {
  return {
    projectId: PROJECT_ID,
    conversationId,
    cloneUrl,
    workspacesRoot: root,
    credentials: null,
  };
}

async function headOf(dir: string): Promise<string> {
  const r = await runGit(['rev-parse', 'HEAD'], { cwd: dir });
  return r.stdout.trim();
}

/** 递归收集目录下全部普通文件的 nlink。 */
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

beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'pacman-local-exec-'));
  userRepo = join(base, 'user-repo');
  root = join(base, 'workspaces');
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedUserRepo(userRepo);
});

describe('local 形态镜像 clone（spec 12 G2-T2：硬链接近零成本）', () => {
  test('失败方式 1：基座 clone 对象文件走硬链接（nlink ≥ 2 占比 ≥ 50%）；直接 copy 对照 = 0 硬链接', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    expect(prepared.baseRepoDir).toBe(join(root, PROJECT_ID, 'repo'));

    const objectLinks = nlinksUnder(join(prepared.baseRepoDir, '.git', 'objects'));
    const hardlinked = objectLinks.filter((n) => n >= 2);
    expect(objectLinks.length).toBeGreaterThan(0);
    expect(hardlinked.length).toBeGreaterThanOrEqual(Math.ceil(objectLinks.length * 0.5));

    // 对照面：直接 copy 同仓库 → 全部新 inode（无硬链接）。
    const copyDir = join(root, 'direct-copy');
    cpSync(userRepo, copyDir, { recursive: true });
    const copyLinks = nlinksUnder(join(copyDir, '.git', 'objects'));
    expect(copyLinks.filter((n) => n >= 2)).toHaveLength(0);
  }, 30_000);
});

describe('local 形态落地（#1211：conv 分支 push 即交付，用户主检出零触碰）', () => {
  test('失败方式 2：worktree 提交 push 回用户仓库 → refs/heads 多 conv 分支；用户 HEAD/reflog/工作树零变化（即便 ff 可行也不推进）', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    writeFileSync(join(prepared.cwd, 'probe.txt'), 'local landing probe\n');
    const committed = await ws.commitAll(prepared.cwd, 'build: probe', IDENTITY);
    expect(committed.committed).toBe(true);
    const headBefore = await headOf(userRepo);
    const reflogBefore = await runGit(['reflog', 'main'], { cwd: userRepo });

    await ws.push(prepared.cwd, prepared.branch, null);

    // push 回用户仓库：conv 分支在用户仓库 refs/heads 在位（非 bare 收 push）。
    const onUser = await runGit(['rev-parse', '--verify', `refs/heads/${prepared.branch}`], {
      cwd: userRepo,
    });
    expect(onUser.code).toBe(0);
    expect(onUser.stdout.trim()).toBe(committed.head);
    // conv tip 是 main 的后代（正 ff 形）——但用户 main 不被推进（#1211：
    // 落地只多分支，合并到默认分支由用户自取）。
    const ffShape = await runGit(
      ['merge-base', '--is-ancestor', 'main', `refs/heads/${prepared.branch}`],
      { cwd: userRepo },
    );
    expect(ffShape.code).toBe(0);
    expect(await headOf(userRepo)).toBe(headBefore);
    const reflogAfter = await runGit(['reflog', 'main'], { cwd: userRepo });
    expect(reflogAfter.stdout).toBe(reflogBefore.stdout); // reflog 无新增
    expect(existsSync(join(userRepo, 'probe.txt'))).toBe(false); // 工作树无新文件
    const status = await runGit(['status', '--porcelain'], { cwd: userRepo });
    expect(status.stdout.trim()).toBe('');
  }, 30_000);

  test('失败方式 3：脏工作区 → push 照常成功（push 只写 conv 分支 ref）；用户 HEAD 与脏文件原样', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    writeFileSync(join(prepared.cwd, 'README.md'), '# user repo\n\nagent line\n');
    await ws.commitAll(prepared.cwd, 'build: readme', IDENTITY);

    // 用户对同一文件有未提交改动——不阻断 push，也不被 push 触碰。
    writeFileSync(join(userRepo, 'README.md'), '# user repo\nUSER UNCOMMITTED\n');
    const headBefore = await headOf(userRepo);

    await ws.push(prepared.cwd, prepared.branch, null);

    const onUser = await runGit(['rev-parse', '--verify', `refs/heads/${prepared.branch}`], {
      cwd: userRepo,
    });
    expect(onUser.code).toBe(0);
    expect(await headOf(userRepo)).toBe(headBefore);
    expect(readFileSync(join(userRepo, 'README.md'), 'utf8')).toContain('USER UNCOMMITTED');
  }, 30_000);
});

describe('per-step 凭证 argv 纪律（spec 12 G2-T2：捕获 fork+exec 命令行）', () => {
  let shimDir = '';
  let argvLog = '';
  let envLog = '';
  let savedPath = '';

  beforeEach(() => {
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    expect(realGit).not.toBe('');
    shimDir = mkdtempSync(join(tmpdir(), 'pacman-git-shim-'));
    argvLog = join(shimDir, 'argv.log');
    envLog = join(shimDir, 'env.log');
    writeFileSync(
      join(shimDir, 'git'),
      [
        '#!/bin/sh',
        `{ printf '%s ' "$@"; printf '\\n'; } >> "${argvLog}"`,
        // 只记 helper 位 = 最后一条（COUNT-1）：父环境自带 GIT_CONFIG_* 时它不在
        // 1 号（#1460）。
        `printenv "GIT_CONFIG_VALUE_$((\${GIT_CONFIG_COUNT:-0} - 1))" >> "${envLog}" 2>/dev/null || true`,
        `exec "${realGit}" "$@"`,
      ].join('\n'),
    );
    chmodSync(join(shimDir, 'git'), 0o755);
    savedPath = process.env.PATH ?? '';
    process.env.PATH = `${shimDir}:${savedPath}`;
  });

  afterEach(() => {
    process.env.PATH = savedPath;
  });

  test('失败方式 5：带凭证 clone/fetch/push 全程 token 不进 argv；env credential.helper 携带（正对照）', async () => {
    // 远端 = 本地 bare repo（http 远端不可得时的等价执行面：凭证注入通道与
    // 远端协议无关——断言对象是 pacman 侧 spawn 形态，不是 git auth 结果）。
    const bareRemote = join(mkdtempSync(join(tmpdir(), 'pacman-cred-remote-')), 'origin.git');
    await runGit(['init', '--bare', bareRemote]);
    await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareRemote });
    const seedDir = join(mkdtempSync(join(tmpdir(), 'pacman-cred-seed-')), 'seed');
    await runGit(['clone', bareRemote, seedDir]);
    writeFileSync(join(seedDir, 'README.md'), '# cred probe\n');
    await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'seed'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });

    const credRoot = mkdtempSync(join(tmpdir(), 'pacman-cred-ws-'));
    const cloneDir = join(credRoot, 'clone');
    await gitPrim.clone(bareRemote, cloneDir, PROBE_CRED);
    await gitPrim.fetch(cloneDir, PROBE_CRED);
    await runGit(['checkout', '-b', conversationBranch(CONV_A)], { cwd: cloneDir });
    writeFileSync(join(cloneDir, 'work.txt'), 'x\n');
    await gitPrim.addAll(cloneDir);
    await gitPrim.commit(cloneDir, 'work', IDENTITY);
    await gitPrim.push(cloneDir, conversationBranch(CONV_A), PROBE_CRED);

    const argv = readFileSync(argvLog, 'utf8');
    expect(argv).toContain('clone');
    expect(argv).toContain('push');
    // 判别断言：token 与凭证用户名都不出现在任何 git 命令行。
    expect(argv).not.toContain(PROBE_TOKEN);
    expect(argv).not.toContain('x-access-token');
    expect(argv).not.toContain('credential.helper');
    // 正对照：token 确实经 GIT_CONFIG_* env 注入（否则「argv 无 token」空转）
    // ——最后一个 VALUE 位 = 内联 credential.helper 函数体（git.ts gitCredentialEnv）。
    const envDump = readFileSync(envLog, 'utf8');
    expect(envDump).toContain(PROBE_TOKEN);
    expect(envDump).toContain('echo username=x-access-token');
  }, 30_000);
});
