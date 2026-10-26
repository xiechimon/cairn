import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { normalizedRepoRef, WorkspaceManager } from '../src/workspace.js';

const IDENTITY = { name: 'it-agent', email: 'it@cairn.local' };

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

let root: string;
let truthDir: string;
let seedDir: string;
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

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

async function advanceTruth(): Promise<string> {
  writeFileSync(join(seedDir, 'README.md'), '# v2\n');
  await runGit(['add', '-A'], { cwd: seedDir });
  await runGit(['commit', '-m', 'v2'], { cwd: seedDir, env: commitEnv(IDENTITY) });
  await runGit(['push', 'origin', 'main'], { cwd: seedDir });
  const r = await runGit(['rev-parse', 'main'], { cwd: truthDir });
  return r.stdout.trim();
}

async function makeUserRepo(): Promise<string> {
  const dir = join(makeTestTempDir('cairn-dual-user-'), 'repo');
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
  root = makeTestTempDir('cairn-dual-root-');
  truthDir = join(makeTestTempDir('cairn-dual-truth-'), 'truth.git');
  seedDir = join(makeTestTempDir('cairn-dual-seed-'), 'seed');
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedTruth();
});

describe('normalizedRepoRef (URL shape normalization, #1213)', () => {
  test('N: the four github shapes are one repo; .git suffix and scheme erased', () => {
    const https = normalizedRepoRef('https://github.com/octo/dual.git');
    expect(https).toBe('github.com/octo/dual');
    expect(normalizedRepoRef('https://github.com/octo/dual')).toBe(https);
    expect(normalizedRepoRef('http://github.com/octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('git@github.com:octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('ssh://git@github.com/octo/dual.git')).toBe(https);
    expect(normalizedRepoRef('git://github.com/octo/dual.git')).toBe(https);
  });

  test('N: same owner/repo on a different host does not absorb; local paths normalized to the .git-stripped path', () => {
    expect(normalizedRepoRef('git@git.internal:octo/dual.git')).toBe('git.internal/octo/dual');
    expect(normalizedRepoRef('git@git.internal:octo/dual.git')).not.toBe(
      normalizedRepoRef('https://github.com/octo/dual.git'),
    );
    expect(normalizedRepoRef('/tmp/x/repo.git')).toBe('/tmp/x/repo');
    expect(normalizedRepoRef('/tmp/x/repo.git/')).toBe('/tmp/x/repo');
  });
});

describe('dual execution-source selection (github-shape localPath acceleration slot, #1213)', () => {
  test('D1 localPath missing → fall back to GitHub clone + one source-selection log line', async () => {
    const prepared = await ws.prepare(prepareInput('/definitely/not/here/repo'));
    expect(prepared.reused).toBe(false);
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines).toContainEqual(expect.stringMatching(/Repo source: github-clone/));
    expect(logger.lines.some((l) => l.includes('not found'))).toBe(true);
  }, 30_000);

  test('D2 origin mismatch → fall back (against mistaken absorption)', async () => {
    const userRepo = await makeUserRepo();
    const other = join(makeTestTempDir('cairn-dual-other-'), 'truth.git');
    await runGit(['init', '--bare', other]);
    await runGit(['remote', 'set-url', 'origin', other], { cwd: userRepo });
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('origin mismatch'))).toBe(true);
  }, 30_000);

  test('D3 same repo → local source used: base origin repointed to the truth; HEAD = truth remote tip after fetch', async () => {
    const userRepo = await makeUserRepo();
    const v2 = await advanceTruth();
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(logger.lines).toContainEqual(`[workspace] Repo source: local-path ${userRepo}`);
    const origin = await gitPrim.remoteUrl(prepared.baseRepoDir);
    expect(origin).toBe(truthDir);
    expect(await gitPrim.head(prepared.cwd)).toBe(v2);
    expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('# v2\n');
  }, 30_000);

  test('D4 TOCTOU: the source dies at clone time after the verdict → fallback without crash, base lands as usual', async () => {
    const userRepo = await makeUserRepo();
    rmSync(join(userRepo, '.git', 'objects'), { recursive: true, force: true });
    writeFileSync(join(userRepo, '.git', 'objects'), 'broken');
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('github-clone'))).toBe(true);
  }, 30_000);

  test("D5 default branch takes the truth remote's HEAD: the local source parked on a topic branch does not drift", async () => {
    const userRepo = await makeUserRepo();
    await runGit(['checkout', '-b', 'topic'], { cwd: userRepo });
    writeFileSync(join(userRepo, 'topic.txt'), 'topic\n');
    await runGit(['add', '-A'], { cwd: userRepo });
    await runGit(['commit', '-m', 'topic work'], { cwd: userRepo, env: commitEnv(IDENTITY) });
    const prepared = await ws.prepare(prepareInput(userRepo));
    expect(prepared.defaultBranch).toBe('main');
    expect(existsSync(join(prepared.cwd, 'topic.txt'))).toBe(false);
  }, 30_000);

  test('D6 localPath absent → straight truth clone, no source-selection log (zero drift)', async () => {
    const prepared = await ws.prepare(prepareInput(null));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('Repo source'))).toBe(false);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(true);
  }, 30_000);
});
