import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };
const TOKEN: BoundGitCredentials = {
  username: 'x-access-token',
  password: 'ghp_stale_token',
  url: 'https://github.com/xiechimon/cairn.git',
};
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
  root = makeTestTempDir('cairn-ws-cred-root-');
  originDir = join(makeTestTempDir('cairn-ws-cred-origin-'), 'repo.git');
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

describe('workspace prepare credential fallback (#1225 clone half)', () => {
  test('failure mode 1: token auth failure + fallback gate open → clone falls back to machine and succeeds, provenance surfaces + fallback log', async () => {
    const { calls } = cloneSpyFailsForToken();
    const prepared = await ws.prepare(
      prepareInput({ credentials: TOKEN, machineCredentialFallback: true }),
    );
    expect(calls).toEqual([TOKEN, null]);
    expect(prepared.credentialSource).toBe('machine');
    expect(prepared.branch).toBe('cairn/conv-'.concat(CONV_A));
    const fallbackLine = logger.lines.find((l) => l.includes('machine credentials'));
    expect(fallbackLine).toBeDefined();
    expect(String(fallbackLine)).toContain('Invalid username or token');
    expect(logger.lines.some((l) => l.includes(TOKEN.password))).toBe(false);
  }, 30_000);

  test('failure mode 2: gate closed (hosted default) → auth failure rethrown as-is, never a null-cred second clone', async () => {
    const { calls } = cloneSpyFailsForToken();
    await expect(ws.prepare(prepareInput({ credentials: TOKEN }))).rejects.toThrow(
      'Authentication failed',
    );
    expect(calls).toEqual([TOKEN]);
  }, 30_000);

  test('failure mode 3: base already in place → fetch follows the same fallback order, provenance machine', async () => {
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

  test('failure mode 4: token valid → single clone, provenance integration (behavior unchanged while integration works)', async () => {
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
