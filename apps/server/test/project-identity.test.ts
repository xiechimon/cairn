import {
  type ClaimedStep,
  claimedStepSchema,
  projectConvertedNote,
  projectGithubRepoRetargetedNote,
  projectRenamedNote,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import type { AppContext } from '../src/context.js';
import {
  agent as agentTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bindAllAgents, bootServer, issueApiKey, req } from './helpers.js';

interface GhRoute {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function ghMock(initial: Record<string, GhRoute>) {
  const routes = new Map<string, GhRoute>(Object.entries(initial));
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const route = routes.get(new URL(url).pathname) ?? { status: 404, body: {} };
    const status = route.status ?? 200;
    const headers = route.headers ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    };
  };
  return { impl, calls, set: (path: string, res: GhRoute) => routes.set(path, res) };
}

const REACHABLE: Record<string, GhRoute> = { '/repos/octo/conv': { body: { id: 1 } } };

const s = bootServer({ claimHoldMs: 200, githubFetch: ghMock(REACHABLE).impl });
afterAll(() => s.dispose());

interface ProjectReply {
  id?: string;
  name?: string;
  description?: string | null;
  repoKind?: string;
  githubRepo?: string;
  localPath?: string | null;
  cloneUrl?: string;
  error?: string;
  reason?: string;
}

async function patchProject(
  app: Hono,
  id: string,
  body: unknown,
): Promise<{ status: number; body: ProjectReply }> {
  const res = await req(app, 'PATCH', `/api/projects/${id}`, body);
  return { status: res.status, body: (await res.json()) as ProjectReply };
}

function insertLocalProject(id: string, localPath: string | null): void {
  s.db
    .insert(projectTable)
    .values({
      id,
      name: `local-${id}`,
      teamId: s.team.id,
      repoKind: 'local',
      repoName: null,
      githubRepo: null,
      localPath,
      description: null,
    })
    .run();
}

function insertPlainProject(id: string): void {
  s.db
    .insert(projectTable)
    .values({
      id,
      name: `plain-${id}`,
      teamId: s.team.id,
      repoKind: null,
      repoName: null,
      githubRepo: null,
      localPath: null,
      description: null,
    })
    .run();
}

function projectRow(id: string) {
  return s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
}

function noteRowsFor(srv: ReturnType<typeof bootServer>, conversationIds: string[]) {
  if (conversationIds.length === 0) return [];
  return srv.db
    .select()
    .from(messageTable)
    .where(inArray(messageTable.conversationId, conversationIds))
    .all()
    .filter((r) => r.role === 'system');
}

describe('PATCH /api/projects/{id} -- the name/description write surface (#1242)', () => {
  test('R1 renaming -> 200 + row/record updated', async () => {
    const id = 'proj-ident-r1';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, { name: '新名字' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('新名字');
    expect(projectRow(id)?.name).toBe('新名字');
  });

  test('R2 name empty string / whitespace only -> 400', async () => {
    const id = 'proj-ident-r2';
    insertPlainProject(id);
    for (const name of ['', '   ']) {
      const r = await patchProject(s.app, id, { name });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('name');
    }
    expect(projectRow(id)?.name).toBe(`plain-${id}`);
  });

  test('R3 unknown field -> 400 (strict: unsupported fields explicitly rejected)', async () => {
    const id = 'proj-ident-r3';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, { repoName: 'x', name: 'ok' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('repoName');
  });

  test('R4 all five keys missing (empty body) -> 400 (the silent no-op family is dead)', async () => {
    const id = 'proj-ident-r4';
    insertPlainProject(id);
    const r = await patchProject(s.app, id, {});
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('body');
  });

  test('D1/D2/D3 description stored, cleared by null, cleared by empty string (empty means null)', async () => {
    const id = 'proj-ident-d1';
    insertPlainProject(id);
    const r1 = await patchProject(s.app, id, { description: '一条描述' });
    expect(r1.status).toBe(200);
    expect(r1.body.description).toBe('一条描述');
    const r2 = await patchProject(s.app, id, { description: null });
    expect(r2.status).toBe(200);
    expect(r2.body.description).toBeUndefined();
    expect(projectRow(id)?.description).toBeNull();
    const r3 = await patchProject(s.app, id, { description: '  ' });
    expect(r3.status).toBe(200);
    expect(projectRow(id)?.description).toBeNull();
  });

  test('D4 name + description + localPath in one multi-field patch -> each lands in place (github project)', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-multi',
      kind: 'github',
      githubRepo: 'octo/multi',
    });
    const id = String(((await res.json()) as ProjectReply).id);
    const r = await patchProject(s.app, id, {
      name: '改名带描述',
      description: 'desc',
      localPath: '/Users/who/code/multi',
    });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('改名带描述');
    expect(r.body.description).toBe('desc');
    expect(r.body.localPath).toBe('/Users/who/code/multi');
  });
});

