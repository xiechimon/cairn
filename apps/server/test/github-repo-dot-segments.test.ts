import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { completeStep, requestMerge } from '../src/services/builds.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { flushSelfIssueWrites, writebackSelfIssueTitle } from '../src/services/todos.js';
import { bootServer, req, type TestServer } from './helpers.js';

const TOKEN = 'ghp_dot_segment_token';
const VALID_REPO = 'octo/alpha';
const DOT_SEGMENT_REFS = ['../user', './x', 'owner/..', 'owner/.'];
const STORED_BAD_REFS = ['../user', 'owner/..'];

interface Recorder {
  impl: FetchLike;
  calls: { method: string; url: string }[];
}

function recorder(): Recorder {
  const calls: { method: string; url: string }[] = [];
  const impl: FetchLike = async (input, init) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input) });
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ message: 'Not Found' }),
      text: async () => '{"message":"Not Found"}',
    };
  };
  return { impl, calls };
}

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function boot(rec: Recorder): TestServer {
  const s = bootServer({ githubFetch: rec.impl });
  servers.push(s);
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
  return s;
}

function insertGithubProject(s: TestServer, githubRepo: string): string {
  const id = `proj-${Math.random().toString(36).slice(2, 10)}`;
  s.db
    .insert(projectTable)
    .values({ id, name: id, teamId: s.team.id, repoKind: 'github', githubRepo })
    .run();
  return id;
}

let seq = 0;
function insertTodo(
  s: TestServer,
  projectId: string,
  over: Partial<typeof todoTable.$inferInsert> = {},
): string {
  seq += 1;
  const id = `todo-dot-${seq}`;
  s.db
    .insert(todoTable)
    .values({
      id,
      teamId: s.team.id,
      projectId,
      title: '点段探针',
      spec: '',
      phase: 'todo',
      phaseAt: nowMs(),
      seqNum: seq,
      ...over,
    })
    .run();
  return id;
}

function insertPrBuild(
  s: TestServer,
  projectId: string,
  over: Partial<typeof todoTable.$inferInsert> = {},
): { todoId: string; buildId: string } {
  const buildId = newUuidv7();
  const todoId = insertTodo(s, projectId, { phase: 'building', latestBuildId: buildId, ...over });
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: nowMs(),
      prUrl: 'https://github.com/octo/alpha/pull/101',
      prNumber: 101,
    })
    .run();
  return { todoId, buildId };
}

function insertDeliveringBuild(
  s: TestServer,
  projectId: string,
  over: Partial<typeof todoTable.$inferInsert> = {},
): { todoId: string; buildId: string; stepId: string } {
  const { todoId, buildId } = insertPrBuild(s, projectId, over);
  const stepId = `step-${buildId}`;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      status: 'claimed',
      machineId: 'machine-1466',
      createdAt: nowMs(),
    })
    .run();
  return { todoId, buildId, stepId };
}

function phaseOf(s: TestServer, todoId: string): string | undefined {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase;
}

function stepsOf(s: TestServer, buildId: string): { kind: string; status: string }[] {
  return s.db
    .select({ kind: stepTable.kind, status: stepTable.status })
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .sort((x, y) => x.kind.localeCompare(y.kind));
}

