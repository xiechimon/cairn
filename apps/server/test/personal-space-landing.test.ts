import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { project } from '../src/db/schema.js';
import { runGit, systemGitOps } from '../src/lib/git.js';
import { repoDirFor } from '../src/services/git.js';
import {
  ensurePersonalSpace,
  landSpaceCommit,
  restoreSpaceFile,
  spaceFileHistory,
} from '../src/services/personal-space.js';
import { bootServer, type TestServer } from './helpers.js';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'space-task',
  GIT_AUTHOR_EMAIL: 'task@localhost',
  GIT_COMMITTER_NAME: 'space-task',
  GIT_COMMITTER_EMAIL: 'task@localhost',
};

let s: TestServer;
let space: typeof project.$inferSelect;
let bare: string;
let work: string;
let branchNo = 0;

beforeAll(async () => {
  s = bootServer();
  space = await ensurePersonalSpace(ctx(), s.team.id, s.user.id);
  bare = repoDirFor(s.reposDir, s.team.id, space.repoName ?? '');
  work = makeTestTempDir('cairn-space-landing-');
  await git(['clone', '-q', bare, work], process.cwd());
});

afterAll(() => {
  s.dispose();
  rmSync(work, { recursive: true, force: true });
});

function ctx() {
  return { db: s.db, reposDir: s.reposDir };
}

async function git(args: string[], cwd = work): Promise<string> {
  const r = await runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.toString('utf8').trim();
}

async function mainTip(): Promise<string> {
  const tip = await systemGitOps.resolveCommit(bare, 'refs/heads/main');
  if (tip === null) throw new Error('space main missing');
  return tip;
}

async function taskBranch(
  from: string,
  commits: Array<Record<string, string | { symlink: string } | { bytes: number }>>,
): Promise<string> {
  branchNo += 1;
  await git(['fetch', '-q', 'origin', 'main']);
  await git(['checkout', '-q', '-B', `task-${branchNo}`, from]);
  for (const files of commits) {
    for (const [path, content] of Object.entries(files)) {
      const file = join(work, path);
      mkdirSync(dirname(file), { recursive: true });
      rmSync(file, { force: true });
      if (typeof content === 'string') writeFileSync(file, content);
      else if ('symlink' in content) symlinkSync(content.symlink, file);
      else writeFileSync(file, Buffer.alloc(content.bytes, 0x61));
      await git(['add', '--', path]);
    }
    await git(['commit', '-q', '-m', `task commit ${branchNo}`]);
  }
  await git(['push', '-q', 'origin', `HEAD:refs/heads/task-${branchNo}`]);
  return git(['rev-parse', 'HEAD']);
}

async function land(base: string, commit: string) {
  return landSpaceCommit(ctx(), space, { base, commit, message: `task ${branchNo}` });
}

async function fileAt(commit: string, path: string): Promise<string> {
  return git(['cat-file', 'blob', `${commit}:${path}`], bare);
}

