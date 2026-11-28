import { type ClaimedStep, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { githubLabel } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createTodo } from '../src/services/todos.js';
import {
  bootServer,
  issueApiKey,
  postProject,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const TOKEN = 'ghp_issue_face_token';
const REPO = 'octo/alpha';

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

export interface GhCall {
  url: string;
  headers: Record<string, string>;
}

interface GhResponse {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

type GhRoute = GhResponse | ((url: URL) => GhResponse);

function ghMock(initial: Record<string, GhRoute>) {
  const routes = new Map<string, GhRoute>(Object.entries(initial));
  const calls: GhCall[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) } });
    const parsed = new URL(url);
    const route = routes.get(parsed.pathname);
    const repoProbe = /^\/repos\/([^/]+\/[^/]+)$/.exec(parsed.pathname);
    const res =
      route === undefined
        ? repoProbe !== null
          ? { body: { full_name: repoProbe[1] } }
          : { status: 404, body: { message: `no mock for ${parsed.pathname}` } }
        : typeof route === 'function'
          ? route(parsed)
          : route;
    const status = res.status ?? 200;
    const headers = res.headers ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
  return {
    impl,
    calls,
    set(path: string, res: GhRoute): void {
      routes.set(path, res);
    },
  };
}

const ISSUE_7_TITLE =
  '登录偶发 500：会话过期后重试风暴打挂鉴权上游——这个标题超过五十个字符必须原样保留不截断';
const ISSUE_7_BODY = '复现步骤：会话过期后连点重试。\n\n期望：退避。';
const LEGACY_VOCAB = ['bug', 'area:auth', 'help wanted'];

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

