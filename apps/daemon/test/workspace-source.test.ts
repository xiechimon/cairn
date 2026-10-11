// #1213 / ADR 0017 daemon 半：workspace 物化的双执行源选源（github 形态
// localPath 加速位）。失败方式先列（本文件即失败场景清单；票面逐条对应）：
//   N  URL 形态归一化（纯函数）：https / ssh:// / scp 形 git@github.com:o/r
//      与 https://github.com/o/r.git 同仓；非 github host / 本地路径各归各。
//   D1 localPath 不存在 → 静默回落 GitHub clone，不报错不卡步，日志一行
//      选源结果（github-clone + not found）。
//   D2 localPath 存在但 origin 对不上 → 回落（防误吸：异 host 同 owner/repo
//      不吸）。
//   D3 localPath 存在且同仓 → 走本地源：基座 origin 重指真值 URL + fetch 后
//      worktree HEAD = 真值远端 tip（加速位省传输，新鲜度判定不松——本地
//      落后 1 提交也要被追平）。
//   D4 TOCTOU：判定通过但 clone 当刻源不可用（objects 损毁）→ 回落不崩，
//      半成品基座清干净后 GitHub clone 照常落。
//   D5 默认分支取真值远端 HEAD：本地源检出在 topic 分支时，defaultBranch
//      仍 = 真值默认分支（clone 自本地的 origin/HEAD 会漂，须 set-head -a
//      重钉）。
//   D6 local 形态（localPath 缺省）行为零漂移：直接 GitHub clone，无选源行。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { normalizedRepoRef, WorkspaceManager } from '../src/workspace.js';

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

const PROJECT_ID = 'proj-dual';
const CONV = '01a0b86f-04f9-72a8-bba4-75c5cfd6598f';

let root: string; // workspacesRoot
let truthDir: string; // 真值远端（bare，「GitHub」等价物——cloneUrl 即它）
let seedDir: string; // 真值工作区（推提交用）
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

/** 真值 bare repo：main 一提交（README 首版）。 */
async function seedTruth(): Promise<void> {
  await runGit(['init', '--bare', truthDir]);
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: truthDir });
  await runGit(['clone', truthDir, seedDir]);
  await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
  writeFileSync(join(seedDir, 'README.md'), '# v1\n');
  await runGit(['add', '-A'], { cwd: seedDir });
  await runGit(['commit', '-m', 'v1'], { cwd: seedDir, env: commitEnv(IDENTITY) });
  await runGit(['push', 'origin', 'main'], { cwd: seedDir });
}

/** 真值前进一步（v2）；返回 v2 sha。 */
async function advanceTruth(): Promise<string> {
  writeFileSync(join(seedDir, 'README.md'), '# v2\n');
  await runGit(['add', '-A'], { cwd: seedDir });
  await runGit(['commit', '-m', 'v2'], { cwd: seedDir, env: commitEnv(IDENTITY) });
  await runGit(['push', 'origin', 'main'], { cwd: seedDir });
  const r = await runGit(['rev-parse', 'main'], { cwd: truthDir });
  return r.stdout.trim();
}

/** 用户本机仓（localPath 候选）：clone 自真值（origin 指真值）。 */
async function makeUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'pacman-dual-user-')), 'repo');
  await runGit(['clone', truthDir, dir]);
  return dir;
}

function prepareInput(localPath: string | null) {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV,
    cloneUrl: truthDir,
    workspacesRoot: root,
    credentials: null,
    ...(localPath !== null ? { localPath } : {}),
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pacman-dual-root-'));
  truthDir = join(mkdtempSync(join(tmpdir(), 'pacman-dual-truth-')), 'truth.git');
  seedDir = join(mkdtempSync(join(tmpdir(), 'pacman-dual-seed-')), 'seed');
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedTruth();
});