function chiefDeps(s: TestServer) {
  return {
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

function chiefCtx(s: TestServer) {
  return {
    teamId: s.team.id,
    userId: s.user.id,
    chiefId: 'chief-1466',
    threadId: 'chief-thread-1466',
    chiefAgentId: null,
    conversationId: 'conv-1466',
  };
}

async function postGithub(app: Hono, githubRepo: unknown): Promise<Response> {
  return req(app, 'POST', '/api/projects', { name: 'dot', kind: 'github', githubRepo });
}

describe('#1466 write surface: . / .. segment refusal (W1-W4)', () => {
  test('W1 POST /api/projects kind=github: string surface and object surface both 400', async () => {
    const rec = recorder();
    const s = boot(rec);
    for (const ref of DOT_SEGMENT_REFS) {
      expect((await postGithub(s.app, ref)).status, ref).toBe(400);
      const [owner, repo] = ref.split('/');
      expect((await postGithub(s.app, { owner, repo })).status, `object ${ref}`).toBe(400);
    }
    const stored = s.db.select().from(projectTable).all();
    expect(stored.filter((p) => p.repoKind === 'github')).toHaveLength(0);
    expect(rec.calls).toHaveLength(0);
  });

  test('W2 PATCH local->github conversion: 400, and no outbound reachability probe', async () => {
    const rec = recorder();
    const s = boot(rec);
    const created = await req(s.app, 'POST', '/api/projects', {
      name: 'loc',
      kind: 'local',
      localPath: '/tmp/cairn-1466-local',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const ref of DOT_SEGMENT_REFS) {
      const res = await req(s.app, 'PATCH', `/api/projects/${id}`, {
        repoKind: 'github',
        githubRepo: ref,
      });
      expect(res.status, ref).toBe(400);
    }
    expect(rec.calls).toHaveLength(0);
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, id)).get();
    expect(row?.repoKind).toBe('local');
    expect(row?.githubRepo).toBeNull();
  });

  test('W3 chief connect_repo: 400, project row unchanged', async () => {
    const rec = recorder();
    const s = boot(rec);
    const projectId = insertGithubProject(s, VALID_REPO);
    for (const ref of DOT_SEGMENT_REFS) {
      const err = await executeChiefTool(chiefDeps(s), chiefCtx(s), 'connect_repo', {
        projectId,
        githubRepo: ref,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, ref).toBeInstanceOf(HttpError);
      expect((err as HttpError).status, ref).toBe(400);
    }
    const row = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    expect(row?.githubRepo).toBe(VALID_REPO);
  });

  test('W4 legal name with dots passes (POST 201 / connect_repo lands the value)', async () => {
    const rec = recorder();
    const s = boot(rec);
    for (const ref of ['my.org/repo.js', '.../x', 'owner/...', 'owner/.github']) {
      const res = await postGithub(s.app, ref);
      expect(res.status, ref).toBe(201);
      expect(((await res.json()) as { githubRepo?: string }).githubRepo, ref).toBe(ref);
    }
    const objectForm = await postGithub(s.app, { owner: 'my.org', repo: 'repo.js' });
    expect(objectForm.status).toBe(201);
    const projectId = insertGithubProject(s, VALID_REPO);
    const out = JSON.parse(
      await executeChiefTool(chiefDeps(s), chiefCtx(s), 'connect_repo', {
        projectId,
        githubRepo: 'my.org/repo.js',
      }),
    ) as { githubRepo: string };
    expect(out.githubRepo).toBe('my.org/repo.js');
    expect(rec.calls).toHaveLength(0);
  });
});

describe('#1466 read path: legacy rows treated as "not a valid GitHub repo", zero outbound (R1-R8)', () => {
  test.each(STORED_BAD_REFS)(
    'R1/R2 issue list and import -> 404, zero outbound (%s)',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, bad);
      const list = await req(s.app, 'GET', `/api/projects/${projectId}/github/issues`);
      expect(list.status).toBe(404);
      const imported = await req(s.app, 'POST', `/api/projects/${projectId}/github/issues/import`, {
        number: 7,
      });
      expect(imported.status).toBe(404);
      expect(rec.calls).toEqual([]);
      expect(s.db.select().from(todoTable).all()).toHaveLength(0);
    },
  );

  test.each(STORED_BAD_REFS)(
    'R3 建任务：不进 #452 自建 issue 面（来源两列 null），零出站（%s）',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, bad);
      const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 't',
        spec: 's',
      });
      expect(res.status).toBe(201);
      const record = (await res.json()) as { sourceKind: string | null; sourceRef: string | null };
      expect(record.sourceKind).toBeNull();
      expect(record.sourceRef).toBeNull();
      await flushSelfIssueWrites();
      expect(rec.calls).toEqual([]);
    },
  );

  test.each(STORED_BAD_REFS)('R4 not-yet-created retry -> 404, zero outbound (%s)', async (bad) => {
    const rec = recorder();
    const s = boot(rec);
    const projectId = insertGithubProject(s, bad);
    const todoId = insertTodo(s, projectId, { sourceKind: 'github-issue-self', sourceRef: null });
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/github-issue/retry`);
    expect(res.status).toBe(404);
    expect(rec.calls).toEqual([]);
  });

  test.each(STORED_BAD_REFS)(
    'R5/R6 来源引用带 . / .. 段：回显 404、标题回写不出站（%s）',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, VALID_REPO);
      const todoId = insertTodo(s, projectId, {
        sourceKind: 'github-issue-self',
        sourceRef: `github:${bad}#3`,
      });
      const echo = await req(s.app, 'GET', `/api/todos/${todoId}/github-issue`);
      expect(echo.status).toBe(404);
      await writebackSelfIssueTitle(
        { ...s.svc, box: s.secretBox, githubFetch: rec.impl },
        todoId,
        '新标题',
      );
      expect(rec.calls).toEqual([]);
    },
  );

  test.each(STORED_BAD_REFS)(
    'R7 PR 交付：直进 review（不卡 building），CI 磨绿轮询零出站、不派修复步（%s）',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, bad);
      const { todoId, buildId, stepId } = insertDeliveringBuild(s, projectId);
      completeStep(s.svc, stepId, { hasChanges: true });
      const poller = createCiPoller(
        { ...s.svc, box: s.secretBox, reposDir: s.reposDir },
        { githubFetch: rec.impl },
      );
      await poller.sweep();
      expect(rec.calls).toEqual([]);
      expect(phaseOf(s, todoId)).toBe('review');
      expect(stepsOf(s, buildId)).toEqual([{ kind: 'build', status: 'done' }]);
    },
  );

  test.each(STORED_BAD_REFS)(
    'R7b CI 轮询器防御位：已在 building 且带 PR 号的存量行 → 按跳过计数，零出站（%s）',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, bad);
      const { todoId, buildId } = insertPrBuild(s, projectId);
      const info = vi.fn();
      const poller = createCiPoller(
        { ...s.svc, box: s.secretBox, reposDir: s.reposDir },
        { githubFetch: rec.impl, logger: { info } },
      );
      await poller.sweep();
      expect(rec.calls).toEqual([]);
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]?.[0]).toMatchObject({
        candidates: 1,
        pending: 0,
        appended: 0,
        advanced: 0,
        failed: 0,
        skipped: 1,
        unreadable: 0,
        errors: 0,
        reviewCandidates: 0,
      });
      expect(phaseOf(s, todoId)).toBe('building');
      expect(stepsOf(s, buildId)).toEqual([]);
    },
  );

  test.each(STORED_BAD_REFS)(
    'R8 PR 状态探测（第二张 PR 守卫）：不出站，fail-open 照常发起合并（%s）',
    async (bad) => {
      const rec = recorder();
      const s = boot(rec);
      const projectId = insertGithubProject(s, bad);
      const b1 = newUuidv7();
      const b2 = newUuidv7();
      const todoId = insertTodo(s, projectId, { phase: 'review', latestBuildId: b2 });
      const base = nowMs();
      for (const [id, prNumber, at] of [
        [b1, 888, base - 120_000],
        [b2, 999, base - 60_000],
      ] as const) {
        s.db
          .insert(buildTable)
          .values({
            id,
            todoId,
            withPlan: false,
            triggerSource: 'user',
            createdAt: at,
            prUrl: `https://github.com/octo/alpha/pull/${prNumber}`,
            prNumber,
          })
          .run();
      }
      const result = await requestMerge(
        { ...s.svc, reposDir: s.reposDir, box: s.secretBox, githubFetch: rec.impl },
        b2,
        'tester',
      );
      expect(result).toEqual({ delegated: true });
      expect(rec.calls).toEqual([]);
    },
  );
});

