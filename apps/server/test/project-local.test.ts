import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  DEFAULT_AUTONOMY_SETTINGS,
  type LocalErrorReason,
  PROJECT_LOCAL_ERROR_REASONS,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { project } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { expandHomePath, readFile } from '../src/services/git.js';
import { bootServer, req } from './helpers.js';

const s = bootServer();
const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
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
  mergePolicy?: string;
  localChecks?: string[];
  cloneUrl?: string;
  error?: string;
  reason?: string;
}

async function postCreate(body: unknown): Promise<{ status: number; body: CreateReply }> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  return { status: res.status, body: (await res.json()) as CreateReply };
}

describe('POST /api/projects kind=local -- the localPath three-state validation (#359 AC)', () => {
  test('a local project defaults to mergePolicy autonomous and accepts configurable local check commands', async () => {
    const repo = await makeGitRepo();
    const created = await postCreate({ name: 'p-merge-policy', kind: 'local', localPath: repo });
    expect(created.status).toBe(201);
    expect(created.body.mergePolicy).toBe('autonomous');

    const configured = await req(s.app, 'PATCH', `/api/projects/${created.body.id}/merge-policy`, {
      mergePolicy: 'autonomous',
      localChecks: ['pnpm test'],
    });
    expect(configured.status).toBe(200);
    expect(await configured.json()).toMatchObject({
      mergePolicy: 'autonomous',
      localChecks: ['pnpm test'],
    });
  });

  test('legacy projects without a stored policy use autonomous while explicit policies survive', async () => {
    const created = await postCreate({ name: 'legacy-policy' });
    const id = String(created.body.id);
    for (const autonomy of [null, { ...DEFAULT_AUTONOMY_SETTINGS }]) {
      s.db.update(project).set({ autonomy }).where(eq(project.id, id)).run();
      const rows = (await (
        await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
      ).json()) as CreateReply[];
      expect(rows.find((row) => row.id === id)?.mergePolicy).toBe('autonomous');
    }
    for (const mergePolicy of ['human', 'shadow'] as const) {
      const configured = await req(s.app, 'PATCH', `/api/projects/${id}/merge-policy`, {
        mergePolicy,
      });
      expect(configured.status).toBe(200);
      const rows = (await (
        await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
      ).json()) as CreateReply[];
      expect(rows.find((row) => row.id === id)?.mergePolicy).toBe(mergePolicy);
    }
  });

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

describe('retained local file mentions, branches and Coordinator document reads', () => {
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

  test('a reachable non-main repository retains mentions, branches and document reads', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);

    const file = await readFile(s, id, 'README.md');
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe('# local-read-probe\n');
    expect(file.size).toBe(Buffer.byteLength('# local-read-probe\n'));

    const branches = (await (await req(s.app, 'GET', `/api/projects/${id}/branches`)).json()) as {
      defaultBranch: string | null;
      branches: { name: string; isDefault: boolean }[];
    };
    expect(branches.defaultBranch).toBe('trunk');
    expect(branches.branches).toEqual([{ name: 'trunk', isDefault: true }]);

    const files = (await (await req(s.app, 'GET', `/api/projects/${id}/files`)).json()) as {
      files: { path: string }[];
    };
    expect(files.files.map((f) => f.path)).toContain('README.md');
  });

  test('a vanished repository returns 404 with reason not_found for file mentions', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/files`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: LocalErrorReason };
    expect(body.reason).toBe<LocalErrorReason>('not_found');
  });

  test('F3 the directory replaced by non-git content -> 404 + reason=not_git', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/files`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_git',
    );
  });

  test('F4 repoKind=local with an empty localPath column -> an explicit 404 red (no reason)', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    s.db.update(project).set({ localPath: null }).where(eq(project.id, id)).run();
    const res = await req(s.app, 'GET', `/api/projects/${id}/files`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: string };
    expect(String(body.error)).toContain('local repo');
    expect(body.reason).toBeUndefined();
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
