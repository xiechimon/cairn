import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

import { join } from 'node:path';
import { BRAND, conversationBranch, type ProjectRecord } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { runGit } from '../src/lib/git.js';
import { newUuidv7 } from '../src/lib/ids.js';
import { bootServer, insertGitApiKey, req, type TestServer } from './helpers.js';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'r3-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'r3-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
function workdir(prefix: string): string {
  const dir = makeTestTempDir(`cairn-git-${prefix}-`);
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let s: TestServer;
let baseUrl: string;
let closeServer: () => Promise<void>;
const API_KEY = 'cairn_e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0';

beforeAll(async () => {
  s = bootServer();
  insertGitApiKey(s, API_KEY);
  const server = serve({ fetch: s.app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
});

afterAll(async () => {
  await closeServer();
  s.dispose();
});

async function createProject(body: unknown): Promise<ProjectRecord> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectRecord;
}

function hostedUrl(record: ProjectRecord): string {
  return `${baseUrl}${new URL(record.cloneUrl as string).pathname}`;
}

function authedUrl(record: ProjectRecord): string {
  const url = new URL(hostedUrl(record));
  url.username = 'git';
  url.password = API_KEY;
  return url.toString();
}

async function git(args: string[], cwd: string) {
  return runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });
}

describe('hosted form: bare repo + git http-backend (02 section 3 locked)', () => {
  test('POST /api/projects repoKind:hosted -> bare repo landed + record carries repoName/cloneUrl', async () => {
    const record = await createProject({ name: 'r3-lifecycle', repoKind: 'hosted' });
    expect(record.repoKind).toBe('hosted');
    expect(record.repoName).toBe('r3-lifecycle');
    expect(new URL(record.cloneUrl as string).pathname).toBe(`/git/${s.team.id}/r3-lifecycle`);
    const dir = join(s.reposDir, s.team.id, 'r3-lifecycle.git');
    const head = await git(['symbolic-ref', '--short', 'HEAD'], dir);
    expect(head.stdout.toString().trim()).toBe('main');
  });

  test('credential discipline (r3 section 1.4: manual fetch without credentials fails): anonymous clone -> 401 -> git nonzero exit', async () => {
    const record = await createProject({ name: 'anon-probe', repoKind: 'hosted' });
    const dir = workdir('anon');
    const r = await git(['clone', hostedUrl(record), join(dir, 'repo')], dir);
    expect(r.code).not.toBe(0);
    const res = await fetch(`${hostedUrl(record)}/info/refs?service=git-upload-pack`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic realm=');
    const bad = new URL(hostedUrl(record));
    bad.username = 'git';
    bad.password = 'cairn_wrong';
    const r2 = await git(['clone', bad.toString(), join(dir, 'repo2')], dir);
    expect(r2.code).not.toBe(0);
  });

  test('clone/commit/push run green through (http-backend CGI full chain) -> branches/tree/file read back', async () => {
    const record = await createProject({ name: 'push-probe', repoKind: 'hosted' });
    const dir = workdir('push');
    const repoDir = join(dir, 'repo');
    const clone = await git(['clone', authedUrl(record), repoDir], dir);
    expect(clone.code, clone.stderr).toBe(0);
    const readme = '# push-probe\n\n托管形态实走。\n';
    writeFileSync(join(repoDir, 'README.md'), readme);
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README'], repoDir)).code).toBe(0);
    const push = await git(['push', '-u', 'origin', 'main'], repoDir);
    expect(push.code, push.stderr).toBe(0);

    const branches = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/branches`)
    ).json()) as { defaultBranch: string | null; branches: { name: string; isDefault: boolean }[] };
    expect(branches.defaultBranch).toBe('main');
    expect(branches.branches).toContainEqual({ name: 'main', isDefault: true });

    const tree = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/tree?ref=main`)
    ).json()) as {
      ref: string;
      commit: string;
      entries: { name: string; path: string; type: string; size: number | null }[];
    };
    expect(tree.ref).toBe('main');
    expect(tree.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.entries).toContainEqual({
      name: 'README.md',
      path: 'README.md',
      type: 'blob',
      size: Buffer.byteLength(readme),
    });

    const file = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/file?path=README.md&ref=main`)
    ).json()) as { encoding: string; content: string; size: number };
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe(readme);
    expect(file.size).toBe(Buffer.byteLength(readme));

    const headTree = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/tree`)
    ).json()) as { entries: unknown[] };
    expect(headTree.entries).toHaveLength(1);
  });

  test('GET /api/projects/{id}/files -> full recursion + directory entries + upper bound + round-trip (#760)', async () => {
    const record = await createProject({ name: 'files-probe', repoKind: 'hosted' });
    const dir = workdir('files');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# files-probe\n');
    mkdirSync(join(repoDir, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'apps', 'web', 'src', 'button.tsx'), 'export const B = 1;\n');
    writeFileSync(join(repoDir, 'apps', 'web', 'src', 'with space.ts'), 'export const S = 1;\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', '.'], repoDir)).code).toBe(0);
    const subSha = (await git(['hash-object', '-w', 'apps/web/src/button.tsx'], repoDir)).stdout
      .toString()
      .trim();
    expect(subSha).toMatch(/^[0-9a-f]{40}$/);
    expect(
      (await git(['update-index', '--add', '--cacheinfo', '160000', subSha, 'vendor/sub'], repoDir))
        .code,
    ).toBe(0);
    expect((await git(['commit', '-m', 'feat: files'], repoDir)).code).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const res = await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ref: string;
      commit: string;
      truncated: boolean;
      files: { path: string; type: string; size: number | null }[];
    };
    expect(body.ref).toBe('main');
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(body.truncated).toBe(false);
    const paths = body.files.map((f) => f.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('apps/web/src/button.tsx');
    expect(paths).toContain('apps/web/src/with space.ts');
    expect(paths).toContain('apps');
    expect(paths).toContain('apps/web/src');
    expect(body.files.find((f) => f.path === 'apps')?.type).toBe('tree');
    expect(paths).not.toContain('vendor/sub');
    expect(paths).toContain('vendor');

    const capped = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main&limit=2`)
    ).json()) as { truncated: boolean; files: unknown[] };
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    const fallback = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main&limit=abc`)
    ).json()) as { truncated: boolean; files: { path: string }[] };
    expect(fallback.truncated).toBe(false);
    expect(fallback.files.length).toBe(body.files.length);

    const file = (await (
      await req(
        s.app,
        'GET',
        `/api/projects/${record.id}/file?path=apps/web/src/button.tsx&ref=main`,
      )
    ).json()) as { content: string };
    expect(file.content).toBe('export const B = 1;\n');

    expect(
      (await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=no-such-ref`)).status,
    ).toBe(404);
  });

  test('GET /api/projects/{id}/commits -> commit history read back new to old', async () => {
    const record = await createProject({ name: 'commits-probe', repoKind: 'hosted' });
    const dir = workdir('commits');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# commits-probe\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README'], repoDir)).code).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const res = await req(s.app, 'GET', `/api/projects/${record.id}/commits`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ref: string;
      commits: { sha: string; shortSha: string; message: string; authorName: string; at: number }[];
    };
    expect(body.ref).toBe('main');
    expect(body.commits).toHaveLength(2);
    const head = body.commits[0]!;
    expect(head.message).toBe('docs: README');
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(head.shortSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(head.sha.startsWith(head.shortSha)).toBe(true);
    expect(head.authorName).toBe('r3-probe');
    expect(head.at).toBeGreaterThan(0);
    expect(Number.isFinite(head.at)).toBe(true);

    const github = await createProject({
      name: 'gh-probe',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    const ghRes = await req(s.app, 'GET', `/api/projects/${github.id}/commits`);
    expect(ghRes.status).toBe(404);
    expect((await req(s.app, 'GET', `/api/projects/${newUuidv7()}/commits`)).status).toBe(404);
  });

  test('GET /api/projects/{id}/commits/{sha} -> metadata + first-parent diff; boundary 404/defined state', async () => {
    const record = await createProject({ name: 'commit-detail-probe', repoKind: 'hosted' });
    const dir = workdir('commit-detail');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# detail-probe\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README detail'], repoDir)).code).toBe(0);
    expect((await git(['checkout', '-b', 'side'], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'side.txt'), 'side work\n');
    expect((await git(['add', 'side.txt'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'side: add side.txt'], repoDir)).code).toBe(0);
    expect((await git(['checkout', 'main'], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'another.txt'), 'main work\n');
    expect((await git(['add', 'another.txt'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'main: add another.txt'], repoDir)).code).toBe(0);
    expect(
      (await git(['merge', '--no-ff', 'side', '-m', 'merge side into main'], repoDir)).code,
    ).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const list = (await (await req(s.app, 'GET', `/api/projects/${record.id}/commits`)).json()) as {
      commits: { sha: string; shortSha: string; message: string; authorName: string; at: number }[];
    };
    expect(list.commits).toHaveLength(5);
    const byMessage = Object.fromEntries(list.commits.map((c) => [c.message, c]));
    const merge = byMessage['merge side into main']!;
    const readme = byMessage['docs: README detail']!;
    const seed = byMessage[`init ${record.repoName}`]!;

    type Detail = {
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

    const mergeRes = await req(s.app, 'GET', `/api/projects/${record.id}/commits/${merge.sha}`);
    expect(mergeRes.status).toBe(200);
    const mergeDetail = (await mergeRes.json()) as Detail;
    expect(mergeDetail.files.map((f) => f.path)).toEqual(['side.txt']);
    expect(mergeDetail.files[0]?.additions).toBe(1);
    expect(mergeDetail.sha).toBe(merge.sha);
    expect(mergeDetail.shortSha).toBe(merge.shortSha);
    expect(mergeDetail.message).toBe(merge.message);
    expect(mergeDetail.authorName).toBe(merge.authorName);
    expect(mergeDetail.at).toBe(merge.at);

    const readmeDetail = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/commits/${readme.sha}`)
    ).json()) as Detail;
    expect(readmeDetail.files).toHaveLength(1);
    expect(readmeDetail.files[0]?.path).toBe('README.md');
    expect(readmeDetail.files[0]?.hunks[0]?.lines).toContain('+# detail-probe');

    const seedRes = await req(s.app, 'GET', `/api/projects/${record.id}/commits/${seed.sha}`);
    expect(seedRes.status).toBe(200);
    expect(((await seedRes.json()) as Detail).files).toEqual([]);

    expect(
      (await req(s.app, 'GET', `/api/projects/${record.id}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
    expect(
      (
        await req(
          s.app,
          'GET',
          `/api/projects/${record.id}/commits/${encodeURIComponent('HEAD; echo hacked')}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          s.app,
          'GET',
          `/api/projects/${record.id}/commits/${encodeURIComponent('--output=/tmp/evil')}`,
        )
      ).status,
    ).toBe(404);

    const github = await createProject({
      name: 'gh-detail-probe',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(
      (await req(s.app, 'GET', `/api/projects/${github.id}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
    expect(
      (await req(s.app, 'GET', `/api/projects/${newUuidv7()}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
  });

  test('conv branch push (02 section 5.5: conv-<conversationId>) + binary file base64', async () => {
    const record = await createProject({ name: 'conv-probe', repoKind: 'hosted' });
    const dir = workdir('conv');
    const repoDir = join(dir, 'repo');
    await git(['clone', authedUrl(record), repoDir], dir);
    writeFileSync(join(repoDir, 'README.md'), '# conv-probe\n');
    await git(['checkout', '-B', 'main'], repoDir);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);
    await git(['push', '-u', 'origin', 'main'], repoDir);
    const convId = '01a0b85b-0000-7000-8000-000000000000';
    const branch = conversationBranch(convId);
    expect(branch).toBe(`${BRAND.branchPrefix}${convId}`);
    expect((await git(['checkout', '-b', branch], repoDir)).code).toBe(0);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    writeFileSync(join(repoDir, 'icon.png'), png);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'feat: icon'], repoDir);
    const push = await git(['push', '-u', 'origin', branch], repoDir);
    expect(push.code, push.stderr).toBe(0);
    const branches = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/branches`)
    ).json()) as { branches: { name: string }[] };
    expect(branches.branches.map((b) => b.name).sort()).toEqual(['main', branch].sort());
    const file = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/file?path=icon.png&ref=${branch}`)
    ).json()) as { encoding: string; content: string };
    expect(file.encoding).toBe('base64');
    expect(Buffer.from(file.content, 'base64').equals(png)).toBe(true);
  });

  test('same-name project repoName uniquified (-2 suffix [design]); unknown repo 404', async () => {
    const first = await createProject({ name: 'dupe probe', repoKind: 'hosted' });
    const second = await createProject({ name: 'dupe probe', repoKind: 'hosted' });
    expect(first.repoName).toBe('dupe-probe');
    expect(second.repoName).toBe('dupe-probe-2');
    const r = await fetch(
      `${baseUrl}/git/${s.team.id}/no-such-repo/info/refs?service=git-upload-pack`,
      {
        headers: { authorization: `Basic ${Buffer.from(`git:${API_KEY}`).toString('base64')}` },
      },
    );
    expect(r.status).toBe(404);
  });

  test('file-surface error shape: missing path 400 / unknown ref-or-file 404 / github project with no local repo 404', async () => {
    const record = await createProject({ name: 'err-probe', repoKind: 'hosted' });
    const missingPath = await req(s.app, 'GET', `/api/projects/${record.id}/file`);
    expect(missingPath.status).toBe(400);
    expect(Object.keys((await missingPath.json()) as Record<string, unknown>)).toEqual(['error']);
    const badRef = await req(s.app, 'GET', `/api/projects/${record.id}/tree?ref=no-such-ref`);
    expect(badRef.status).toBe(404);
    const traversal = await req(s.app, 'GET', `/api/projects/${record.id}/file?path=../server.db`);
    expect(traversal.status).toBe(400);
    const gh = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect((await req(s.app, 'GET', `/api/projects/${gh.id}/tree`)).status).toBe(404);
    expect((await req(s.app, 'GET', `/api/projects/${gh.id}/files`)).status).toBe(404);
    expect((await req(s.app, 'GET', `/api/projects/${newUuidv7()}/files`)).status).toBe(404);
  });
});

