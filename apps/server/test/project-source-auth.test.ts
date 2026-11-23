import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, parse } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { project as projectTable } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import {
  markGithubConnectionDisconnected,
  upsertGithubConnection,
} from '../src/services/github-connection.js';
import { bootServer, redeemTestPairing, req, type TestServer } from './helpers.js';

const OWNER = 'project-source-owner-token-0123456789abcdef';

function makeRoot(): string {
  return makeTestTempDir('cairn-proj-src-');
}

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, opts.headers);
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function pairDevice(s: TestServer): Promise<{ token: string; cookie: string | null }> {
  const issued = await call(s.app, 'POST', '/api/remote/pairing', { cred: OWNER });
  expect(issued.status).toBe(201);
  const { code } = (await issued.json()) as { code: string };
  const paired = await redeemTestPairing(s.app, code, 'phone');
  expect(paired.status).toBe(201);
  const { token } = (await paired.json()) as { token: string };
  return { token, cookie: paired.headers.get('set-cookie') };
}

interface GithubCall {
  url: string;
  authorization: string | null;
}

function githubFetchFor(reachable: string[], calls?: GithubCall[]) {
  return async (
    input: string | URL,
    init?: { headers?: Record<string, string> },
  ): Promise<Response> => {
    const url = String(input);
    if (calls !== undefined) {
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    }
    const hit = reachable.find((ref) => url.includes(`/repos/${ref}`));
    if (hit !== undefined) {
      return new Response(JSON.stringify({ full_name: hit }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
}

async function fakeAppTokenSocket(): Promise<{
  socketPath: string;
  close: () => Promise<void>;
}> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        token: 'ghs_fake_app_installation',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        installationId: 7,
        appSlug: 'cairn-test-app',
      }),
    );
  });
  const socketPath = join(makeTestTempDir('cairn-app-sock-'), 'app-token.sock');
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('project repository source authorization', () => {
  test('P-SEC1: a paired device credential cannot bind a project to a local path (403); the owner token can', async () => {
    const localDir = makeRoot();
    const s = bootServer({ authToken: OWNER });
    try {
      const { token, cookie } = await pairDevice(s);
      const deviceCreate = await call(s.app, 'POST', '/api/projects', {
        cred: token,
        body: { name: 'device-local', kind: 'local', localPath: localDir },
      });
      expect(deviceCreate.status).toBe(403);
      if (cookie !== null) {
        const sessionCreate = await call(s.app, 'POST', '/api/projects', {
          body: { name: 'device-local', kind: 'local', localPath: localDir },
          headers: { cookie, 'sec-fetch-site': 'same-origin' },
        });
        expect(sessionCreate.status).toBe(403);
      }
      const ownerCreate = await call(s.app, 'POST', '/api/projects', {
        cred: OWNER,
        body: { name: 'device-local', kind: 'local', localPath: localDir },
      });
      expect(ownerCreate.status).toBe(201);
    } finally {
      s.dispose();
    }
  });

  test('a broken workspace root does not block non-local projects or GitHub skill sources', async () => {
    const s = bootServer({
      resolveWorkspacesDir: () => {
        throw new Error('invalid workspace root');
      },
      githubFetch: githubFetchFor(['octo/demo']),
      skillImportFetch: async (input) => {
        switch (new URL(input).pathname) {
          case '/repos/octo/demo':
            return Response.json({ default_branch: 'main' });
          case '/repos/octo/demo/git/trees/main':
            return Response.json({ tree: [{ path: 'SKILL.md', type: 'blob', size: 60 }] });
          case '/repos/octo/demo/contents/SKILL.md':
            return new Response('---\nname: demo\ndescription: Workspace isolation\n---\n');
          default:
            return new Response(null, { status: 404 });
        }
      },
    });
    try {
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        { teamId: s.team.id, login: 'octo', accessToken: 'test-repo-access', scope: 'repo' },
      );
      for (const body of [
        { name: 'plain' },
        { name: 'hosted', kind: 'hosted' },
        { name: 'github', kind: 'github', githubRepo: 'octo/demo' },
      ]) {
        const created = await req(s.app, 'POST', '/api/projects', body);
        expect.soft(created.status, `${body.name} project`).toBe(201);
      }
      const skills = `/api/teams/${s.team.id}/skills`;
      const imported = await req(s.app, 'POST', `${skills}/import`, {
        url: 'https://github.com/octo/demo',
      });
      expect.soft(imported.status, 'GitHub skill import').toBe(201);
      const refreshed = await req(s.app, 'POST', `${skills}/demo/refresh`, {});
      expect(refreshed.status, 'GitHub skill refresh').toBe(200);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC2: a localPath resolving inside the cairn home directory — directly or through a symlink — gets 400', async () => {
    const home = makeRoot();
    const inside = join(home, 'server', 'repos');
    mkdirSync(inside, { recursive: true });
    const linkParent = makeRoot();
    symlinkSync(inside, join(linkParent, 'alias'));
    const s = bootServer({ homeDir: home, skillsDir: join(home, 'skills') });
    try {
      for (const localPath of [inside, join(linkParent, 'alias')]) {
        const res = await req(s.app, 'POST', '/api/projects', {
          name: 'p',
          kind: 'local',
          localPath,
        });
        expect(res.status, localPath).toBe(400);
      }
      const outside = await req(s.app, 'POST', '/api/projects', {
        name: 'p',
        kind: 'local',
        localPath: makeRoot(),
      });
      expect(outside.status).toBe(201);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC3: a github locator must be reachable through the team github connection — at create and at rebind', async () => {
    const s = bootServer({ githubFetch: githubFetchFor(['octo/demo', 'acme/ok']) });
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'ghp_source_auth', scope: 'repo' },
    );
    try {
      const denied = await req(s.app, 'POST', '/api/projects', {
        name: 'gh-missing',
        kind: 'github',
        githubRepo: 'ghost/missing',
      });
      expect(denied.status).toBe(400);
      const created = await req(s.app, 'POST', '/api/projects', {
        name: 'gh',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const retargetBlocked = await req(s.app, 'PATCH', `/api/projects/${id}`, {
        githubRepo: 'ghost/missing',
      });
      expect(retargetBlocked.status).toBe(400);
      const retargetOk = await req(s.app, 'PATCH', `/api/projects/${id}`, {
        githubRepo: 'acme/ok',
      });
      expect(retargetOk.status).toBe(200);
    } finally {
      s.dispose();
    }
  });

  test.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'P-SEC6: a case-variant spelling of a path inside cairn dirs is refused the same (case-insensitive canonical compare)',
    async () => {
      const home = makeRoot();
      const inside = join(home, 'SubDir');
      mkdirSync(inside, { recursive: true });
      const s = bootServer({ homeDir: home });
      try {
        const res = await req(s.app, 'POST', '/api/projects', {
          name: 'p-case',
          kind: 'local',
          localPath: inside.toUpperCase(),
        });
        expect(res.status).toBe(400);
      } finally {
        s.dispose();
      }
    },
  );

  test('P-SEC7: binding the filesystem root itself is refused — the ancestor check must reach the volume root', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'POST', '/api/projects', {
        name: 'p-root',
        kind: 'local',
        localPath: parse(s.homeDir).root,
      });
      expect(res.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC8: configured cairn directories outside the home — a workspaces or data override — are refused as sources too', async () => {
    const workspaces = makeRoot();
    const data = makeRoot();
    const s = bootServer({
      homeDir: makeRoot(),
      workspacesDir: workspaces,
      dataDir: data,
    });
    try {
      for (const localPath of [join(workspaces, 'task-1'), join(data, 'repos')]) {
        const res = await req(s.app, 'POST', '/api/projects', {
          name: 'p-override',
          kind: 'local',
          localPath,
        });
        expect(res.status, localPath).toBe(400);
      }
    } finally {
      s.dispose();
    }
  });

  test('P-SEC9: a nonexistent tail under a symlinked parent cannot slip inside cairn dirs — and the refusal names no absolute root', async () => {
    const home = makeRoot();
    const linkParent = makeRoot();
    symlinkSync(home, join(linkParent, 'alias'));
    const s = bootServer({ homeDir: home });
    try {
      const res = await req(s.app, 'POST', '/api/projects', {
        name: 'p-sneak',
        kind: 'local',
        localPath: join(linkParent, 'alias', 'not-there-yet'),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain(home);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC10: the repository and attachment roots are excluded like the other cairn storage — inside either one gets 400', async () => {
    const s = bootServer();
    try {
      for (const root of [s.reposDir, s.attachmentsDir]) {
        for (const localPath of [root, join(root, 'nested')]) {
          const res = await req(s.app, 'POST', '/api/projects', {
            name: 'p-storage',
            kind: 'local',
            localPath,
          });
          expect(res.status, localPath).toBe(400);
        }
      }
    } finally {
      s.dispose();
    }
  });

  test('P-SEC11: a dangling symlink in the middle of a localPath fails closed instead of being reconstructed', async () => {
    const parent = makeRoot();
    symlinkSync(join(parent, 'gone', 'target'), join(parent, 'link'));
    const s = bootServer({ homeDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/projects', {
        name: 'p-dangling',
        kind: 'local',
        localPath: join(parent, 'link', 'sub'),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain(parent);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC12: a symlink loop fails closed instead of being accepted as a reconstructed path', async () => {
    const parent = makeRoot();
    symlinkSync(join(parent, 'loop'), join(parent, 'loop'));
    const s = bootServer({ homeDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/projects', {
        name: 'p-loop',
        kind: 'local',
        localPath: join(parent, 'loop'),
      });
      expect(res.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC13: project records omit localPath for a paired device — the owner still sees it', async () => {
    const localDir = makeRoot();
    const s = bootServer({ authToken: OWNER });
    try {
      const created = await call(s.app, 'POST', '/api/projects', {
        cred: OWNER,
        body: { name: 'p-local', kind: 'local', localPath: localDir },
      });
      expect(created.status).toBe(201);
      const projectId = ((await created.json()) as { id: string }).id;
      const { token } = await pairDevice(s);

      const ownerList = await call(s.app, 'GET', '/api/projects', { cred: OWNER });
      expect(ownerList.status).toBe(200);
      const ownerRows = (await ownerList.json()) as { id: string; localPath?: string }[];
      expect(ownerRows.find((r) => r.id === projectId)?.localPath).toBe(realpathSync(localDir));

      const deviceList = await call(s.app, 'GET', '/api/projects', { cred: token });
      expect(deviceList.status).toBe(200);
      const deviceRows = (await deviceList.json()) as Record<string, unknown>[];
      const deviceRow = deviceRows.find((r) => r.id === projectId);
      expect(deviceRow).toBeDefined();
      expect(deviceRow === undefined || 'localPath' in deviceRow).toBe(false);

      const devicePatch = await call(s.app, 'PATCH', `/api/projects/${projectId}`, {
        cred: token,
        body: { name: 'p-local-renamed' },
      });
      expect(devicePatch.status).toBe(200);
      const patched = (await devicePatch.json()) as Record<string, unknown>;
      expect('localPath' in patched).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC4: without a team github connection every binding path is refused — create, retarget and conversion issue no lookup', async () => {
    const calls: GithubCall[] = [];
    const s = bootServer({ githubFetch: githubFetchFor(['octo/demo', 'acme/ok'], calls) });
    try {
      const created = await req(s.app, 'POST', '/api/projects', {
        name: 'gh-no-conn',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
      expect(created.status).toBe(409);
      expect(await created.text()).toContain('connect GitHub');
      s.db
        .insert(projectTable)
        .values({
          id: 'gh-existing',
          name: 'gh-existing',
          teamId: s.team.id,
          repoKind: 'github',
          githubRepo: 'octo/demo',
        })
        .run();
      s.db
        .insert(projectTable)
        .values({
          id: 'local-existing',
          name: 'local-existing',
          teamId: s.team.id,
          repoKind: 'local',
          localPath: makeRoot(),
        })
        .run();
      const retarget = await req(s.app, 'PATCH', '/api/projects/gh-existing', {
        githubRepo: 'acme/ok',
      });
      expect(retarget.status).toBe(409);
      expect(await retarget.text()).toContain('connect GitHub');
      const conversion = await req(s.app, 'PATCH', '/api/projects/local-existing', {
        repoKind: 'github',
        githubRepo: 'acme/ok',
      });
      expect(conversion.status).toBe(409);
      expect(calls).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC5: a live installation token is never used to admit a binding — the lookup carries only the team connection token', async () => {
    const socket = await fakeAppTokenSocket();
    const calls: GithubCall[] = [];
    const s = bootServer({
      githubAppTokenSocket: socket.socketPath,
      githubFetch: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          authorization: new Headers(
            (init as { headers?: Record<string, string> } | undefined)?.headers,
          ).get('authorization'),
        });
        if (url.includes('/installation/repositories')) {
          return new Response(
            JSON.stringify({
              total_count: 1,
              repositories: [{ full_name: 'octo/demo' }],
            }),
            { status: 200 },
          );
        }
        const hit = url.includes('/repos/octo/demo');
        return new Response(JSON.stringify({ full_name: 'octo/demo' }), {
          status: hit ? 200 : 404,
        });
      },
    });
    try {
      const refused = await req(s.app, 'POST', '/api/projects', {
        name: 'gh-app-token',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
      expect(refused.status).toBe(409);
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'ghp_team_admission',
          scope: 'repo',
        },
      );
      const created = await req(s.app, 'POST', '/api/projects', {
        name: 'gh-team-token',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
      expect(created.status).toBe(201);
      const probes = calls.filter((c) => c.url.includes('/repos/octo/demo'));
      expect(probes).toHaveLength(1);
      expect(probes[0]?.authorization).toBe('Bearer ghp_team_admission');
    } finally {
      s.dispose();
      await socket.close();
    }
  });

  test('P-SEC9: a github bind is refused when the probed connection is disconnected or replaced in flight', async () => {
    let probeHook: () => void = () => undefined;
    const probeFetch: FetchLike = (input, init) => {
      probeHook();
      return githubFetchFor(['octo/demo'])(input, init);
    };
    const s = bootServer({ githubFetch: probeFetch });
    const deps = { db: s.db, box: s.secretBox };
    const connect = () =>
      upsertGithubConnection(deps, {
        teamId: s.team.id,
        login: 'octo',
        accessToken: 'ghp_pin_race',
        scope: 'repo',
      });
    const createGh = () =>
      req(s.app, 'POST', '/api/projects', {
        name: 'gh',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
    const projectCount = () => s.db.select().from(projectTable).all().length;
    try {
      connect();
      probeHook = () => markGithubConnectionDisconnected(deps, s.team.id, 'revoked during bind');
      expect((await createGh()).status).toBe(409);
      expect(projectCount()).toBe(0);

      connect();
      probeHook = () => connect();
      expect((await createGh()).status).toBe(409);
      expect(projectCount()).toBe(0);

      probeHook = () => undefined;
      expect((await createGh()).status).toBe(201);
      expect(projectCount()).toBe(1);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC10: a github retarget and chief connect_repo are refused when the connection is disconnected in flight', async () => {
    let probeHook: () => void = () => undefined;
    const probeFetch: FetchLike = (input, init) => {
      probeHook();
      return githubFetchFor(['octo/demo', 'acme/ok'])(input, init);
    };
    const s = bootServer({ githubFetch: probeFetch });
    const deps = { db: s.db, box: s.secretBox };
    upsertGithubConnection(deps, {
      teamId: s.team.id,
      login: 'octo',
      accessToken: 'ghp_pin_race',
      scope: 'repo',
    });
    try {
      const created = await req(s.app, 'POST', '/api/projects', {
        name: 'gh',
        kind: 'github',
        githubRepo: 'octo/demo',
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      probeHook = () => markGithubConnectionDisconnected(deps, s.team.id, 'revoked during bind');
      const retarget = await req(s.app, 'PATCH', `/api/projects/${id}`, {
        githubRepo: 'acme/ok',
      });
      expect(retarget.status).toBe(409);
      expect(
        s.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.githubRepo,
      ).toBe('octo/demo');

      upsertGithubConnection(deps, {
        teamId: s.team.id,
        login: 'octo',
        accessToken: 'ghp_pin_race',
        scope: 'repo',
      });
      const chiefCtx = {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: 'chief-pin',
        threadId: 'thread-pin',
        chiefAgentId: null,
        conversationId: 'conv-pin',
      };
      const toolDeps = {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        githubFetch: probeFetch,
      };
      const err = await executeChiefTool(toolDeps, chiefCtx, 'connect_repo', {
        projectId: id,
        githubRepo: 'octo/demo',
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC11: repository read errors hide the localPath from a paired device; the owner keeps the detail', async () => {
    const s = bootServer({ authToken: OWNER });
    const missing = join(makeRoot(), 'gone');
    const notGit = makeRoot();
    s.db
      .insert(projectTable)
      .values([
        { id: 'proj-missing', name: 'm', teamId: s.team.id, repoKind: 'local', localPath: missing },
        { id: 'proj-notgit', name: 'n', teamId: s.team.id, repoKind: 'local', localPath: notGit },
      ])
      .run();
    const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error ?? '';
    try {
      const { token } = await pairDevice(s);
      const deviceMissing = await call(s.app, 'GET', '/api/projects/proj-missing/files', {
        cred: token,
      });
      expect(deviceMissing.status).toBe(404);
      expect(await errorOf(deviceMissing)).not.toContain(missing);
      const deviceNotGit = await call(s.app, 'GET', '/api/projects/proj-notgit/files', {
        cred: token,
      });
      expect(deviceNotGit.status).toBe(404);
      expect(await errorOf(deviceNotGit)).not.toContain(notGit);
      const deviceBranches = await call(s.app, 'GET', '/api/projects/proj-missing/branches', {
        cred: token,
      });
      expect(await errorOf(deviceBranches)).not.toContain(missing);
      const deviceImport = await call(s.app, 'POST', `/api/teams/${s.team.id}/memory-imports`, {
        cred: token,
        body: { projectId: 'proj-missing', file: 'CLAUDE.md' },
      });
      expect(deviceImport.status).toBe(404);
      expect(await errorOf(deviceImport)).not.toContain(missing);

      const ownerMissing = await call(s.app, 'GET', '/api/projects/proj-missing/files', {
        cred: OWNER,
      });
      expect(await errorOf(ownerMissing)).toContain(missing);
      const ownerNotGit = await call(s.app, 'GET', '/api/projects/proj-notgit/files', {
        cred: OWNER,
      });
      expect(await errorOf(ownerNotGit)).toContain(notGit);
      const ownerImport = await call(s.app, 'POST', `/api/teams/${s.team.id}/memory-imports`, {
        cred: OWNER,
        body: { projectId: 'proj-missing', file: 'CLAUDE.md' },
      });
      expect(await errorOf(ownerImport)).toContain(missing);
    } finally {
      s.dispose();
    }
  });

  test('P-SEC12: an admitted non-paired principal that fails the owner check gets no localPath and no owner-only actions', async () => {
    const s = bootServer();
    const localDir = makeRoot();
    s.db
      .insert(projectTable)
      .values({
        id: 'proj-l',
        name: 'l',
        teamId: s.team.id,
        repoKind: 'local',
        localPath: localDir,
      })
      .run();
    const realUserId = s.user.id;
    s.user.id = 'non-owner-principal';
    try {
      const list = await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`);
      const rows = (await list.json()) as { localPath?: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.localPath).toBeUndefined();

      const createLocal = await req(s.app, 'POST', '/api/projects', {
        name: 'x',
        kind: 'local',
        localPath: localDir,
      });
      expect(createLocal.status).toBe(403);

      const files = await req(s.app, 'GET', '/api/projects/proj-l/files');
      const fileErr = ((await files.json()) as { error?: string }).error ?? '';
      expect(fileErr).not.toContain(localDir);

      const importRes = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: localDir,
      });
      expect(importRes.status).toBe(403);
      const refreshRes = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/any/refresh`, {});
      expect(refreshRes.status).toBe(403);

      s.user.id = realUserId;
      const ownerList = await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`);
      expect(((await ownerList.json()) as { localPath?: string }[])[0]?.localPath).toBe(localDir);
    } finally {
      s.user.id = realUserId;
      s.dispose();
    }
  });
});