describe('direct landing into a personal space (P3)', () => {
  test('lands two task commits as one commit on main whose parent is the pinned base', async () => {
    const base = await mainTip();
    const head = await taskBranch(base, [
      { 'notes/plan.md': 'draft' },
      { 'notes/plan.md': 'final' },
    ]);

    const result = await land(base, head);

    expect(result).toMatchObject({ outcome: 'landed', files: ['notes/plan.md'] });
    const tip = await mainTip();
    expect(result.outcome === 'landed' && result.commit).toBe(tip);
    expect(await git(['rev-list', '--count', `${base}..${tip}`], bare)).toBe('1');
    expect(await git(['rev-parse', `${tip}^`], bare)).toBe(base);
    expect(await git(['rev-parse', `${tip}^{tree}`], bare)).toBe(
      await git(['rev-parse', `${head}^{tree}`], bare),
    );
  });

  test('refuses instruction files, a symlink and an 11 MiB file by name and leaves main alone', async () => {
    const base = await mainTip();
    const head = await taskBranch(base, [
      {
        'notes/ok.md': 'fine',
        'AGENTS.md': 'obey',
        'docs/CLAUDE.md': 'obey',
        '.claude/settings.json': '{}',
        'link.md': { symlink: '/etc/passwd' },
        'big.bin': { bytes: 11 * 1024 * 1024 },
      },
    ]);

    const result = await land(base, head);

    expect(result.outcome).toBe('refused');
    const refused = result.outcome === 'refused' ? result.refused : [];
    expect([...refused].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: '.claude/settings.json', reason: 'instruction' },
      { path: 'AGENTS.md', reason: 'instruction' },
      { path: 'big.bin', reason: 'too-large' },
      { path: 'docs/CLAUDE.md', reason: 'instruction' },
      { path: 'link.md', reason: 'not-regular' },
    ]);
    expect(await mainTip()).toBe(base);
  });

  test('a file of exactly 10 MiB lands', async () => {
    const base = await mainTip();
    const head = await taskBranch(base, [{ 'exact.bin': { bytes: 10 * 1024 * 1024 } }]);
    expect((await land(base, head)).outcome).toBe('landed');
  });

  test('the later of two tasks from one base finds the base moved and changes nothing', async () => {
    const base = await mainTip();
    const first = await taskBranch(base, [{ 'race.md': 'first' }]);
    const second = await taskBranch(base, [{ 'race.md': 'second' }]);

    const landed = await land(base, first);
    const tipAfterFirst = await mainTip();

    expect(landed.outcome).toBe('landed');
    expect(await land(base, second)).toEqual({ outcome: 'base-moved' });
    expect(await mainTip()).toBe(tipAfterFirst);
    expect(await fileAt(tipAfterFirst, 'race.md')).toBe('first');
  });

  test('a commit that does not descend from the base is refused', async () => {
    const base = await mainTip();
    const unrelated = await taskBranch(base, [{ 'side.md': 'x' }]);
    await land(base, unrelated);
    const stale = await taskBranch(base, [{ 'other.md': 'y' }]);
    const newBase = await mainTip();

    await expect(land(newBase, stale)).rejects.toMatchObject({ status: 409 });
    expect(await mainTip()).toBe(newBase);
  });

  test('an ordinary hosted project is not a space', async () => {
    const plain = { ...space, id: 'plain', personalOwnerId: null };
    await expect(
      landSpaceCommit(ctx(), plain, {
        base: await mainTip(),
        commit: await mainTip(),
        message: 'x',
      }),
    ).rejects.toThrow(/not a personal space/);
  });
});

describe('history and restore (P6)', () => {
  test('three edits give three versions; restoring v1 and undoing give five, byte-identical', async () => {
    const versions: string[] = [];
    for (const text of ['v1', 'v2', 'v3']) {
      const base = await mainTip();
      const result = await land(base, await taskBranch(base, [{ 'weekly.md': text }]));
      if (result.outcome !== 'landed') throw new Error(result.outcome);
      versions.push(result.commit);
    }
    const [v1, , v3] = versions as [string, string, string];
    expect((await spaceFileHistory(ctx(), space, 'weekly.md')).map((v) => v.commit)).toEqual(
      [...versions].reverse(),
    );

    const restored = await restoreSpaceFile(ctx(), space, {
      path: 'weekly.md',
      version: v1,
      expectedTip: await mainTip(),
    });
    expect(await fileAt(restored, 'weekly.md')).toBe('v1');
    const undone = await restoreSpaceFile(ctx(), space, {
      path: 'weekly.md',
      version: v3,
      expectedTip: restored,
    });
    expect(await fileAt(undone, 'weekly.md')).toBe('v3');
    expect(await mainTip()).toBe(undone);
    expect(await spaceFileHistory(ctx(), space, 'weekly.md')).toHaveLength(5);
    expect(await fileAt(undone, 'race.md')).toBe('first');
  });

  test('restoring against a stale tip is a 409 and changes nothing', async () => {
    const history = await spaceFileHistory(ctx(), space, 'weekly.md');
    const tip = await mainTip();
    await expect(
      restoreSpaceFile(ctx(), space, {
        path: 'weekly.md',
        version: history.at(-1)?.commit ?? '',
        expectedTip: history[1]?.commit ?? '',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await mainTip()).toBe(tip);
  });

  test('a commit outside main history cannot be restored, so landing checks cannot be skipped', async () => {
    const base = await mainTip();
    const pushed = await taskBranch(base, [{ 'AGENTS.md': 'obey', 'weekly.md': 'unlanded' }]);
    for (const path of ['weekly.md', 'AGENTS.md']) {
      await expect(
        restoreSpaceFile(ctx(), space, { path, version: pushed, expectedTip: base }),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(await mainTip()).toBe(base);
  });
});