async function createTodoWithBuild(
  srv: ReturnType<typeof bootServer>,
  projectId: string,
  title: string,
): Promise<{ todoId: string; buildId: string }> {
  const agentId = 'agent-ident-1';
  srv.db
    .insert(agentTable)
    .values({ id: agentId, teamId: srv.team.id, displayName: 'ident-builder', modelId: 'm' })
    .onConflictDoNothing()
    .run();
  const todoRes = await req(srv.app, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec: 'spec',
  });
  const todoId = String(((await todoRes.json()) as { id: string }).id);
  const buildRes = await req(srv.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: false,
  });
  expect(buildRes.status).toBe(201);
  const buildId = (((await buildRes.json()) as { builds: { id: string }[] }).builds ?? [])[0]?.id;
  if (buildId === undefined) throw new Error('build not created');
  return { todoId, buildId };
}

describe('PATCH /api/projects/{id} -- the system-note surface (#1242)', () => {
  test('N1 a real rename -> one system note per conversation of the project todos (single text source)', async () => {
    const id = 'proj-ident-n1';
    insertPlainProject(id);
    const t1 = await createTodoWithBuild(s, id, '注记探针一');
    const t2 = await createTodoWithBuild(s, id, '注记探针二');
    const r = await patchProject(s.app, id, { name: '改后名' });
    expect(r.status).toBe(200);
    const notes = noteRowsFor(s, [t1.buildId, t2.buildId]);
    expect(notes).toHaveLength(2);
    for (const n of notes) {
      expect(n.role).toBe('system');
      expect(n.content).toBe(projectRenamedNote({ from: `plain-${id}`, to: '改后名' }));
    }
  });

  test('N2 renaming to the same name -> 200 with zero notes', async () => {
    const id = 'proj-ident-n2';
    insertPlainProject(id);
    const t = await createTodoWithBuild(s, id, '同名探针');
    const r = await patchProject(s.app, id, { name: `plain-${id}` });
    expect(r.status).toBe(200);
    expect(noteRowsFor(s, [t.buildId])).toHaveLength(0);
  });

  test('N3 a todo without a build gets no note and no error', async () => {
    const id = 'proj-ident-n3';
    insertPlainProject(id);
    await req(s.app, 'POST', `/api/projects/${id}/todos`, { title: '空卡', spec: '' });
    const r = await patchProject(s.app, id, { name: '还是改名' });
    expect(r.status).toBe(200);
    const leaked = s.db
      .select()
      .from(messageTable)
      .all()
      .filter((m) => typeof m.content === 'string' && m.content.includes('还是改名'));
    expect(leaked).toHaveLength(0);
  });
});

