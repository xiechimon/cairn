import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  GITHUB_ACCESS_TOKEN_USERNAME,
  machineTokenResponseSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, apiKey as apiKeyTable } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-g2t2-1';
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
  machineToken: string;
  claim(): Promise<ClaimedStep>;
  tokenOf(
    stepId: string,
  ): Promise<{ raw: string; git: { username: string; password: string } | null }>;
}

async function setupWorld(projectBody: Record<string, unknown>): Promise<WireWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'g2t2-mbp', cliVersion: '0.1.0' },
  });
  const machineToken = ((await enrollRes.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'g2t2-builder', modelId: 'm' })
    .run();
  bindAllAgents(s);

  const projRes = await call(s.app, 'POST', '/api/projects', { body: projectBody });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: 'G2-T2 探针', spec: '写一行探针' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const buildRes = await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
    body: {
      todoIds: [todoBody.id],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  expect(buildRes.status).toBe(201);
  return {
    s,
    machineToken,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineToken,
        body: {},
      });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
    async tokenOf(stepId) {
      const res = await call(s.app, 'GET', `/api/machine/token/${stepId}`, { cred: machineToken });
      expect(res.status).toBe(200);
      const raw = await res.text();
      const parsed = machineTokenResponseSchema.parse(JSON.parse(raw));
      return { raw, git: parsed.git };
    },
  };
}

async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'cairn-g2t2-user-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  return dir;
}

describe('G2-T2 claim/token execution-surface wiring (spec 12)', () => {
  test('failure mode 1: local project -> claim repo {kind:local, cloneUrl=localPath}; token git null', async () => {
    const userRepo = await seedUserRepo();
    const w = await setupWorld({ name: 'g2t2-local', kind: 'local', localPath: userRepo });
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({ kind: 'local', cloneUrl: userRepo });
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toBeNull();
  });

  test('failure mode 2: github project + connection row -> token git {x-access-token, token}; no gitAccess key sent', async () => {
    const w = await setupWorld({ name: 'g2t2-gh', kind: 'github', githubRepo: 'octo/alpha' });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/alpha.git',
    });
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toEqual({ username: GITHUB_ACCESS_TOKEN_USERNAME, password: GH_TOKEN });
    const gitKeys = w.s.db.select().from(apiKeyTable).where(eq(apiKeyTable.gitAccess, true)).all();
    expect(gitKeys).toHaveLength(0);
  });

  test('failure mode 3: github project with no connection row -> token git null', async () => {
    const w = await setupWorld({ name: 'g2t2-gh-anon', kind: 'github', githubRepo: 'octo/beta' });
    const claimed = await w.claim();
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toBeNull();
  });

  test('failure mode 4: token plaintext appears only in the git.password slot (no leak on other wire slots)', async () => {
    const w = await setupWorld({ name: 'g2t2-gh-leak', kind: 'github', githubRepo: 'octo/gamma' });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    const { raw } = await w.tokenOf(claimed.step.id);
    expect(raw.split(GH_TOKEN)).toHaveLength(2);
    expect(JSON.stringify(claimed)).not.toContain(GH_TOKEN);
  });
});
