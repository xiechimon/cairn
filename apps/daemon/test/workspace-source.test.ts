import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizedRepoRef } from '@cairn/shared';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { beforeEach, describe, expect, test } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

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

function prepareInput() {
  return {
    projectId: PROJECT_ID,
    conversationId: CONV,
    cloneUrl: truthDir,
    workspacesRoot: root,
    credentials: null,
  };
}

beforeEach(async () => {
  root = testTempDir('cairn-dual-root-');
  truthDir = join(testTempDir('cairn-dual-truth-'), 'truth.git');
  seedDir = join(testTempDir('cairn-dual-seed-'), 'seed');
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedTruth();
});

describe('normalizedRepoRef (URL shape normalization)', () => {
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

describe('workspace source for a github-shape project', () => {
  test('a github project clones straight from the remote', async () => {
    const prepared = await ws.prepare(prepareInput());
    expect(
      (
        await runGit(['rev-parse', `${repositoryCacheRefPrefix(truthDir)}/heads/main`], {
          cwd: prepared.baseRepoDir,
        })
      ).stdout.trim(),
    ).toBe(await gitPrim.head(prepared.cwd));
    expect(existsSync(join(prepared.cwd, 'README.md'))).toBe(true);
    expect(logger.lines.some((l) => l.includes('Repo source'))).toBe(false);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(true);
  }, 30_000);
});