describe('PATCH /api/projects/{id} -- local->github conversion (#1242)', () => {
  test('K1 localPath key absent -> the original value kept (the local binding becomes the accelerator) + cloneUrl switched + a note', async () => {
    const id = 'proj-ident-k1';
    insertLocalProject(id, '/Users/who/code/cairn');
    const t = await createTodoWithBuild(s, id, '转换探针');
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, t.buildId)).run();
    const r = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(r.status).toBe(200);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/conv');
    expect(r.body.localPath).toBe('/Users/who/code/cairn');
    expect(r.body.cloneUrl).toBe('https://github.com/octo/conv.git');
    const row = projectRow(id);
    expect(row?.repoKind).toBe('github');
    expect(row?.localPath).toBe('/Users/who/code/cairn');
    const notes = noteRowsFor(s, [t.buildId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe(
      projectConvertedNote({ githubRepo: 'octo/conv', localPath: '/Users/who/code/cairn' }),
    );
  });

  test('K2 conversion carrying a localPath string: an absolute path stored; a relative path 400 + not_absolute (both condition gates share one function)', async () => {
    const id = 'proj-ident-k2';
    insertLocalProject(id, '/Users/who/code/cairn');
    const ok = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: '/data/mea/cairn',
    });
    expect(ok.status).toBe(200);
    expect(projectRow(id)?.localPath).toBe('/data/mea/cairn');
  });

  test('K2b a relative path -> 400 + reason not_absolute', async () => {
    const id = 'proj-ident-k2b';
    insertLocalProject(id, '/Users/who/code/cairn');
    const r = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: 'relative/x',
    });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('not_absolute');
    expect(projectRow(id)?.repoKind).toBe('local');
  });

  test('K3 conversion carrying localPath:null -> the accelerator cleared', async () => {
    const id = 'proj-ident-k3';
    insertLocalProject(id, '/Users/who/code/cairn');
    const r = await patchProject(s.app, id, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
      localPath: null,
    });
    expect(r.status).toBe(200);
    expect(projectRow(id)?.localPath).toBeNull();
  });

  test('K4 missing githubRepo -> 400; K5 malformed shape -> 400', async () => {
    const id = 'proj-ident-k4';
    insertLocalProject(id, '/Users/who/code/cairn');
    const r4 = await patchProject(s.app, id, { repoKind: 'github' });
    expect(r4.status).toBe(400);
    expect(String(r4.body.error)).toContain('githubRepo');
    const r5 = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'no-slash' });
    expect(r5.status).toBe(400);
    expect(String(r5.body.error)).toContain('githubRepo');
    expect(projectRow(id)?.repoKind).toBe('local');
  });

  test('K6 githubRepo unreachable (mock 404) -> 400; a no-token connection = the anonymous ladder (no auth header)', async () => {
    const mock = ghMock({});
    const s404 = bootServer({ githubFetch: mock.impl });
    try {
      const id = 'proj-ident-k6';
      s404.db
        .insert(projectTable)
        .values({
          id,
          name: 'local-k6',
          teamId: s404.team.id,
          repoKind: 'local',
          repoName: null,
          githubRepo: null,
          localPath: '/Users/who/code/cairn',
          description: null,
        })
        .run();
      const r = await patchProject(s404.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('octo/conv');
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.headers.authorization).toBeUndefined();
      expect(
        s404.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.repoKind,
      ).toBe('local');
    } finally {
      s404.dispose();
    }
  });

  test('K6b GitHub connected -> the probe carries an Authorization header (the single read point of openGithubToken)', async () => {
    const mock = ghMock(REACHABLE);
    const sAuth = bootServer({ githubFetch: mock.impl });
    try {
      upsertGithubConnection(
        { db: sAuth.db, box: sAuth.secretBox },
        { teamId: sAuth.team.id, login: 'octo', accessToken: 'ghp_ident_probe', scope: 'repo' },
      );
      const id = 'proj-ident-k6b';
      sAuth.db
        .insert(projectTable)
        .values({
          id,
          name: 'local-k6b',
          teamId: sAuth.team.id,
          repoKind: 'local',
          repoName: null,
          githubRepo: null,
          localPath: '/Users/who/code/cairn',
          description: null,
        })
        .run();
      const r = await patchProject(sAuth.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
      expect(r.status).toBe(200);
      expect(mock.calls[0]?.headers.authorization).toBe('Bearer ghp_ident_probe');
      expect(mock.calls[0]?.url).toBe('https://api.github.com/repos/octo/conv');
    } finally {
      sAuth.dispose();
    }
  });

  test('K7 a build in flight (pending step) -> 409; after the step reaches a terminal state -> 200', async () => {
    const id = 'proj-ident-k7';
    insertLocalProject(id, '/Users/who/code/cairn');
    const t = await createTodoWithBuild(s, id, '在飞闸探针');
    const blocked = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error)).toContain('in-flight');
    expect(projectRow(id)?.repoKind).toBe('local');
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, t.buildId)).run();
    const ok = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(ok.status).toBe(200);
  });

  test('K8 converting a github project again -> 400 (already the target shape); github->local the other way -> 400', async () => {
    const id = 'proj-ident-k8';
    insertLocalProject(id, '/Users/who/code/cairn');
    const conv = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(conv.status).toBe(200);
    const again = await patchProject(s.app, id, { repoKind: 'github', githubRepo: 'octo/other' });
    expect(again.status).toBe(400);
    const back = await patchProject(s.app, id, { repoKind: 'local' });
    expect(back.status).toBe(400);
    expect(projectRow(id)?.githubRepo).toBe('octo/conv');
  });

  test('K9 repoKind local/hosted (not the github target) -> 400', async () => {
    const id = 'proj-ident-k9';
    insertLocalProject(id, '/Users/who/code/cairn');
    for (const repoKind of ['local', 'hosted'] as const) {
      const r = await patchProject(s.app, id, { repoKind });
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain('local→github');
    }
  });

  test('K10 githubRepo without repoKind -> 400 (githubRepo is written only on the conversion surface)', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-k10',
      kind: 'github',
      githubRepo: 'octo/keep',
    });
    const id = String(((await res.json()) as ProjectReply).id);
    const r = await patchProject(s.app, id, { githubRepo: 'octo/other' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('githubRepo');
    expect(projectRow(id)?.githubRepo).toBe('octo/keep');
  });

  test('K11 converting a hosted project -> 400; K12 converting a plain project (repoKind null) -> 400', async () => {
    const hostedRes = await req(s.app, 'POST', '/api/projects', {
      name: 'ident-hosted',
      kind: 'hosted',
    });
    expect(hostedRes.status).toBe(201);
    const hostedId = String(((await hostedRes.json()) as ProjectReply).id);
    const rh = await patchProject(s.app, hostedId, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(rh.status).toBe(400);

    const plainId = 'proj-ident-k12';
    insertPlainProject(plainId);
    const rp = await patchProject(s.app, plainId, { repoKind: 'github', githubRepo: 'octo/conv' });
    expect(rp.status).toBe(400);
    expect(projectRow(plainId)?.repoKind).toBeNull();
  });
});

