import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { todoRecordSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { bootServer, type TestServer } from './helpers.js';

let readonlyHome: string;
let gateDirectory: string;

beforeAll(async () => {
  readonlyHome = await mkdtemp(join(tmpdir(), 'github-create-route-readonly-'));
  gateDirectory = join(readonlyHome, 'github-create');
  await mkdir(gateDirectory);
  await chmod(gateDirectory, 0o500);
  vi.stubEnv('CAIRN_HOME', readonlyHome);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await chmod(gateDirectory, 0o700);
  await rm(readonlyHome, { recursive: true, force: true });
});

const TOKEN = 'ghp_unwritable_token';
const REPO = 'octo/readonly';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
}

async function postGithubProject(app: Hono): Promise<string> {
  const res = await call(app, 'POST', '/api/projects', {
    body: { name: 'readonly', kind: 'github', githubRepo: REPO },
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function createTask(app: Hono, projectId: string): Promise<string> {
  const res = await call(app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '', spec: '给登录页加图形验证码' },
  });
  if (res.status !== 201) throw new Error(`createTask: ${res.status}`);
  const record = todoRecordSchema.parse(await res.json());
  return record.id;
}

async function getTodo(app: Hono, id: string) {
  return todoRecordSchema.parse(await (await call(app, 'GET', `/api/todos/${id}`)).json());
}

test('retry on an unwritable gate directory answers 503 naming the directory, with zero outbound calls', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const calls: string[] = [];
  try {
    const s = bootServer({
      githubFetch: async (input, init) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => '',
        };
      },
    });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const todoId = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    expect((await getTodo(s.app, todoId)).sourceRef).toBeNull();
    const retry = await call(s.app, 'POST', `/api/todos/${todoId}/github-issue/retry`);
    expect(retry.status).toBe(503);
    const body = (await retry.json()) as { error: string };
    expect(body.error).toMatch(/not writable/);
    expect(body.error).toContain(gateDirectory);
    expect(calls).toHaveLength(0);
    s.dispose();
  } finally {
    errorSpy.mockRestore();
  }
});

test('a creation-time mirror failure on an unwritable gate directory logs the todo and the cause', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const s = bootServer({
      githubFetch: async (input, init) => {
        throw new Error(`unexpected outbound call: ${init?.method ?? 'GET'} ${String(input)}`);
      },
    });
    seedConnection(s);
    const projectId = await postGithubProject(s.app);
    const todoId = await createTask(s.app, projectId);
    await flushSelfIssueWrites();
    const after = await getTodo(s.app, todoId);
    expect(after.sourceKind).toBe('github-issue-self');
    expect(after.sourceRef).toBeNull();
    const logged = errorSpy.mock.calls
      .map((callArgs) => callArgs.join(' '))
      .filter((line) => line.includes(todoId));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/not writable/);
    s.dispose();
  } finally {
    errorSpy.mockRestore();
  }
});
