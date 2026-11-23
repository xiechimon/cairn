import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { createCoordinatorServerApi } from '../src/coordinator/server-api.js';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, seedRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const AGENT_ID = 'agent-relay-claimed';

async function enroll(s: TestServer, name: string) {
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await issueApiKey(s)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name, cliVersion: '99.0.0' })),
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const id = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get()!.id;
  return { id, token };
}

async function setup(opts: Parameters<typeof bootServer>[0] = {}) {
  const s = bootServer({ ...opts, claimHoldMs: 10 });
  disposables.push(() => s.dispose());
  const owner = await enroll(s, 'relay-owner');
  const other = await enroll(s, 'relay-other');
  seedRoute(s, 'coordinator', {
    id: AGENT_ID,
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: owner.id,
  });
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      createdAt: 1,
    })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: 'chief-relay-thread',
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'relay',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
      archivedAt: 1,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 'step-relay',
      buildId: 'chief-relay-thread',
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: 'status?',
      createdAt: 2,
    })
    .run();
  const claimed = await claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    owner.id,
    s.team.id,
    10,
    'http://localhost',
  );
  expect(claimed?.step.id).toBe('step-relay');
  return { s, owner, other };
}

function relay(s: TestServer, token: string, name = 'projects', params = {}) {
  return s.app.request('/api/machine/tool/step-relay', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, params }),
  });
}

function setStep(s: TestServer, values: Partial<typeof stepTable.$inferInsert>) {
  s.db.update(stepTable).set(values).where(eq(stepTable.id, 'step-relay')).run();
}

describe('Coordinator tool relay runs only for the machine holding a claimed turn', () => {
  test('the claiming machine can call a Coordinator tool', async () => {
    const { s, owner } = await setup();
    expect((await relay(s, owner.token)).status).toBe(200);
  });

  test('connect_repo refreshes a legacy OAuth grant through both Coordinator relays', async () => {
    const oauthClient = { clientId: 'test-oauth-client', clientSecret: 'test-oauth-secret' };
    const githubFetch: FetchLike = async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/login/oauth/access_token' && init?.method === 'POST') {
        const form = new URLSearchParams(String(init.body));
        if (
          form.get('client_id') === oauthClient.clientId &&
          form.get('client_secret') === oauthClient.clientSecret &&
          form.get('grant_type') === 'refresh_token' &&
          form.get('refresh_token') === 'test-legacy-refresh'
        ) {
          return Response.json({ access_token: 'test-fresh-access', expires_in: 3600 });
        }
      }
      if (
        path === '/repos/octo/demo' &&
        new Headers(init?.headers).get('authorization') === 'Bearer test-fresh-access'
      ) {
        return Response.json({ full_name: 'octo/demo' });
      }
      return new Response(null, { status: 401 });
    };
    const githubDeps = { githubFetch, githubBaseFetch: githubFetch, oauthClient };
    const { s, owner } = await setup(githubDeps);
    const seedLegacyGrant = () =>
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'test-expired-access',
          refreshToken: 'test-legacy-refresh',
          accessTokenExpiresAt: 1,
          scope: 'repo',
        },
      );
    for (const projectId of ['runner-project', 'server-project']) {
      s.db.insert(projectTable).values({ id: projectId, name: projectId, teamId: s.team.id }).run();
    }

    seedLegacyGrant();
    const response = await relay(s, owner.token, 'connect_repo', {
      projectId: 'runner-project',
      githubRepo: 'octo/demo',
    });
    expect(response.status, 'Runner HTTP relay').toBe(200);

    seedLegacyGrant();
    setStep(s, { machineId: null });
    const api = createCoordinatorServerApi({
      ...s.svc,
      ...githubDeps,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    });
    await api.relayTool('step-relay', 'connect_repo', {
      projectId: 'server-project',
      githubRepo: 'octo/demo',
    });
    const bindings = s.db
      .select({ id: projectTable.id, repo: projectTable.githubRepo })
      .from(projectTable)
      .all();
    expect(bindings).toEqual(
      expect.arrayContaining([
        { id: 'runner-project', repo: 'octo/demo' },
        { id: 'server-project', repo: 'octo/demo' },
      ]),
    );
  });

  test('connect_repo does not bind a repository after the turn claim is released during the probe', async () => {
    const githubFetch = vi.fn<FetchLike>();
    const { s, owner } = await setup({ githubFetch });
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'test-access', scope: 'repo' },
    );
    const projectId = 'released-turn-project';
    s.db.insert(projectTable).values({ id: projectId, name: projectId, teamId: s.team.id }).run();
    githubFetch.mockImplementation(async () => {
      setStep(s, { status: 'pending', machineId: null });
      return Response.json({ full_name: 'octo/demo' });
    });

    const response = await relay(s, owner.token, 'connect_repo', {
      projectId,
      githubRepo: 'octo/demo',
    });

    expect(githubFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(
      s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get(),
    ).toMatchObject({
      repoKind: null,
      githubRepo: null,
    });
  });

  test('a finished turn no longer runs Coordinator tools', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'done', finishedAt: 3 });
    expect((await relay(s, owner.token)).status).toBe(409);
  });

  test('a failed turn no longer runs Coordinator tools', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'failed', finishedAt: 3 });
    expect((await relay(s, owner.token)).status).toBe(409);
  });

  test('a released turn cannot be used by the machine that held it', async () => {
    const { s, owner } = await setup();
    setStep(s, { status: 'pending', machineId: null });
    expect((await relay(s, owner.token)).status).toBe(404);
  });

  test('another machine cannot use a turn it does not hold', async () => {
    const { s, other } = await setup();
    expect((await relay(s, other.token)).status).toBe(404);
  });
});