describe('#1466 builds.ts delivery gate: legacy invalid githubRepo treated as "no GitHub repo" (R9)', () => {
  const assignment = {
    plan: null,
    build: { agentId: 'agent-build-1466' },
    verify: { agentId: 'agent-verify-1466' },
  };

  test.each(STORED_BAD_REFS)(
    'R9 completeStep execution step delivering a PR -> review + the verify step queued (%s)',
    (bad) => {
      const s = boot(recorder());
      const projectId = insertGithubProject(s, bad);
      const { todoId, buildId, stepId } = insertDeliveringBuild(s, projectId, { assignment });
      completeStep(s.svc, stepId, { hasChanges: true });
      expect(phaseOf(s, todoId)).toBe('review');
      expect(stepsOf(s, buildId)).toEqual([
        { kind: 'build', status: 'done' },
        { kind: 'verify', status: 'pending' },
      ]);
    },
  );

  test('R9 control: a legal githubRepo PR delivery still stays building waiting for CI, no verify step enqueued', () => {
    const s = boot(recorder());
    const projectId = insertGithubProject(s, VALID_REPO);
    const { todoId, buildId, stepId } = insertDeliveringBuild(s, projectId, { assignment });
    completeStep(s.svc, stepId, { hasChanges: true });
    expect(phaseOf(s, todoId)).toBe('building');
    expect(stepsOf(s, buildId)).toEqual([{ kind: 'build', status: 'done' }]);
  });
});