describe('PATCH /api/projects/{id} -- githubRepo retarget on a github project (#1730)', () => {
  const retargetDisposables: (() => void)[] = [];
  afterAll(() => {
    for (const d of retargetDisposables) d();
  });

  function bootRetargetServer(
    routes: Record<string, GhRoute>,
    logger?: AppContext['logger'],
  ): { srv: ReturnType<typeof bootServer>; mock: ReturnType<typeof ghMock> } {
    const mock = ghMock(routes);
    const srv = bootServer({ githubFetch: mock.impl, ...(logger !== undefined ? { logger } : {}) });
    retargetDisposables.push(() => srv.dispose());
    return { srv, mock };
  }

  async function createGithubProjectOn(
    srv: ReturnType<typeof bootServer>,
    ref: string,
  ): Promise<string> {
    const res = await req(srv.app, 'POST', '/api/projects', {
      name: `ident-${ref.replace(/\W/g, '-')}`,
      kind: 'github',
      githubRepo: ref,
    });
    expect(res.status).toBe(201);
    return String(((await res.json()) as ProjectReply).id);
  }

  test('G1 a reachable new owner/repo -> 200 + row/record/cloneUrl updated + one system note per conversation', async () => {
    const { srv } = bootRetargetServer({
      '/repos/octo/retarget': { body: { id: 2, full_name: 'octo/retarget' } },
    });
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const t = await createTodoWithBuild(srv, id, '换仓探针');
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/retarget' });
    expect(r.status).toBe(200);
    expect(r.body.githubRepo).toBe('octo/retarget');
    expect(r.body.cloneUrl).toBe('https://github.com/octo/retarget.git');
    const row = srv.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.githubRepo).toBe('octo/retarget');
    const notes = noteRowsFor(srv, [t.buildId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.role).toBe('system');
    expect(notes[0]?.content).toBe(
      projectGithubRepoRetargetedNote({ from: 'octo/keep', to: 'octo/retarget' }),
    );
  });

  test('G2 an unreadable repo (probe 404) -> 400 + the row unchanged + zero notes', async () => {
    const { srv } = bootRetargetServer({});
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const t = await createTodoWithBuild(srv, id, '不可读探针');
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/ghost' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('octo/ghost');
    const row = srv.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.githubRepo).toBe('octo/keep');
    expect(noteRowsFor(srv, [t.buildId])).toHaveLength(0);
  });

  test('G3 the same owner/repo -> 200 no-op: zero probe calls and zero notes', async () => {
    const { srv, mock } = bootRetargetServer({});
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const t = await createTodoWithBuild(srv, id, '同值探针');
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/keep' });
    expect(r.status).toBe(200);
    expect(r.body.githubRepo).toBe('octo/keep');
    expect(mock.calls).toHaveLength(0);
    expect(noteRowsFor(srv, [t.buildId])).toHaveLength(0);
  });

  test('G4 a malformed ref -> 400 + no probe call + the row unchanged', async () => {
    const { srv, mock } = bootRetargetServer({});
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const r = await patchProject(srv.app, id, { githubRepo: 'no-slash' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('githubRepo');
    expect(mock.calls).toHaveLength(0);
    expect(
      srv.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.githubRepo,
    ).toBe('octo/keep');
  });

  test('G5 a non-github project -> 400 (unchanged: only github projects retarget, local ones use the conversion surface)', async () => {
    const { srv } = bootRetargetServer({
      '/repos/octo/conv': { body: { id: 1 } },
    });
    const id = 'proj-ident-g5';
    srv.db
      .insert(projectTable)
      .values({
        id,
        name: 'local-g5',
        teamId: srv.team.id,
        repoKind: 'local',
        repoName: null,
        githubRepo: null,
        localPath: '/Users/who/code/cairn',
        description: null,
      })
      .run();
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/conv' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('githubRepo');
    expect(srv.db.select().from(projectTable).where(eq(projectTable.id, id)).get()?.repoKind).toBe(
      'local',
    );
  });

  test('G6 GitHub connected -> the retarget probe carries an Authorization header (the team connection token)', async () => {
    const { srv, mock } = bootRetargetServer({
      '/repos/octo/conv': { body: { id: 1, full_name: 'octo/conv' } },
    });
    upsertGithubConnection(
      { db: srv.db, box: srv.secretBox },
      { teamId: srv.team.id, login: 'octo', accessToken: 'ghp_ident_probe', scope: 'repo' },
    );
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/conv' });
    expect(r.status).toBe(200);
    expect(mock.calls[0]?.url).toBe('https://api.github.com/repos/octo/conv');
    expect(mock.calls[0]?.headers.authorization).toBe('Bearer ghp_ident_probe');
  });

  test('G7 a renamed upstream (probe body full_name differs, the followed 301 case) -> 200 + the server logs the new name once', async () => {
    const logs: { obj: Record<string, unknown>; msg: string }[] = [];
    const logger = {
      info: (obj: object, msg: string) => logs.push({ obj: obj as Record<string, unknown>, msg }),
    } as unknown as AppContext['logger'];
    const { srv } = bootRetargetServer(
      { '/repos/octo/pacman': { body: { id: 3, full_name: 'octo/cairn' } } },
      logger,
    );
    const id = await createGithubProjectOn(srv, 'octo/keep');
    const r = await patchProject(srv.app, id, { githubRepo: 'octo/pacman' });
    expect(r.status).toBe(200);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.msg).toContain('octo/cairn');
    expect(logs[0]?.obj).toMatchObject({ from: 'octo/pacman', to: 'octo/cairn' });
  });
});