describe('normalizedRepoRef（URL 形态归一化，#1213）', () => {
  test('N：github 四形态同仓；.git 后缀与 scheme 消除', () => {
    const https = normalizedRepoRef('https://github.com/octo/dual.git');
    expect(https).toBe('github.com/octo/dual');
    expect(normalizedRepoRef('https://github.com/octo/dual')).toBe(https);
    expect(normalizedRepoRef('http://github.com/octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('git@github.com:octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('ssh://git@github.com/octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('git://github.com/octo/dual.git')).toBe(https);
  });

  test('N：异 host 同 owner/repo 不吸；本地路径归一为去 .git 路径', () => {
    expect(normalizedRepoRef('git@git.internal:octo/dual.git')).toBe('git.internal/octo/dual');
    expect(normalizedRepoRef('git@git.internal:octo/dual.git')).not.toBe(
      normalizedRepoRef('https://github.com/octo/dual.git'),
    );
    expect(normalizedRepoRef('/tmp/x/repo.git')).toBe('/tmp/x/repo');
    expect(normalizedRepoRef('/tmp/x/repo.git/')).toBe('/tmp/x/repo');
  });
});

describe('双执行源选源（github 形态 localPath 加速位，#1213）', () => {
  test('D1 localPath 不存在 → 回落 GitHub clone + 一行选源日志', async () => {
    const prepared = await ws.prepare(prepareInput('/definitely/not/here/repo'));
    expect(prepared.reused).toBe(false);
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines).toContainEqual(expect.stringMatching(/Repo source: github-clone/));
    expect(logger.lines.some((l) => l.includes('not found'))).toBe(true);
  }, 30_000);

  test('D2 origin 对不上 → 回落（防误吸）', async () => {
    const userRepo = await makeUserRepo();
    // origin 重指另一个 bare（同 owner/repo 名也救不了：host/路径归一后不同）。
    const other = join(mkdtempSync(join(tmpdir(), 'pacman-dual-other-')), 'truth.git');
    await runGit(['init', '--bare', other]);
    await runGit(['remote', 'set-url', 'origin', other], { cwd: userRepo });
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('origin mismatch'))).toBe(true);
  }, 30_000);

  test('D3 同仓 → 走本地源：基座 origin 重指真值；fetch 后 HEAD = 真值远端 tip', async () => {
    const userRepo = await makeUserRepo(); // 停在 v1
    const v2 = await advanceTruth(); // 真值前进，本地源落后一提交
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(logger.lines).toContainEqual(`[workspace] Repo source: local-path ${userRepo}`);
    // 基座 origin = 真值 cloneUrl（本地源只当传输，真值判定不松）。
    const origin = await gitPrim.remoteUrl(prepared.baseRepoDir);
    expect(origin).toBe(truthDir);
    // 新鲜度：worktree HEAD = 真值 tip v2，不是本地源停留的 v1。
    expect(await gitPrim.head(prepared.cwd)).toBe(v2);
    expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('# v2\n');
  }, 30_000);

  test('D4 TOCTOU：判定过后 clone 当刻源损毁 → 回落不崩，基座照常落', async () => {
    const userRepo = await makeUserRepo();
    // objects 换成普通文件：remote get-url（只读 config）照常过，clone 必炸
    // ——等价「判定与 clone 之间源被抽走」。
    rmSync(join(userRepo, '.git', 'objects'), { recursive: true, force: true });
    writeFileSync(join(userRepo, '.git', 'objects'), 'broken');
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('github-clone'))).toBe(true);
  }, 30_000);

  test('D5 默认分支取真值远端 HEAD：本地源停在 topic 分支不漂', async () => {
    const userRepo = await makeUserRepo();
    await runGit(['checkout', '-b', 'topic'], { cwd: userRepo });
    writeFileSync(join(userRepo, 'topic.txt'), 'topic\n');
    await runGit(['add', '-A'], { cwd: userRepo });
    await runGit(['commit', '-m', 'topic work'], { cwd: userRepo, env: commitEnv(IDENTITY) });
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(prepared.defaultBranch).toBe('main');
    expect(existsSync(join(prepared.cwd, 'topic.txt'))).toBe(false); // base = origin/main
  }, 30_000);

  test('D6 localPath 缺省 → 直接真值 clone，无选源日志（零漂移）', async () => {
    const prepared = await ws.prepare(prepareInput(null));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('Repo source'))).toBe(false);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(true);
  }, 30_000);
});
