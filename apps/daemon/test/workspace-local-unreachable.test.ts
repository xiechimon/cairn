// #1210 C 兜底（无 origin 的 local 形态仓在他机执行）：repo 路径在执行机
// 不可达 → prepare 在 clone/fetch 之前抛类型化 LocalRepoUnreachableError，
// runner 合成点名机器/路径/原因/补法的步失败文案——不再把裸 git clone 错误
// 当步 errorMessage（用户与 chief 都读不出「哪台机、哪个路径、去修什么」）。
// 失败方式先列（本文件即失败场景清单；AGENTS.md 测试规则 3）：
//   L1 repoKind='local' + 路径不存在 → 抛 LocalRepoUnreachableError
//      (reason=not_found)，且不留半成品基座目录。
//   L2 repoKind='local' + 路径存在但不是 git 仓 → reason=not_git。
//   L3 repoKind='local' + 健康工作树仓 → prepare 照常成功：自路径 clone +
//      worktree 落位（仓库所在机行为零漂移——票面回归验收）。
//   L4 repoKind 缺省（兼容形：老调用方/测试桩）+ cloneUrl 指向不存在路径
//      → 保持现行为：裸 git 错误上浮，不是类型化错误（fail-open 版本墙，
//      与 machineCredentialFallback 缺省同形）。
//   L5 文案面：localRepoUnreachableMessage 点名机器 + 仓路径 + 原因人话
//      （复用 LOCAL_ERROR_REASON_COPY 词表单源）+ 两条补法；不含凭据面。

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRepoUnreachableError } from '@pacman/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { localRepoUnreachableMessage, WorkspaceManager } from '../src/workspace.js';

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

const PROJECT_ID = 'proj-local-unreach';
const CONV = '01a0b86f-04f9-72a8-bba4-75c5cfd65990';

let root: string; // workspacesRoot
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pacman-lu-root-'));
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
});

/** 真用户仓库种子（非 bare 工作树仓、main、单提交——#1211 判据最小形态）。 */
async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'pacman-lu-repo-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  await runGit(['add', '-A'], { cwd: dir });
  await runGit(['commit', '-m', 'seed'], { cwd: dir, env: commitEnv(IDENTITY) });
  return dir;
}

function localPrepareInput(cloneUrl: string, withKind: boolean) {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV,
    cloneUrl,
    workspacesRoot: root,
    credentials: null,
    ...(withKind ? { repoKind: 'local' as const } : {}),
  };
}

describe('local 形态执行面 fail-loud（#1210 C 兜底）', () => {
  test('L1 路径不存在 → LocalRepoUnreachableError(not_found)，无半成品基座', async () => {
    const gone = join(root, 'definitely-not-here', 'repo');
    const err = await ws.prepare(localPrepareInput(gone, true)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRepoUnreachableError);
    expect(err).toMatchObject({
      name: 'LocalRepoUnreachableError',
      repoPath: gone,
      reason: 'not_found',
    });
    expect(existsSync(join(root, PROJECT_ID, 'repo'))).toBe(false);
  });

  test('L2 路径存在但不是 git 仓 → LocalRepoUnreachableError(not_git)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pacman-lu-plain-'));
    writeFileSync(join(plain, 'notes.txt'), 'not a repo\n');
    const err = await ws.prepare(localPrepareInput(plain, true)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRepoUnreachableError);
    expect(err).toMatchObject({
      name: 'LocalRepoUnreachableError',
      repoPath: plain,
      reason: 'not_git',
    });
    rmSync(plain, { recursive: true, force: true });
  }, 30_000);

  test('L3 健康工作树仓 → prepare 照常成功（仓库所在机行为零漂移）', async () => {
    const repo = await seedUserRepo();
    const prepared = await ws.prepare(localPrepareInput(repo, true));
    expect(prepared.reused).toBe(false);
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(prepared.defaultBranch).toBe('main');
  }, 30_000);

  test('L4 repoKind 缺省 + 路径不存在 → 现行为保持：裸 git 错误，不是类型化错误', async () => {
    // 裸 clone 走 withGitNetRetries 两档退避（1s+5s）——预算内等它烧完。
    const gone = join(root, 'definitely-not-here', 'repo');
    const err = await ws.prepare(localPrepareInput(gone, false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LocalRepoUnreachableError);
  }, 30_000);

  test('L5 文案：点名机器 + 路径 + 原因人话 + 两条补法', () => {
    const err = new LocalRepoUnreachableError('/Users/dev/code/pacman', 'not_found');
    const msg = localRepoUnreachableMessage('mea', err);
    expect(msg).toContain('mea'); // 哪台机器
    expect(msg).toContain('/Users/dev/code/pacman'); // 哪个路径
    expect(msg).toContain('路径不存在'); // 原因人话（LOCAL_ERROR_REASON_COPY 词表）
    expect(msg).toContain('钉选'); // 补法①：机器钉选面
    expect(msg).toContain('GitHub 形态'); // 补法②：跨机开发的项目形态
    // 凭据面零出现（local 形态凭证恒 null；文案只含机器/路径/补法）。
    expect(msg).not.toMatch(/token|password|x-access/i);
    const notGit = localRepoUnreachableMessage(
      'mea',
      new LocalRepoUnreachableError('/srv/plain', 'not_git'),
    );
    expect(notGit).toContain('不是 git 仓库');
  });
});