async function postGithubProject(app: Hono, name = 'alpha'): Promise<string> {
  const res = await call(app, 'POST', '/api/projects', {
    body: { name, kind: 'github', githubRepo: REPO },
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

function projectLabels(s: TestServer, projectId: string) {
  return s.db.select().from(githubLabel).where(eq(githubLabel.projectId, projectId)).all();
}

function seedLegacyVocab(s: TestServer, projectId: string): void {
  for (const name of LEGACY_VOCAB) {
    s.db
      .insert(githubLabel)
      .values({ id: `lbl-${projectId}-${name}`, projectId, name })
      .run();
  }
}

describe('set_task_meta vocabulary invariant two shapes (E23-E26 / F27-F28)', () => {
  async function world(kind: 'github' | 'plain', legacyIssue: boolean) {
    const mock = ghMock({});
    const s = bootServer({ githubFetch: mock.impl, claimHoldMs: 250 });
    if (kind === 'github') seedConnection(s);
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: readyMachine({ teamId: s.team.id, name: 'l446', cliVersion: '0.1.0' }),
    });
    const { token } = (await enroll.json()) as { token: string };
    seedSessionRoute(s, { provider: 'p', modelId: 'm' });

    const projectId = kind === 'github' ? await postGithubProject(s.app) : await postProject(s.app);
    let todoId: string;
    if (legacyIssue) {
      seedLegacyVocab(s, projectId);
      todoId = createTodo(s.svc, {
        teamId: s.team.id,
        projectId,
        title: ISSUE_7_TITLE,
        spec: ISSUE_7_BODY,
        createdBy: s.user.id,
        ownerId: s.user.id,
        sourceKind: 'github-issue',
        sourceRef: `github:${REPO}#7`,
      }).id;
    } else {
      const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: '', spec: '给登录页加图形验证码' },
      });
      todoId = ((await todoRes.json()) as { id: string }).id;
    }
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId] },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, token, step, projectId, todoId, mock };
  }

  const relay = (app: Hono, token: string, stepId: string, params: Record<string, unknown>) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params },
    });

  test('ordinary claim: todo.meta default, tool surface is title-only', async () => {
    const { s, step } = await world('plain', false);
    expect(step.todo?.meta).toBeUndefined();
    const def = step.remoteTools?.find((t) => t.name === 'set_task_meta');
    expect(def).toBeDefined();
    const params = def!.parameters as { required?: string[]; properties: Record<string, unknown> };
    expect(params.required).toEqual(['title']);
    expect(Object.keys(params.properties)).toEqual(['title']);
    s.dispose();
  });

  test('F28 github + issue-source claim: meta.titleFinal=true, vocab=mirrored name column, tool surface = tags array shape', async () => {
    const { s, step } = await world('github', true);
    const meta = step.todo?.meta;
    expect(meta).toBeDefined();
    expect(meta!.titleFinal).toBe(true);
    expect(meta!.vocab).toEqual([
      { name: expect.any(String) },
      { name: expect.any(String) },
      { name: expect.any(String) },
    ]);
    expect(meta!.vocab.map((v) => v.name).sort()).toEqual(['area:auth', 'bug', 'help wanted']);
    const def = step.remoteTools?.find((t) => t.name === 'set_task_meta');
    const params = def!.parameters as { required?: string[]; properties: Record<string, unknown> };
    expect(params.required).toBeUndefined();
    expect(Object.keys(params.properties).sort()).toEqual(['tags', 'title']);
    s.dispose();
  });

  test('F28 github manual task claim: meta.titleFinal=false (placeholder title still takes the backfill)', async () => {
    const { s, step } = await world('github', false);
    const meta = step.todo?.meta;
    expect(meta).toBeDefined();
    expect(meta!.titleFinal).toBe(false);
    expect(meta!.vocab).toEqual([]);
    s.dispose();
  });

  test('E24 github relay: tags array multiple values landed; name outside the set 400; title/tags all missing 400', async () => {
    const { s, token, step, todoId } = await world('github', true);
    const ok = await relay(s.app, token, step.step.id, { tags: ['bug', 'help wanted'] });
    expect(ok.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    const names = projectLabels(s, one.projectId)
      .filter((t) => (one.githubLabelIds ?? []).includes(t.id))
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(['bug', 'help wanted']);
    const bad = await relay(s.app, token, step.step.id, { tags: ['bug', 'generic-only'] });
    expect(bad.status).toBe(400);
    expect(
      todoRecordSchema.parse(await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json()),
    ).toEqual(one);
    const empty = await relay(s.app, token, step.step.id, {});
    expect(empty.status).toBe(400);
    s.dispose();
  });

  test('E26 github relay compatible with the legacy single-tag string shape (mixed-deploy tolerance, tags surface only)', async () => {
    const { s, token, step, todoId } = await world('github', true);
    const res = await relay(s.app, token, step.step.id, { tag: 'bug' });
    expect(res.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.githubLabelIds).toHaveLength(1);
    s.dispose();
  });

  test('titleFinal mechanical gate (AC "not overwritten by backfill"): issue-source task with a title = 400, tags still allowed; manual task title allowed', async () => {
    const gh = await world('github', true);
    const blocked = await relay(gh.s.app, gh.token, gh.step.step.id, { title: 'agent 想改标题' });
    expect(blocked.status).toBe(400);
    const allowed = await relay(gh.s.app, gh.token, gh.step.step.id, { tags: ['bug'] });
    expect(allowed.status).toBe(200);
    const untouched = todoRecordSchema.parse(
      await (await call(gh.s.app, 'GET', `/api/todos/${gh.todoId}`)).json(),
    );
    expect(untouched.title).toBe(ISSUE_7_TITLE);
    gh.s.dispose();
    const manual = await world('github', false);
    const ok = await relay(manual.s.app, manual.token, manual.step.step.id, { title: '正式标题' });
    expect(ok.status).toBe(200);
    const reloaded = todoRecordSchema.parse(
      await (await call(manual.s.app, 'GET', `/api/todos/${manual.todoId}`)).json(),
    );
    expect(reloaded.title).toBe('正式标题');
    manual.s.dispose();
  });

  test('ordinary relay rejects both fixed and custom category names', async () => {
    const { s, token, step } = await world('plain', false);
    const bad = await relay(s.app, token, step.step.id, { title: 'x', tag: 'urgent' });
    expect(bad.status).toBe(400);
    const fixed = await relay(s.app, token, step.step.id, { title: 'x', tag: 'feature' });
    expect(fixed.status).toBe(400);
    s.dispose();
  });
});
