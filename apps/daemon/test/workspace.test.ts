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
} from '@cairn/shared';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { commitEnv, gitPrim, runGit } from '../src/git.js';
import type { DaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';
import { stubOutInheritedGitConfig } from './git-config-env.js';

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

let root: string;
let originDir: string;
let seedDir: string;
let logger: ReturnType<typeof fakeLogger>;
let ws: WorkspaceManager;

const PROJECT_ID = 'proj-1';
const CONV_A = '01a0b86f-04f9-72a8-bba4-75c5cfd6598f';
const CONV_B = '01a0b870-1111-7222-8888-75c5cfd6598f';

async function seedOrigin(): Promise<void> {
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

function seedHook(name: 'setup' | 'resume', body: string): void {
  mkdirSync(join(seedDir, '.agents'), { recursive: true });
  const p = join(seedDir, '.agents', name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cairn-ws-root-'));
  originDir = join(mkdtempSync(join(tmpdir(), 'cairn-ws-origin-')), 'repo.git');
  seedDir = join(tmpdir(), `cairn-ws-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  logger = fakeLogger();
  ws = new WorkspaceManager({ logger });
  await seedOrigin();
});

describe('worktree contract (02 §5.5 / r3 §1.4)', () => {
  test('the info-card read-only export refuses commit and push', async () => {
    const prepared = await ws.prepare({ ...prepareInput(CONV_A), readonly: true });
    expect(prepared.readonly).toBe(true);
    expect(existsSync(join(prepared.cwd, '.git'))).toBe(false);
    await expect(ws.commitAll(prepared.cwd, 'report', IDENTITY)).rejects.toThrow(
      'readonly workspace rejects git writes',
    );
    await expect(ws.push(prepared.cwd, prepared.branch, null)).rejects.toThrow(
      'readonly workspace rejects git writes',
    );
  }, 30_000);

  test('prepare: base clone lands at <root>/<projectId>/repo + worktree add -b lands at <root>/<convId>, branch cairn/conv-*', async () => {
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

  test('a second conv on the same project: base fetch reused (no re-clone); the same conv again = Worktree reused', async () => {
    await ws.prepare(prepareInput(CONV_A));
    logger.lines.length = 0;
    const b = await ws.prepare(prepareInput(CONV_B));
    expect(b.reused).toBe(false);
    expect(logger.lines.some((l) => l.includes('Cloning'))).toBe(false);
    const again = await ws.prepare(prepareInput(CONV_A));
    expect(again.reused).toBe(true);
    expect(logger.lines).toContain('[workspace] Worktree reused');
  }, 30_000);

  test('#1484: on base reuse, origin has drifted from cloneUrl → repointed to cloneUrl first, then fetch', async () => {
    const first = await ws.prepare(prepareInput(CONV_A));
    await runGit(['remote', 'set-url', 'origin', join(root, 'gone.git')], { cwd: first.cwd });
    const second = await ws.prepare(prepareInput(CONV_B));
    expect(await gitPrim.remoteUrl(second.baseRepoDir)).toBe(originDir);
    expect(logger.lines).toContain('[workspace] Repo origin re-pointed to the project clone URL');
  }, 30_000);

  test("#1484: comparison uses origin's raw configured value, insteadOf rewrites do not trigger repointing", async () => {
    const alias = 'cairn-alias:repo';
    stubOutInheritedGitConfig();
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', `url.${originDir}.insteadOf`);
    vi.stubEnv('GIT_CONFIG_VALUE_0', alias);
    try {
      await ws.prepare({ ...prepareInput(CONV_A), cloneUrl: alias });
      logger.lines.length = 0;
      await ws.prepare({ ...prepareInput(CONV_B), cloneUrl: alias });
      expect(logger.lines).not.toContain(
        '[workspace] Repo origin re-pointed to the project clone URL',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  test('base choice: origin/<convBranch> preferred when already fetched (cross-machine continuation surface)', async () => {
    const branch = conversationBranch(CONV_A);
    await runGit(['checkout', '-b', branch], { cwd: seedDir });
    writeFileSync(join(seedDir, 'probe.txt'), 'remote-work\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'remote work'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', branch], { cwd: seedDir });

    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(existsSync(join(prepared.cwd, 'probe.txt'))).toBe(true);
    expect(await gitPrim.currentBranch(prepared.cwd)).toBe(branch);
  }, 30_000);

  test("commitAll + push: the conversation's working branch is pushed automatically at the end of every step; a clean tree = committed false", async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    writeFileSync(join(prepared.cwd, 'README.md'), '# seed\n\nprobe line\n');
    const first = await ws.commitAll(prepared.cwd, 'build: probe', IDENTITY);
    expect(first.committed).toBe(true);
    expect(first.head).toMatch(/^[0-9a-f]{40}$/);
    await ws.push(prepared.cwd, prepared.branch, null);
    const remoteRef = await runGit(['rev-parse', '--verify', `refs/heads/${prepared.branch}`], {
      cwd: originDir,
    });
    expect(remoteRef.code).toBe(0);
    expect(remoteRef.stdout.trim()).toBe(first.head);
    const clean = await ws.commitAll(prepared.cwd, 'build: noop', IDENTITY);
    expect(clean.committed).toBe(false);
    expect(await ws.countAhead(prepared.cwd, prepared.defaultBranch)).toBe(1);
  }, 30_000);

  test('#958 gate 5: files carrying the brief marker are excluded from the commit, same-named files without the marker are committed as usual', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    writeFileSync(
      join(prepared.cwd, 'AGENTS.md'),
      `<!-- BEGIN CAIRN-RUNTIME (auto-managed; do not edit) -->\n简报\n<!-- END CAIRN-RUNTIME -->\n`,
    );
    writeFileSync(join(prepared.cwd, 'NOTES.md'), 'agent 的产物\n');
    const first = await ws.commitAll(prepared.cwd, 'build: marker scan', IDENTITY);
    expect(first.committed).toBe(true);
    const listed = await runGit(['show', '--name-only', '--pretty=format:', first.head ?? 'HEAD'], {
      cwd: prepared.cwd,
    });
    expect(listed.stdout).toContain('NOTES.md');
    expect(listed.stdout).not.toContain('AGENTS.md');
    expect(logger.lines.some((l) => l.includes('brief marker dropped from commit'))).toBe(true);
    expect(existsSync(join(prepared.cwd, 'AGENTS.md'))).toBe(true);
  }, 30_000);

  test('#958 gate 4: briefMarkerInRef names it when the branch history carries the marker, empty for a clean branch', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(await ws.briefMarkerInRef(prepared.cwd, prepared.branch)).toEqual([]);

    writeFileSync(
      join(prepared.cwd, 'AGENTS.md'),
      `<!-- BEGIN CAIRN-RUNTIME (auto-managed; do not edit) -->\n简报\n<!-- END CAIRN-RUNTIME -->\n`,
    );
    await runGit(['add', '-A'], { cwd: prepared.cwd });
    await runGit(
      [
        '-c',
        'user.name=it-agent',
        '-c',
        'user.email=it@cairn.local',
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

  test('checkpoint restore: reset --hard + clean -fd → Worktree restored (r3 §1.4/§3.5)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const checkpoint = (await ws.commitAll(prepared.cwd, 'plan: v1', IDENTITY)).head;
    writeFileSync(join(prepared.cwd, 'README.md'), 'corrupted\n');
    writeFileSync(join(prepared.cwd, 'scratch.txt'), 'dirty\n');
    await ws.restoreCheckpoint(prepared.cwd, checkpoint!);
    expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('# seed\n');
    expect(existsSync(join(prepared.cwd, 'scratch.txt'))).toBe(false);
    expect(logger.lines).toContain('[workspace] Worktree restored');
  }, 30_000);

  test('merge --no-edit two states: Already up to date / a real merge (when main advances)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const idle = await ws.mergeDefaultBranch(prepared.cwd, prepared.defaultBranch);
    expect(idle.output).toMatch(/Already up to date/i);

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

  test('anti-divergence guardrail: origin/<branch> is ahead and the worktree is not on that branch → remote branch diverged', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    await runGit(['checkout', '-B', 'detached-probe', 'origin/main'], { cwd: prepared.cwd });
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

  test('orphan reclamation: three-step cleanup of conv worktrees older than the TTL (7×24h); live steps / new directories untouched', async () => {
    const stale = await ws.prepare(prepareInput(CONV_A));
    const fresh = await ws.prepare(prepareInput(CONV_B));
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale.cwd, old, old);

    const removed = await ws.cleanupOrphans({
      workspacesRoot: root,
      ttlMs: ORPHAN_WORKTREE_TTL_MS,
      now: Date.now(),
      activeConversationIds: [],
    });
    expect(removed).toEqual([]);
    const removedByNow = await ws.cleanupOrphans({
      workspacesRoot: root,
      ttlMs: ORPHAN_WORKTREE_TTL_MS,
      now: Date.now() + 8 * 24 * 60 * 60 * 1000,
      activeConversationIds: [CONV_B],
    });
    expect(removedByNow).toContain(CONV_A);
    expect(removedByNow).not.toContain(CONV_B);
    expect(existsSync(stale.cwd)).toBe(false);
    expect(existsSync(fresh.cwd)).toBe(true);
    expect(await gitPrim.hasLocalBranch(stale.baseRepoDir, stale.branch)).toBe(false);
    expect(await gitPrim.hasLocalBranch(fresh.baseRepoDir, fresh.branch)).toBe(true);
  }, 30_000);

  test('projectLock: concurrent prepares on the same project serialized (clone race guardrail)', async () => {
    const [a, b] = await Promise.all([
      ws.prepare(prepareInput(CONV_A)),
      ws.prepare(prepareInput(CONV_B)),
    ]);
    expect(a.cwd).toBe(join(root, CONV_A));
    expect(b.cwd).toBe(join(root, CONV_B));
    expect(logger.lines.filter((l) => l.includes('Cloning'))).toHaveLength(1);
  }, 30_000);
});

describe('#1195 branchesWithNewCommits (step-window branch scan primitive)', () => {
  async function commitOn(
    dir: string,
    branch: string,
    file: string,
    content: string,
    env: NodeJS.ProcessEnv = {},
  ): Promise<void> {
    await runGit(['checkout', '-B', branch], { cwd: dir });
    writeFileSync(join(dir, file), content);
    await runGit(['add', '-A'], { cwd: dir });
    await runGit(['commit', '-m', `work on ${branch}`], {
      cwd: dir,
      env: { ...commitEnv(IDENTITY), ...env },
    });
  }

  test('accident shape: a self-created branch keeps new commits within the window, HEAD already switched back → the branch is scanned out', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const base = (await gitPrim.head(prepared.cwd)) as string;
    const sinceMs = Date.now();
    await commitOn(prepared.cwd, 'dogfood/tracer-1153', 'note.md', 'verification note\n');
    await runGit(['checkout', prepared.branch], { cwd: prepared.cwd });
    const found = await gitPrim.branchesWithNewCommits(prepared.cwd, base, sinceMs);
    expect(found).toContain('dogfood/tracer-1153');
    expect(found).not.toContain(prepared.branch);
  }, 30_000);

  test("branches outside the window miss: tip commit earlier than sinceMs (user's existing branches not misattributed)", async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    await commitOn(prepared.cwd, 'user/old-feature', 'old.md', 'old work\n', {
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00+00:00',
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00+00:00',
    });
    await runGit(['checkout', prepared.branch], { cwd: prepared.cwd });
    const base = (await gitPrim.head(prepared.cwd)) as string;
    const found = await gitPrim.branchesWithNewCommits(prepared.cwd, base, Date.now());
    expect(found).not.toContain('user/old-feature');
  }, 30_000);

  test('branches with no commits beyond base miss (same-tip empty branches)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const base = (await gitPrim.head(prepared.cwd)) as string;
    await runGit(['branch', 'agent/empty', base], { cwd: prepared.cwd });
    const found = await gitPrim.branchesWithNewCommits(prepared.cwd, base, Date.now() - 60_000);
    expect(found).not.toContain('agent/empty');
  }, 30_000);

  test('neighboring conv branches reported as-is (exclusion is a runner-side policy, the primitive makes no attribution ruling)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const base = (await gitPrim.head(prepared.cwd)) as string;
    const sibling = conversationBranch(CONV_B);
    await commitOn(prepared.cwd, sibling, 'sib.md', 'sibling work\n');
    await runGit(['checkout', prepared.branch], { cwd: prepared.cwd });
    const found = await gitPrim.branchesWithNewCommits(prepared.cwd, base, Date.now());
    expect(found).toContain(sibling);
  }, 30_000);

  test('base unparseable → empty set (fail-open, no throw, no blocked close-out)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const found = await gitPrim.branchesWithNewCommits(
      prepared.cwd,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      Date.now(),
    );
    expect(found).toEqual([]);
  }, 30_000);

  test('WorkspaceManager passes through the same semantics (WorktreeOps seam consumer surface)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    const base = (await gitPrim.head(prepared.cwd)) as string;
    await commitOn(prepared.cwd, 'dogfood/passthrough', 'p.md', 'x\n');
    await runGit(['checkout', prepared.branch], { cwd: prepared.cwd });
    const found = await ws.branchesWithNewCommits(prepared.cwd, base, Date.now());
    expect(found).toContain('dogfood/passthrough');
    expect(await ws.currentBranch(prepared.cwd)).toBe(prepared.branch);
  }, 30_000);
});

describe('#1149 environment lifecycle hooks (two prepare mount points)', () => {
  test('fresh checkout → .agents/setup runs, hooks slot carries an ok note (including stdout)', async () => {
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

  test('repo without hooks: hooks default to [], zero hook log lines (behavior consistent with current)', async () => {
    const prepared = await ws.prepare(prepareInput(CONV_A));
    expect(prepared.hooks).toEqual([]);
    expect(logger.lines.some((l) => l.includes('hook'))).toBe(false);
  }, 30_000);

  test('reused → .agents/resume runs (setup not rerun); failure/timeout non-fatal, step continues', async () => {
    seedHook('setup', '#!/bin/sh\necho setup-ran\n');
    seedHook('resume', '#!/bin/sh\necho resume-ran-marker\necho boom >&2\nexit 1\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const first = await ws.prepare(prepareInput(CONV_A));
    expect(first.reused).toBe(false);
    expect(first.hooks![0]!.name).toBe('setup');
    const second = await ws.prepare(prepareInput(CONV_A));
    expect(second.reused).toBe(true);
    expect(second.hooks).toHaveLength(1);
    expect(second.hooks![0]!.name).toBe('resume');
    expect(second.hooks![0]!.status).toBe('failed');
    expect(second.hooks![0]!.output).toContain('resume-ran-marker');
    expect(logger.lines.some((l) => l.includes('resume hook failed (non-fatal'))).toBe(true);
  }, 30_000);

  test('setup failure → prepare throws (step failure surface); worktree rolled back → retry goes through fresh→setup again', async () => {
    seedHook('setup', '#!/bin/sh\necho boom >&2\nexit 3\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    await expect(ws.prepare(prepareInput(CONV_A))).rejects.toThrow(/exited 3/);
    expect(existsSync(join(root, CONV_A))).toBe(false);
    expect(
      await gitPrim.hasLocalBranch(join(root, PROJECT_ID, 'repo'), conversationBranch(CONV_A)),
    ).toBe(false);
  }, 30_000);

  test('stale rebuild (worktree directory manually deleted) → still goes through fresh → setup rerun', async () => {
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

  test('hooks consume step-level credentials: credentials non-null → GIT_CONFIG_COUNT=2 enters the hook env', async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-script content embedded in a JS string; ${GIT_CONFIG_COUNT} is sh parameter expansion, not JS template
    seedHook('setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    stubOutInheritedGitConfig();
    let prepared: Awaited<ReturnType<typeof ws.prepare>>;
    try {
      prepared = await ws.prepare({
        ...prepareInput(CONV_A),
        credentials: {
          username: 'x-access-token',
          password: 'step-token',
          url: 'https://github.com/o/r.git',
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(prepared.hooks![0]!.output).toContain('cred=2');
  }, 30_000);

  test('hook timeout → fatal on the setup surface (step failure), non-fatal on the resume surface', async () => {
    seedHook('setup', '#!/bin/sh\nsleep 10\n');
    await runGit(['add', '-A'], { cwd: seedDir });
    await runGit(['commit', '-m', 'hooks'], { cwd: seedDir, env: commitEnv(IDENTITY) });
    await runGit(['push', 'origin', 'main'], { cwd: seedDir });
    const short = new WorkspaceManager({ logger, hookTimeoutMs: 300 });
    await expect(short.prepare(prepareInput(CONV_A))).rejects.toThrow(/timed out/);
    expect(existsSync(join(root, CONV_A))).toBe(false);
  }, 30_000);
});
