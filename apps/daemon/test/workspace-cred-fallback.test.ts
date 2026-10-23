// workspace prepare 凭据降级单测（#1225 票面「clone/push 凭据序」的 clone 半）。
// 真 git 落地（file:// origin）+ spyOn(gitPrim)：auth 失败用票面 mea 实测原文
// 注入——真网络 401 不进单测，但降级序、来源上浮、闸门语义全部真接线。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. machineCredentialFallback=true + per-step token auth 失败 → clone 降级
//      machine（null cred）成功，prepared.credentialSource = machine，
//      workspace 日志落降级行（原文回传，不含 token 值）
//   2. 缺省（hosted 形态闸关）+ token auth 失败 → 原错误直抛，绝不出现
//      null-cred 二次 clone（票失败方式 3：hosted 仍走 server per-step key）
//   3. 基座已在位（后续步 fetch 面）→ fetch 同降级序，来源 machine
//   4. token 有效 → 单次 clone，来源 integration（集成有效时行为不变）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };
const TOKEN: BoundGitCredentials = {
  username: 'x-access-token',
  password: 'ghp_stale_token',
  url: 'https://github.com/xiechimon/cairn.git',
};
/** 票 #1225 现象段原文（mea 2026-10-11 实测 push 失败 stderr）。 */
const MEA_AUTH_FAILURE =
  'remote: Invalid username or token. Password authentication is not supported.\n' +
  "fatal: Authentication failed for 'https://github.com/xiechimon/cairn.git/'";

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

let root: string;
let originDir: string;
let seedDir: string;
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

const PROJECT_ID = 'proj-1';
const CONV_A = '01a0b86f-04f9-72a8-bba4-75c5cfd6598f';

async function seedOrigin(): Promise<void> {
  await runGit(['init', '--bare', originDir]);
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: originDir });
  await runGit(['clone', originDir, seedDir]);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(seedDir, 'README.md'), '# seed\n');
  await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
  await runGit(['add', '-A'], { cwd: seedDir });
  await runGit(['commit', '-m', 'seed'], { cwd: seedDir, env: commitEnv(IDENTITY) });
  await runGit(['push', 'origin', 'main'], { cwd: seedDir });
}

function prepareInput(overrides: {
  credentials?: BoundGitCredentials | null;
  machineCredentialFallback?: boolean;
}) {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV_A,
    cloneUrl: originDir,
    workspacesRoot: root,
    credentials: overrides.credentials ?? null,
    ...(overrides.machineCredentialFallback !== undefined
      ? { machineCredentialFallback: overrides.machineCredentialFallback }
      : {}),
  };
}

/** gitPrim.clone 桩：cred 非空（integration 路）→ 抛 mea 实测 auth 原文；
 * null（machine 路）→ 真 clone 落地。 */
function cloneSpyFailsForToken(): { calls: (BoundGitCredentials | null)[] } {
  const calls: (BoundGitCredentials | null)[] = [];
  const realClone = gitPrim.clone;
  vi.spyOn(gitPrim, 'clone').mockImplementation(((
    url: string,
    dir: string,
    cred: BoundGitCredentials | null,
  ) => {
    calls.push(cred);
    if (cred !== null) return Promise.reject(new Error(MEA_AUTH_FAILURE));
    return realClone(url, dir, cred);
  }) as typeof gitPrim.clone);
  return { calls };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  root = mkdtempSync(join(tmpdir(), 'cairn-ws-cred-root-'));
  originDir = join(mkdtempSync(join(tmpdir(), 'cairn-ws-cred-origin-')), 'repo.git');
  seedDir = join(
    tmpdir(),
    `cairn-ws-cred-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedOrigin();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace prepare 凭据降级（#1225 clone 半）', () => {
  test('失败方式 1：token auth 失败 + 降级闸开 → clone 降级 machine 成功，来源上浮 + 降级日志', async () => {
    const { calls } = cloneSpyFailsForToken();
    const prepared = await ws.prepare(
      prepareInput({ credentials: TOKEN, machineCredentialFallback: true }),
    );
    // integration 一次（auth 失败，net-retry 已短路）+ machine 一次。
    expect(calls).toEqual([TOKEN, null]);
    expect(prepared.credentialSource).toBe('machine');
    // worktree 真落地（machine 路真 clone 成功）。
    expect(prepared.branch).toBe('cairn/conv-'.concat(CONV_A));
    // 降级日志：原文回传、不携带 token 值（票失败方式 2）。
    const fallbackLine = logger.lines.find((l) => l.includes('machine credentials'));
    expect(fallbackLine).toBeDefined();
    expect(String(fallbackLine)).toContain('Invalid username or token');
    expect(logger.lines.some((l) => l.includes(TOKEN.password))).toBe(false);
  }, 30_000);

  test('失败方式 2：闸关（hosted 缺省）→ auth 失败原错误直抛，绝不 null-cred 二次 clone', async () => {
    const { calls } = cloneSpyFailsForToken();
    await expect(ws.prepare(prepareInput({ credentials: TOKEN }))).rejects.toThrow(
      'Authentication failed',
    );
    expect(calls).toEqual([TOKEN]);
  }, 30_000);

  test('失败方式 3：基座已在位 → fetch 同降级序，来源 machine', async () => {
    // 先用 machine 路物化基座（token null = 现行为）。
    await ws.prepare(prepareInput({ credentials: null }));
    const calls: (BoundGitCredentials | null)[] = [];
    const realFetch = gitPrim.fetch;
    vi.spyOn(gitPrim, 'fetch').mockImplementation(((
      repoDir: string,
      cred: BoundGitCredentials | null,
    ) => {
      calls.push(cred);
      if (cred !== null) return Promise.reject(new Error(MEA_AUTH_FAILURE));
      return realFetch(repoDir, cred);
    }) as typeof gitPrim.fetch);
    const prepared = await ws.prepare(
      prepareInput({ credentials: TOKEN, machineCredentialFallback: true }),
    );
    expect(calls).toEqual([TOKEN, null]);
    expect(prepared.credentialSource).toBe('machine');
    expect(prepared.reused).toBe(true);
  }, 30_000);

  test('失败方式 4：token 有效 → 单次 clone，来源 integration（集成有效时行为不变）', async () => {
    const calls: (BoundGitCredentials | null)[] = [];
    const realClone = gitPrim.clone;
    vi.spyOn(gitPrim, 'clone').mockImplementation(((
      url: string,
      dir: string,
      cred: BoundGitCredentials | null,
    ) => {
      calls.push(cred);
      return realClone(url, dir, cred);
    }) as typeof gitPrim.clone);
    const prepared = await ws.prepare(
      prepareInput({ credentials: TOKEN, machineCredentialFallback: true }),
    );
    expect(calls).toEqual([TOKEN]);
    expect(prepared.credentialSource).toBe('integration');
    expect(prepared.reused).toBe(false);
  }, 30_000);
});