const claimDisposables: (() => void)[] = [];
afterAll(() => {
  for (const d of claimDisposables) d();
});

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

describe('the claim payload repo shape after conversion (#1242)', () => {
  test('C1 a new step claim after local conversion -> repo {kind:github, cloneUrl, localPath}', async () => {
    const mock = ghMock(REACHABLE);
    const s2 = bootServer({ claimHoldMs: 200, githubFetch: mock.impl });
    claimDisposables.push(() => s2.dispose());
    const key = await issueApiKey(s2);
    const enrollRes = await call(s2.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s2.team.id, name: 'ident-mea', cliVersion: '0.1.0' },
    });
    const machineToken = ((await enrollRes.json()) as { token: string }).token;
    const agentId = 'agent-ident-claim';
    s2.db
      .insert(agentTable)
      .values({ id: agentId, teamId: s2.team.id, displayName: 'ident-claimer', modelId: 'm' })
      .run();
    bindAllAgents(s2);
    const projectId = 'proj-ident-c1';
    s2.db
      .insert(projectTable)
      .values({
        id: projectId,
        name: 'cairn',
        teamId: s2.team.id,
        repoKind: 'local',
        repoName: null,
        githubRepo: null,
        localPath: '/Users/who/code/cairn',
        description: null,
      })
      .run();
    const conv = await patchProject(s2.app, projectId, {
      repoKind: 'github',
      githubRepo: 'octo/conv',
    });
    expect(conv.status).toBe(200);
    const todoRes = await call(s2.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '转换后施工', spec: '改一行' },
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;
    const buildRes = await call(s2.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: { agentId }, build: { agentId } },
        withPlan: false,
      },
    });
    expect(buildRes.status).toBe(201);
    const claimRes = await call(s2.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!body.step) throw new Error('claim returned no step');
    const claimed = claimedStepSchema.parse(body.step);
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/conv.git',
      localPath: '/Users/who/code/cairn',
    });
  });
});
