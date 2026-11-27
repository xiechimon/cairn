import { CORE_COORDINATOR_TOOLS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { project } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { readBranches } from '../src/services/git.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { executeGithubReadTool } from '../src/services/github-reads.js';
import { ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { githubAuthFake } from './fakes/github-auth.js';

registerChiefHarness();

const API = 'https://api.github.com';
const COMMIT = 'a'.repeat(40);
const INSTALL_URL = 'https://github.com/apps/cairnwright/installations/new';
const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function bindPrivateOfferProject() {
  H.s.db
    .update(project)
    .set({
      name: 'offer',
      repoKind: 'github',
      githubRepo: 'xiechimon/offer',
      localPath: null,
      baseBranch: null,
    })
    .where(eq(project.id, H.projectId))
    .run();
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function privateOfferFetch(requiredToken: string): {
  calls: { url: string; auth: string | undefined }[];
  impl: FetchLike;
} {
  const calls: { url: string; auth: string | undefined }[] = [];
  const readme = '# Offer\nPrivate job-offer negotiation assistant.\n';
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    const auth = init?.headers?.authorization;
    calls.push({ url, auth });
    if (auth !== `Bearer ${requiredToken}`) {
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (url === `${API}/repos/xiechimon/offer`) {
      return jsonResponse({ full_name: 'xiechimon/offer', default_branch: 'main' });
    }
    if (url === `${API}/repos/xiechimon/offer/commits?per_page=1`) {
      return jsonResponse([{ sha: COMMIT }]);
    }
    if (url === `${API}/repos/xiechimon/offer/git/trees/${COMMIT}?recursive=1`) {
      return jsonResponse({
        tree: [
          { path: 'README.md', type: 'blob', size: readme.length },
          { path: 'src', type: 'tree' },
          { path: 'src/index.ts', type: 'blob', size: 32 },
        ],
      });
    }
    if (url === `${API}/repos/xiechimon/offer/contents/README.md?ref=${COMMIT}`) {
      return jsonResponse({
        type: 'file',
        size: Buffer.byteLength(readme),
        encoding: 'base64',
        content: Buffer.from(readme).toString('base64'),
        sha: 'b'.repeat(40),
      });
    }
    return jsonResponse({ message: 'Not Found' }, 404);
  };
  return { calls, impl };
}

describe('Coordinator and server GitHub reads through the Cairn GitHub connection', () => {
  test('private bound repo with no host gh and Cairn GitHub connection present succeeds for Coordinator tree and README reads', async () => {
    const emptyBin = makeTestTempDir('no-host-gh-');
    dirs.push(emptyBin);
    vi.stubEnv('PATH', emptyBin);
    bindPrivateOfferProject();

    const token = 'ghu_offer_private_token_12345';
    upsertGithubConnection(
      { db: H.s.db, box: H.s.secretBox },
      {
        teamId: H.teamId,
        login: 'xiechimon',
        accessToken: token,
        scope: '',
        device: {
          clientId: 'Iv23liW8YZ2D9i6DYMgp',
          refreshTokenExpiresAt: Date.now() + 86_400_000,
        },
      },
    );

    expect(CORE_COORDINATOR_TOOLS.has('docs')).toBe(true);

    const api = privateOfferFetch(token);
    const deps = { ...toolDeps(), githubFetch: api.impl };

    const treeRaw = await executeChiefTool(deps, ctx(), 'docs', { projectId: H.projectId });
    expect(treeRaw).not.toContain(token);
    const tree = JSON.parse(treeRaw) as {
      projectId: string;
      githubRepo?: string;
      commit: string;
      entries: { path: string; type: string }[];
    };
    expect(tree.projectId).toBe(H.projectId);
    expect(tree.githubRepo).toBe('xiechimon/offer');
    expect(tree.commit).toBe(COMMIT);
    expect(tree.entries.map((e) => e.path)).toEqual(['README.md', 'src', 'src/index.ts']);

    const filtered = JSON.parse(
      await executeChiefTool(deps, ctx(), 'docs', { projectId: H.projectId, prefix: 'src/' }),
    ) as { entries: { path: string }[] };
    expect(filtered.entries.map((e) => e.path)).toEqual(['src/index.ts']);

    const readmeRaw = await executeChiefTool(deps, ctx(), 'docs', {
      projectId: H.projectId,
      paths: ['README.md'],
    });
    expect(readmeRaw).not.toContain(token);
    const readme = JSON.parse(readmeRaw) as {
      files: { path: string; content?: string; error?: string }[];
    };
    expect(readme.files[0]?.content).toContain('Private job-offer negotiation assistant.');
    expect(api.calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
  });

  test('when the Cairn GitHub App connection lacks access to the bound repo, errors name the GitHub App installation', async () => {
    bindPrivateOfferProject();
    const token = 'ghu_ungranted_repo_token';
    upsertGithubConnection(
      { db: H.s.db, box: H.s.secretBox },
      {
        teamId: H.teamId,
        login: 'xiechimon',
        accessToken: token,
        scope: '',
        device: {
          clientId: 'Iv23liW8YZ2D9i6DYMgp',
          refreshTokenExpiresAt: Date.now() + 86_400_000,
        },
      },
    );

    const deniedFetch: FetchLike = async () => jsonResponse({ message: 'Not Found' }, 404);
    const deps = { ...toolDeps(), githubFetch: deniedFetch };

    await expect(executeChiefTool(deps, ctx(), 'docs', { projectId: H.projectId })).rejects.toThrow(
      INSTALL_URL,
    );

    const fileResult = JSON.parse(
      await executeChiefTool(deps, ctx(), 'docs', { projectId: H.projectId, paths: ['README.md'] }),
    ) as { files: { error?: string }[] };
    expect(fileResult.files[0]?.error).toContain(INSTALL_URL);
    expect(fileResult.files[0]?.error).toContain('Only repositories granted to Cairn');
    expect(fileResult.files[0]?.error).not.toContain(token);

    await expect(
      executeGithubReadTool(deps, H.teamId, 'issues', { projectId: H.projectId }),
    ).rejects.toThrow(INSTALL_URL);

    await expect(
      readBranches(
        {
          db: H.s.db,
          reposDir: H.s.reposDir,
          box: H.s.secretBox,
          githubFetch: deniedFetch,
          discloseLocalPath: false,
        },
        H.projectId,
      ),
    ).rejects.toThrow(INSTALL_URL);
  });

  test('docs refreshes an expired OAuth Cairn GitHub connection using oauthClient', async () => {
    bindPrivateOfferProject();
    const gh = githubAuthFake({
      user: { id: 1, login: 'xiechimon', name: null },
      repos: [],
    });
    const stale = 'gho_stale_oauth_token';
    gh.knowGrant(stale, 'ghr_valid_refresh');
    upsertGithubConnection(
      { db: H.s.db, box: H.s.secretBox },
      {
        teamId: H.teamId,
        login: 'xiechimon',
        accessToken: stale,
        refreshToken: 'ghr_valid_refresh',
        accessTokenExpiresAt: Date.now() - 1_000,
        scope: 'repo',
      },
    );
    const client = { clientId: 'cid-docs', clientSecret: 'cs-docs' };
    const seenAuth: (string | undefined)[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/login/oauth/access_token')) return gh.fetch(input, init);
      seenAuth.push(init?.headers?.authorization);
      const rotated = [...gh.grants.keys()].at(-1);
      if (init?.headers?.authorization !== `Bearer ${rotated}`) {
        return jsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.endsWith('/commits?per_page=1')) return jsonResponse([{ sha: COMMIT }]);
      if (url.includes('/contents/README.md')) {
        return jsonResponse({
          type: 'file',
          size: 8,
          encoding: 'base64',
          content: Buffer.from('# Offer\n').toString('base64'),
          sha: 'c'.repeat(40),
        });
      }
      return jsonResponse({ message: 'Not Found' }, 404);
    };

    const result = JSON.parse(
      await executeChiefTool(
        { ...toolDeps(), githubFetch: fetchImpl, oauthClient: client },
        ctx(),
        'docs',
        { projectId: H.projectId, paths: ['README.md'] },
      ),
    ) as { files: { content?: string }[] };
    expect(result.files[0]?.content).toBe('# Offer\n');
    expect(seenAuth.every((header) => header !== `Bearer ${stale}`)).toBe(true);
  });
});
