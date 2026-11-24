import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema, machineTokenResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  apiKey as apiKeyTable,
  build as buildTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, issueApiKey, seedSessionRoute, type TestServer } from './helpers.js';

const GH_TOKEN = 'ghp_connection_row_token_probe';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface WireWorld {
  s: TestServer;
  buildId: string;
  claimRaw(): Promise<Response>;
  claim(): Promise<ClaimedStep>;
  tokenRaw(stepId: string): Promise<Response>;
  tokenOf(
    stepId: string,
  ): Promise<{ raw: string; git: { username: string; password: string } | null }>;
}

async function setupWorld(
  projectBody: Record<string, unknown>,
  bootOpts: Parameters<typeof bootServer>[0] = {},
): Promise<WireWorld> {
  const s = bootServer({ claimHoldMs: 200, ...bootOpts });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name: 'g2t2-mbp', cliVersion: '0.1.0' }),
  });
  const machineToken = ((await enrollRes.json()) as { token: string }).token;
  seedSessionRoute(s, { provider: 'p', modelId: 'm' });

  let project: { id: string };
  if (projectBody.kind === 'github') {
    project = { id: `proj-${String(projectBody.name)}` };
    s.db
      .insert(projectTable)
      .values({
        id: project.id,
        name: String(projectBody.name),
        teamId: s.team.id,
        repoKind: 'github',
        githubRepo: String(projectBody.githubRepo),
      })
      .run();
  } else {
    const projRes = await call(s.app, 'POST', '/api/projects', { body: projectBody });
    expect(projRes.status).toBe(201);
    project = (await projRes.json()) as { id: string };
  }
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: 'G2-T2 探针', spec: '写一行探针' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const buildRes = await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
    body: { todoIds: [todoBody.id] },
  });
  expect(buildRes.status).toBe(201);
  const { builds } = (await buildRes.json()) as { builds: { id: string }[] };
  const buildId = builds[0]?.id;
  if (buildId === undefined) throw new Error('build creation returned no build');
  const claimRaw = () =>
    call(s.app, 'POST', '/api/machine/tasks/claim', { cred: machineToken, body: {} });
  async function tokenRaw(stepId: string): Promise<Response> {
    const generation = s.db
      .select({ claimedAt: stepTable.claimedAt })
      .from(stepTable)
      .where(eq(stepTable.id, stepId))
      .get()?.claimedAt;
    return call(s.app, 'GET', `/api/machine/token/${stepId}?generation=${generation}`, {
      cred: machineToken,
    });
  }
  return {
    s,
    buildId,
    claimRaw,
    tokenRaw,
    async claim() {
      const res = await claimRaw();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
    async tokenOf(stepId) {
      const res = await tokenRaw(stepId);
      expect(res.status).toBe(200);
      const raw = await res.text();
      const parsed = machineTokenResponseSchema.parse(JSON.parse(raw));
      return { raw, git: parsed.git };
    },
  };
}

async function seedUserRepo(): Promise<string> {
  const dir = join(makeTestTempDir('cairn-g2t2-user-'), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  return dir;
}

describe('G2-T2 claim/token execution-surface wiring (spec 12)', () => {
  test('failure mode 1: local project -> claim repo {kind:local, cloneUrl=localPath}; token git null', async () => {
    const userRepo = await seedUserRepo();
    const w = await setupWorld({ name: 'g2t2-local', kind: 'local', localPath: userRepo });
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({
      kind: 'local',
      cloneUrl: realpathSync(userRepo),
    });
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toBeNull();
  });

  test('failure mode 2: github project + connection row without an App socket -> 503; the OAuth token never reaches the runner', async () => {
    const w = await setupWorld(
      { name: 'g2t2-gh', kind: 'github', githubRepo: 'octo/alpha' },
      {
        githubFetch: async () => Response.json({ id: 4242, full_name: 'octo/alpha' }),
      },
    );
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/alpha.git',
    });
    const res = await w.tokenRaw(claimed.step.id);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(GH_TOKEN);
    const gitKeys = w.s.db.select().from(apiKeyTable).where(eq(apiKeyTable.gitAccess, true)).all();
    expect(gitKeys).toHaveLength(0);
  });

  test('failure mode 3: github project with no connection row and no App socket -> 503', async () => {
    const w = await setupWorld({ name: 'g2t2-gh-anon', kind: 'github', githubRepo: 'octo/beta' });
    const res = await w.claimRaw();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: 'app-token-unconfigured' });
    const failed = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).get();
    expect(failed).toMatchObject({ status: 'failed', machineId: null, claimedRepoId: null });
    const build = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get();
    expect(build?.errorMessage).toContain('GitHub repository lookup has no read credential');
    const next = await w.claimRaw();
    expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ step: null });
  });

  test('failure mode 4: the connection token never appears on the runner wire (no leak on any slot)', async () => {
    const w = await setupWorld(
      { name: 'g2t2-gh-leak', kind: 'github', githubRepo: 'octo/gamma' },
      {
        githubFetch: async () => Response.json({ id: 4242, full_name: 'octo/gamma' }),
      },
    );
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    const res = await w.tokenRaw(claimed.step.id);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(GH_TOKEN);
    expect(JSON.stringify(claimed)).not.toContain(GH_TOKEN);
  });

  test('github project with an expired access token -> the runner path fails closed without touching the OAuth refresh', async () => {
    const refreshBodies: string[] = [];
    const w = await setupWorld(
      { name: 'g2t2-gh-expired', kind: 'github', githubRepo: 'octo/delta' },
      {
        oauthClient: { clientId: 'cid', clientSecret: 'cs' },
        githubFetch: async (input, init) => {
          if (String(input).endsWith('/repos/octo/delta'))
            return Response.json({ id: 4242, full_name: 'octo/delta' });
          if (init?.body !== undefined) refreshBodies.push(String(init.body));
          const payload = {
            access_token: 'ghu_refreshed_for_machine',
            refresh_token: 'ghr_next',
            expires_in: 28_800,
          };
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => payload,
            text: async () => JSON.stringify(payload),
          };
        },
      },
    );
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.s.team.id,
        login: 'octo',
        accessToken: GH_TOKEN,
        scope: 'repo',
        refreshToken: 'ghr_first',
        accessTokenExpiresAt: Date.now() - 1000,
      },
    );
    const claimed = await w.claim();
    const refreshesAtClaim = refreshBodies.length;
    const res = await w.tokenRaw(claimed.step.id);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain(GH_TOKEN);
    expect(body).not.toContain('ghu_refreshed_for_machine');
    expect(refreshBodies).toHaveLength(refreshesAtClaim);
  });
});