describe('GitHub integration form (02 section 3: record surface + executor contract run through)', () => {
  test('POST repoKind:github -> owner/repo record + cloneUrl derived; bad owner/repo 400', async () => {
    const record = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(record.repoKind).toBe('github');
    expect(record.githubRepo).toBe('octocat/hello');
    expect(record.cloneUrl).toBe('https://github.com/octocat/hello.git');
    const bad = await req(s.app, 'POST', '/api/projects', {
      name: 'bad',
      repoKind: 'github',
      githubRepo: 'no-slash',
    });
    expect(bad.status).toBe(400);
    const list = (await (await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)).json()) as
      | ProjectRecord[]
      | { error: string };
    expect(Array.isArray(list)).toBe(true);
    const found = (list as ProjectRecord[]).find((p) => p.id === record.id);
    expect(found).toMatchObject({ repoKind: 'github', githubRepo: 'octocat/hello' });
  });

  test('executor contract run through: clone the user own repo -> conv-* branch -> push (remote local bare stand-in)', async () => {
    const remoteDir = join(workdir('gh-remote'), 'hello.git');
    expect((await runGit(['init', '--bare', remoteDir], { env: GIT_ENV })).code).toBe(0);
    const record = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(record.cloneUrl).toContain('github.com');

    const dir = workdir('gh-walk');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', remoteDir, repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'CHANGELOG.md'), '# changelog\n');
    await git(['checkout', '-B', 'main'], repoDir);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'docs: changelog'], repoDir);
    await git(['push', '-u', 'origin', 'main'], repoDir);
    const branch = conversationBranch(newUuidv7());
    expect((await git(['checkout', '-b', branch], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'CHANGELOG.md'), '# changelog\n\n- conv 轮改动\n');
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'feat: conv round'], repoDir);
    const push = await git(['push', '-u', 'origin', branch], repoDir);
    expect(push.code, push.stderr).toBe(0);
    const lsRemote = await git(['ls-remote', '--heads', remoteDir], dir);
    const heads = lsRemote.stdout.toString();
    expect(heads).toContain('refs/heads/main');
    expect(heads).toContain(`refs/heads/${branch}`);
    expect(branch.startsWith(BRAND.branchPrefix)).toBe(true);
  });
});
