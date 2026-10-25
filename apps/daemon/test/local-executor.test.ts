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
import { type BoundGitCredentials, conversationBranch } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };
const PROJECT_ID = 'proj-local-1';
const CONV_A = '01a0b86f-aaaa-72a8-bba4-75c5cfd6598f';
const PROBE_TOKEN = 'ghp_PROBE0000000000000000000000000000';
const PROBE_CRED: BoundGitCredentials = {
  username: 'x-access-token',
  password: PROBE_TOKEN,
  url: 'https://github.com/o/r.git',
};

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

let userRepo: string;
let root: string;
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

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
  const base = mkdtempSync(join(tmpdir(), 'cairn-local-exec-'));
  userRepo = join(base, 'user-repo');
  root = join(base, 'workspaces');
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedUserRepo(userRepo);
});

describe('local-shape mirror clone (spec 12 G2-T2: hardlinks make it near-zero cost)', () => {
  test('failure mode 1: base clone object files are hardlinked (nlink ≥ 2 for ≥ 50%); plain-copy control = 0 hardlinks', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    expect(prepared.baseRepoDir).toBe(join(root, PROJECT_ID, 'repo'));

    const objectLinks = nlinksUnder(join(prepared.baseRepoDir, '.git', 'objects'));
    const hardlinked = objectLinks.filter((n) => n >= 2);
    expect(objectLinks.length).toBeGreaterThan(0);
    expect(hardlinked.length).toBeGreaterThanOrEqual(Math.ceil(objectLinks.length * 0.5));

    const copyDir = join(root, 'direct-copy');
    cpSync(userRepo, copyDir, { recursive: true });
    const copyLinks = nlinksUnder(join(copyDir, '.git', 'objects'));
    expect(copyLinks.filter((n) => n >= 2)).toHaveLength(0);
  }, 30_000);
});

describe("local-shape landing (#1211: pushing the conv branch is the delivery, user's main checkout untouched)", () => {
  test("failure mode 2: worktree commit pushed back to the user repo → refs/heads gains the conv branch; user's HEAD/reflog/worktree unchanged (not advanced even when ff is possible)", async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    writeFileSync(join(prepared.cwd, 'probe.txt'), 'local landing probe\n');
    const committed = await ws.commitAll(prepared.cwd, 'build: probe', IDENTITY);
    expect(committed.committed).toBe(true);
    const headBefore = await headOf(userRepo);
    const reflogBefore = await runGit(['reflog', 'main'], { cwd: userRepo });

    await ws.push(prepared.cwd, prepared.branch, null);

    const onUser = await runGit(['rev-parse', '--verify', `refs/heads/${prepared.branch}`], {
      cwd: userRepo,
    });
    expect(onUser.code).toBe(0);
    expect(onUser.stdout.trim()).toBe(committed.head);
    const ffShape = await runGit(
      ['merge-base', '--is-ancestor', 'main', `refs/heads/${prepared.branch}`],
      { cwd: userRepo },
    );
    expect(ffShape.code).toBe(0);
    expect(await headOf(userRepo)).toBe(headBefore);
    const reflogAfter = await runGit(['reflog', 'main'], { cwd: userRepo });
    expect(reflogAfter.stdout).toBe(reflogBefore.stdout);
    expect(existsSync(join(userRepo, 'probe.txt'))).toBe(false);
    const status = await runGit(['status', '--porcelain'], { cwd: userRepo });
    expect(status.stdout.trim()).toBe('');
  }, 30_000);

  test("failure mode 3: dirty worktree → push still succeeds (push only writes the conv branch ref); user's HEAD and dirty files unchanged", async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A, userRepo));
    writeFileSync(join(prepared.cwd, 'README.md'), '# user repo\n\nagent line\n');
    await ws.commitAll(prepared.cwd, 'build: readme', IDENTITY);

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

describe('per-step credential argv discipline (spec 12 G2-T2: capturing fork+exec command lines)', () => {
  let shimDir = '';
  let argvLog = '';
  let envLog = '';
  let savedPath = '';

  beforeEach(() => {
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    expect(realGit).not.toBe('');
    shimDir = mkdtempSync(join(tmpdir(), 'cairn-git-shim-'));
    argvLog = join(shimDir, 'argv.log');
    envLog = join(shimDir, 'env.log');
    writeFileSync(
      join(shimDir, 'git'),
      [
        '#!/bin/sh',
        `{ printf '%s ' "$@"; printf '\\n'; } >> "${argvLog}"`,
        `printenv CAIRN_GIT_CRED_USERNAME CAIRN_GIT_CRED_PASSWORD >> "${envLog}" 2>/dev/null || true`,
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

  test('failure mode 5: token never enters argv throughout credential-bearing clone/fetch/push; carried by the env credential.helper (positive control)', async () => {
    const bareRemote = join(mkdtempSync(join(tmpdir(), 'cairn-cred-remote-')), 'origin.git');
    await runGit(['init', '--bare', bareRemote]);
    await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bareRemote });
    const seedDir = join(mkdtempSync(join(tmpdir(), 'cairn-cred-seed-')), 'seed');
    await runGit(['clone', bareRemote, seedDir]);
    writeFileSync(join(seedDir, 'README.md'), '# cred probe\n');
    await runGit(['checkout', '-B', 'main'], { cwd: seedDir });
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'seed'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });

    const credRoot = mkdtempSync(join(tmpdir(), 'cairn-cred-ws-'));
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
    expect(argv).not.toContain(PROBE_TOKEN);
    expect(argv).not.toContain('x-access-token');
    expect(argv).not.toContain('credential.helper');
    const envDump = readFileSync(envLog, 'utf8');
    expect(envDump).toContain(PROBE_TOKEN);
    expect(envDump).toContain('x-access-token');
  }, 30_000);
});
