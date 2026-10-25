import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { type LocalErrorReason, PROJECT_LOCAL_ERROR_REASONS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { expandHomePath } from '../src/services/git.js';
import { bootServer, req } from './helpers.js';

const s = bootServer();
const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  s.dispose();
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

async function makeGitRepo(): Promise<string> {
  const dir = tempDir('cairn-local-repo-');
  const r = await runGit(['init', dir]);
  expect(r.code).toBe(0);
  return dir;
}

interface CreateReply {
  id?: string;
  repoKind?: string;
  repoName?: string;
  githubRepo?: string;
  localPath?: string;
  cloneUrl?: string;
  error?: string;
  reason?: string;
}

async function postCreate(body: unknown): Promise<{ status: number; body: CreateReply }> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  return { status: res.status, body: (await res.json()) as CreateReply };
}

describe('POST /api/projects kind=local -- the localPath three-state validation (#359 AC)', () => {
  test('missing localPath -> 400 (the error position names localPath)', async () => {
    const r = await postCreate({ name: 'p-missing', kind: 'local' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('localPath');
  });

  test('localPath empty string -> 400 (the required state does not branch)', async () => {
    const r = await postCreate({ name: 'p-empty', kind: 'local', localPath: '   ' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('localPath');
    expect(r.body.reason).toBeUndefined();
  });

  test('loosened gate one: a nonexistent path -> 201 (reachability belongs to the daemon-side precheck)', async () => {
    const missing = join(tempDir('cairn-local-base-'), 'no-such-dir');
    const r = await postCreate({ name: 'p-gone', kind: 'local', localPath: missing });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(missing);
  });

  test('loosened gate two: exists but not a git repo -> 201 (reachability belongs to the daemon-side precheck)', async () => {
    const plain = tempDir('cairn-local-plain-');
    const r = await postCreate({ name: 'p-plain', kind: 'local', localPath: plain });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(plain);
  });

  test('loosened gate three: pointing at a plain file -> 201 (a non-directory shape still passes, reachability belongs to the daemon)', async () => {
    const dir = tempDir('cairn-local-file-');
    const file = join(dir, 'not-a-repo.txt');
    writeFileSync(file, 'x');
    const r = await postCreate({ name: 'p-file', kind: 'local', localPath: file });
    expect(r.status).toBe(201);
    expect(r.body.localPath).toBe(file);
  });

  test('a relative path -> 400 + reason=not_absolute (judged after `~` expansion)', async () => {
    const r = await postCreate({ name: 'p-rel', kind: 'local', localPath: 'relative/dir' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('absolute');
    expect(r.body.reason).toBe<LocalErrorReason>('not_absolute');
  });

  test('state three: a git working-tree repo -> 201, the record/DB row localPath = the canonical absolute path', async () => {
    const repo = await makeGitRepo();
    const r = await postCreate({ name: 'p-ok', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(repo);
    const row = s.db
      .select()
      .from(project)
      .where(eq(project.id, String(r.body.id)))
      .get();
    expect(row?.repoKind).toBe('local');
    expect(row?.localPath).toBe(repo);
  });

  test('`~` expansion: localPath `~/<name>` expands by the server HOME into an absolute path', async () => {
    const repo = await makeGitRepo();
    const parent = dirname(repo);
    const prevHome = process.env.HOME;
    process.env.HOME = parent;
    try {
      const r = await postCreate({
        name: 'p-tilde',
        kind: 'local',
        localPath: `~/${basename(repo)}`,
      });
      expect(r.status).toBe(201);
      expect(r.body.localPath).toBe(join(parent, basename(repo)));
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});

describe('expandHomePath (the single source of `~` expansion; homeDir injected for tests)', () => {
  test('~/x -> <home>/x; a bare ~ -> <home>', () => {
    expect(expandHomePath('~/code/x', '/home/u')).toBe('/home/u/code/x');
    expect(expandHomePath('~', '/home/u')).toBe('/home/u');
  });

  test('absolute and relative paths pass through as is; the ~user form is not expanded', () => {
    expect(expandHomePath('/abs/x', '/home/u')).toBe('/abs/x');
    expect(expandHomePath('rel/x', '/home/u')).toBe('rel/x');
    expect(expandHomePath('~other/x', '/home/u')).toBe('~other/x');
  });
});

describe('the local project read surface -- the Files tab gate opens (#1030)', () => {
  const READ_GIT_ENV = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'local-read-probe',
    GIT_AUTHOR_EMAIL: 'probe@localhost',
    GIT_COMMITTER_NAME: 'local-read-probe',
    GIT_COMMITTER_EMAIL: 'probe@localhost',
  };

  async function makeLocalRepo(): Promise<string> {
    const dir = tempDir('cairn-local-read-');
    expect((await runGit(['init', '-b', 'trunk', dir], { env: READ_GIT_ENV })).code).toBe(0);
    writeFileSync(join(dir, 'README.md'), '# local-read-probe\n');
    for (const args of [
      ['add', '.'],
      ['commit', '-m', 'init local probe'],
    ] as string[][]) {
      expect((await runGit(args, { cwd: dir, env: READ_GIT_ENV })).code, args.join(' ')).toBe(0);
    }
    return dir;
  }

  async function createLocalProject(repo: string): Promise<string> {
    const r = await postCreate({ name: 'p-read-probe', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    return String(r.body.id);
  }

  test('F1 a reachable repo: all five read surfaces return real values; readable even with HEAD on a non-main branch', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);

    const tree = (await (await req(s.app, 'GET', `/api/projects/${id}/tree`)).json()) as {
      ref: string;
      commit: string;
      entries: { name: string; path: string; type: string; size: number }[];
    };
    expect(tree.ref).toBe('HEAD');
    expect(tree.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.entries).toContainEqual({
      name: 'README.md',
      path: 'README.md',
      type: 'blob',
      size: Buffer.byteLength('# local-read-probe\n'),
    });

    const file = (await (
      await req(s.app, 'GET', `/api/projects/${id}/file?path=README.md`)
    ).json()) as {
      encoding: string;
      content: string;
      size: number;
    };
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe('# local-read-probe\n');
    expect(file.size).toBe(Buffer.byteLength('# local-read-probe\n'));

    const branches = (await (await req(s.app, 'GET', `/api/projects/${id}/branches`)).json()) as {
      defaultBranch: string | null;
      branches: { name: string; isDefault: boolean }[];
    };
    expect(branches.defaultBranch).toBe('trunk');
    expect(branches.branches).toEqual([{ name: 'trunk', isDefault: true }]);

    const commits = (await (await req(s.app, 'GET', `/api/projects/${id}/commits`)).json()) as {
      ref: string;
      commits: { message: string; authorName: string }[];
    };
    expect(commits.ref).toBe('trunk');
    expect(commits.commits).toHaveLength(1);
    expect(commits.commits[0]?.message).toBe('init local probe');
    expect(commits.commits[0]?.authorName).toBe('local-read-probe');

    const files = (await (await req(s.app, 'GET', `/api/projects/${id}/files`)).json()) as {
      files: { path: string }[];
    };
    expect(files.files.map((f) => f.path)).toContain('README.md');
  });

  test('F2 the directory vanished -> 404 + reason=not_found (classified degradation; commits uses the same gate and shape)', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: LocalErrorReason };
    expect(body.reason).toBe<LocalErrorReason>('not_found');
    const commits = await req(s.app, 'GET', `/api/projects/${id}/commits`);
    expect(commits.status).toBe(404);
    expect(((await commits.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_found',
    );
  });

  test('F3 the directory replaced by non-git content -> 404 + reason=not_git', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_git',
    );
  });

  test('F4 repoKind=local with an empty localPath column -> an explicit 404 red (no reason)', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    s.db.update(project).set({ localPath: null }).where(eq(project.id, id)).run();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: string };
    expect(String(body.error)).toContain('local repo');
    expect(body.reason).toBeUndefined();
  });

  test('F6 commit detail: the root commit = all files added against the empty tree; a vanished directory = the same gate reason', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    const list = (await (await req(s.app, 'GET', `/api/projects/${id}/commits`)).json()) as {
      commits: { sha: string; message: string; authorName: string; at: number }[];
    };
    const root = list.commits[0]!;

    const res = await req(s.app, 'GET', `/api/projects/${id}/commits/${root.sha}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      sha: string;
      shortSha: string;
      message: string;
      authorName: string;
      at: number;
      files: {
        path: string;
        additions: number;
        deletions: number;
        hunks: { header: string; lines: string[] }[];
      }[];
    };
    expect(detail.sha).toBe(root.sha);
    expect(detail.message).toBe('init local probe');
    expect(detail.authorName).toBe('local-read-probe');
    expect(detail.at).toBe(root.at);
    expect(detail.sha.startsWith(detail.shortSha)).toBe(true);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.path).toBe('README.md');
    expect(detail.files[0]?.additions).toBe(1);
    expect(detail.files[0]?.deletions).toBe(0);
    expect(detail.files[0]?.hunks[0]?.lines).toContain('+# local-read-probe');

    rmSync(repo, { recursive: true, force: true });
    const gone = await req(s.app, 'GET', `/api/projects/${id}/commits/${root.sha}`);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_found',
    );
  });
});

describe('the local 400 reason vocabulary (#386: the single-source contract the web translates from)', () => {
  test('the vocabulary = not_found / not_git / not_absolute (the value domain pinned, the web translates by it)', () => {
    expect(PROJECT_LOCAL_ERROR_REASONS).toHaveLength(3);
    expect([...PROJECT_LOCAL_ERROR_REASONS].sort()).toEqual([
      'not_absolute',
      'not_found',
      'not_git',
    ]);
  });
});

describe('body dual-name compatibility: kind (the spec 12 contract) and repoKind (the existing wire), kind wins', () => {
  test('existing-surface regression: repoKind github + githubRepo string -> 201', async () => {
    const r = await postCreate({ name: 'p-old-gh', repoKind: 'github', githubRepo: 'octo/cat' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/cat');
  });

  test('new surface: kind github + githubRepo {owner,repo} object -> 201, the column normalized to owner/repo', async () => {
    const r = await postCreate({
      name: 'p-new-gh',
      kind: 'github',
      githubRepo: { owner: 'octo', repo: 'dog' },
    });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/dog');
  });

  test('kind and repoKind coexisting -> kind wins (no accidental hosted provisioning)', async () => {
    const repo = await makeGitRepo();
    const r = await postCreate({
      name: 'p-prio',
      kind: 'local',
      repoKind: 'hosted',
      localPath: repo,
    });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.repoName).toBeUndefined();
  });

  test('kind=github missing githubRepo -> 400 (owner/repo hint)', async () => {
    const r = await postCreate({ name: 'p-gh-none', kind: 'github' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('owner/repo');
  });

  test('kind=github githubRepo an invalid string -> 400', async () => {
    const r = await postCreate({ name: 'p-gh-bad', kind: 'github', githubRepo: 'has space/x' });
    expect(r.status).toBe(400);
  });

  test('kind=github githubRepo object with an empty segment -> 400 (normalized, then through the isGithubRepoRef gate)', async () => {
    const r = await postCreate({
      name: 'p-gh-empty',
      kind: 'github',
      githubRepo: { owner: 'a', repo: '' },
    });
    expect(r.status).toBe(400);
  });

  test('legacy hosted unbroken: kind=hosted -> 201 + the bare repo created (repoName in place)', async () => {
    const r = await postCreate({ name: 'p-hosted', kind: 'hosted' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('hosted');
    expect(typeof r.body.repoName).toBe('string');
    expect(String(r.body.cloneUrl)).toContain('/git/');
  });

  test('the no-repo default surface unbroken: name alone -> 201, the record has no repoKind/localPath', async () => {
    const r = await postCreate({ name: 'p-plain' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBeUndefined();
    expect(r.body.localPath).toBeUndefined();
  });

  test('the GET /api/projects projection carries localPath (record single source = shared projectRecordSchema)', async () => {
    const repo = await makeGitRepo();
    const created = await postCreate({ name: 'p-list', kind: 'local', localPath: repo });
    expect(created.status).toBe(201);
    const res = await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as CreateReply[];
    const hit = rows.find((r) => r.id === created.body.id);
    expect(hit?.localPath).toBe(repo);
    expect(hit?.repoKind).toBe('local');
  });
});

describe('the tree route passes the path parameter through (#1097)', () => {
  const GIT_ENV = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'tree-path-probe',
    GIT_AUTHOR_EMAIL: 'probe@localhost',
    GIT_COMMITTER_NAME: 'tree-path-probe',
    GIT_COMMITTER_EMAIL: 'probe@localhost',
  };

  interface TreeReply {
    ref: string;
    commit: string;
    path: string;
    entries: { name: string; path: string; type: string; size: number | null }[];
  }

  async function makeNestedRepo(): Promise<string> {
    const dir = tempDir('cairn-tree-path-');
    expect((await runGit(['init', '-b', 'trunk', dir], { env: GIT_ENV })).code).toBe(0);
    mkdirSync(join(dir, 'docs', 'guide'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# root readme\n');
    writeFileSync(join(dir, 'docs', 'README.md'), '# docs readme\n');
    writeFileSync(join(dir, 'docs', 'guide', 'deep.md'), 'deep content\n');
    for (const args of [
      ['add', '.'],
      ['commit', '-m', 'init nested probe'],
    ] as string[][]) {
      expect((await runGit(args, { cwd: dir, env: GIT_ENV })).code, args.join(' ')).toBe(0);
    }
    return dir;
  }

  async function makeNestedProject(): Promise<string> {
    const repo = await makeNestedRepo();
    const r = await postCreate({ name: 'p-tree-path', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    return String(r.body.id);
  }

  test('P1 tree?path=docs -> the docs single level + path echoed, no top-level entries mixed in', async () => {
    const id = await makeNestedProject();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree?path=docs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('docs');
    expect(body.entries).toContainEqual({
      name: 'README.md',
      path: 'docs/README.md',
      type: 'blob',
      size: Buffer.byteLength('# docs readme\n'),
    });
    expect(body.entries).toContainEqual({
      name: 'guide',
      path: 'docs/guide',
      type: 'tree',
      size: null,
    });
    expect(body.entries.map((e) => e.path)).not.toContain('README.md');
    expect(body.entries).toHaveLength(2);
  });

  test('P2 deep nesting: path=docs/guide returns its single level (3 levels drillable)', async () => {
    const id = await makeNestedProject();
    const res = await req(
      s.app,
      'GET',
      `/api/projects/${id}/tree?path=${encodeURIComponent('docs/guide')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('docs/guide');
    expect(body.entries).toEqual([
      {
        name: 'deep.md',
        path: 'docs/guide/deep.md',
        type: 'blob',
        size: Buffer.byteLength('deep content\n'),
      },
    ]);
  });

  test('P3 no path / empty path -> top level + path echoed as an empty string (zero regression)', async () => {
    const id = await makeNestedProject();
    for (const qs of ['', '?path=']) {
      const res = await req(s.app, 'GET', `/api/projects/${id}/tree${qs}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TreeReply;
      expect(body.path).toBe('');
      expect(body.entries).toContainEqual({
        name: 'README.md',
        path: 'README.md',
        type: 'blob',
        size: Buffer.byteLength('# root readme\n'),
      });
      expect(body.entries).toContainEqual({
        name: 'docs',
        path: 'docs',
        type: 'tree',
        size: null,
      });
    }
  });

  test('P4 same-named files across directories: file?path= returns each one own truth', async () => {
    const id = await makeNestedProject();
    const root = (await (
      await req(s.app, 'GET', `/api/projects/${id}/file?path=README.md`)
    ).json()) as { content: string };
    expect(root.content).toBe('# root readme\n');
    const nested = (await (
      await req(
        s.app,
        'GET',
        `/api/projects/${id}/file?path=${encodeURIComponent('docs/README.md')}`,
      )
    ).json()) as { content: string };
    expect(nested.content).toBe('# docs readme\n');
  });

  test('P5 path pointing at a nonexistent directory -> 200 + empty entries (the data source of the web empty-directory state)', async () => {
    const id = await makeNestedProject();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree?path=nope`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('nope');
    expect(body.entries).toEqual([]);
  });
});
