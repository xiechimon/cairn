import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Phase, type TodoSourceKind, webhookReceiverResponseSchema } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  autonomyState as autonomyStateTable,
  build as buildTableForGate,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  githubConnection as githubConnectionTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage as tokenUsageTable,
  webhookToken as webhookTokenTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { importGithubIssue, importsInFlightFor } from '../src/services/github-issues.js';
import { createIssueIntake, ISSUE_INTAKE_IN_FLIGHT_CAP } from '../src/services/issue-intake.js';
import { receiveGithubWebhook, resetWebhookDeliveryWindow } from '../src/services/webhook.js';
import { bootServer, req, type TestServer } from './helpers.js';

const GH_TOKEN = 'ghp_webhook_test_token';
const REPO = 'octo/alpha';
const ISSUE_PATH = `/repos/${REPO}/issues/7`;
const LABELS_PATH = `/repos/${REPO}/labels`;
const SENDER = 'octo';
const permissionPath = (login: string) => `/repos/${REPO}/collaborators/${login}/permission`;
const PERMISSION_EXAMPLE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures/issue-intake/permission-admin.docs-example.json'),
    'utf8',
  ),
) as { permission: string; role_name: string; user: Record<string, unknown> };

function permissionBody(
  login: string,
  permission: string,
  roleName: string,
  triage: boolean | undefined = undefined,
) {
  return {
    ...PERMISSION_EXAMPLE,
    permission,
    role_name: roleName,
    user: {
      ...PERMISSION_EXAMPLE.user,
      login,
      ...(triage !== undefined ? { permissions: { pull: true, triage, push: false } } : {}),
    },
  };
}

const ISSUE_DETAIL = {
  number: 7,
  title: 'webhook 入口测试 issue',
  body: '正文：贴 cairn 标签自动建任务。',
  state: 'open',
  labels: [{ name: 'cairn', color: '0075ca' }],
};
const LABELS_FULL = [{ name: 'cairn', color: '0075ca', description: null }];

function labeledPayload(
  labelName = 'cairn',
  opts: { sender?: string | null; issue?: number; author?: string } = {},
) {
  const sender = opts.sender === undefined ? SENDER : opts.sender;
  return {
    action: 'labeled',
    issue: {
      number: opts.issue ?? 7,
      title: ISSUE_DETAIL.title,
      user: { login: opts.author ?? SENDER },
    },
    label: { name: labelName },
    repository: { full_name: REPO },
    ...(sender !== null ? { sender: { login: sender, type: 'User' } } : {}),
  };
}

function post(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

type MockRoute = {
  status?: number;
  body: unknown;
  throws?: boolean;
  headers?: Record<string, string>;
};

function ghMock(routes: Record<string, MockRoute>): {
  impl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const route = routes[url.pathname];
    if (route?.throws === true) throw new TypeError('fetch failed');
    const status = route?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => route?.headers?.[name.toLowerCase()] ?? null },
      json: async () => route?.body ?? {},
      text: async () => JSON.stringify(route?.body ?? {}),
    };
  };
  return { impl, calls };
}

function defaultRoutes(overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    [ISSUE_PATH]: { body: ISSUE_DETAIL },
    [LABELS_PATH]: { body: LABELS_FULL },
    [permissionPath(SENDER)]: { body: permissionBody(SENDER, 'admin', 'admin') },
    ...overrides,
  };
}

async function createWebhookToken(
  app: Hono,
  teamId: string,
  name = 'hook',
): Promise<{ id: string; plaintext: string }> {
  const res = await req(app, 'POST', `/api/teams/${teamId}/webhook-tokens`, { name });
  if (res.status !== 201) throw new Error(`createWebhookToken: ${res.status}`);
  return (await res.json()) as { id: string; plaintext: string };
}

async function postGithubProject(app: Hono): Promise<string> {
  const res = await req(app, 'POST', '/api/projects', {
    name: 'alpha',
    kind: 'github',
    githubRepo: REPO,
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

let s: TestServer;
let routes: Record<string, MockRoute>;
let mock: { impl: FetchLike; calls: string[] };
let token: { id: string; plaintext: string };
let projectId: string;

beforeEach(async () => {
  resetWebhookDeliveryWindow();
  routes = defaultRoutes();
  mock = ghMock(routes);
  s = bootServer({ githubFetch: mock.impl });
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
  );
  projectId = await postGithubProject(s.app);
  s.db
    .insert((await import('../src/db/schema.js')).agent)
    .values({
      id: 'agent-wh-1',
      teamId: s.team.id,
      displayName: 'agent-wh-1',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const chiefId = `chief-${s.user.id}-${s.team.id}`;
  s.db
    .insert((await import('../src/db/schema.js')).chief)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      agentId: 'agent-wh-1',
      charter: '',
      watches: [],
      wakes: [],
      createdAt: Date.now(),
    })
    .run();
  token = await createWebhookToken(s.app, s.team.id);
});

afterEach(() => {
  s.dispose();
});

const DELIVERY = 'deadbeef-delivery-1';

describe('the A created full chain (request/storage/dispatch, three tracer segments)', () => {
  test('A1/A2 the trigger label -> 202 created; todo + the chief dispatch row + lastUsedAt, values in all three segments', async () => {
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(202);
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('created');
    expect(body.deliveryId).toBe(DELIVERY);
    expect(body.todoId).toBeDefined();
    expect(body.threadId?.startsWith('chief-')).toBe(true);
    const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, body.todoId!)).get();
    expect(todoRow?.sourceKind).toBe('github-issue');
    expect(todoRow?.sourceRef).toBe(`github:${REPO}#7`);
    expect(todoRow?.phase).toBe('todo');
    const tokenRow = s.db
      .select()
      .from(webhookTokenTable)
      .where(eq(webhookTokenTable.id, token.id))
      .get();
    expect(tokenRow?.lastUsedAt).not.toBeNull();
    const threadRow = s.db
      .select()
      .from(chiefThreadTable)
      .where(eq(chiefThreadTable.id, body.threadId!))
      .get();
    expect(threadRow).toBeDefined();
    const messages = s.db
      .select()
      .from(chiefMessageTable)
      .where(eq(chiefMessageTable.threadId, body.threadId!))
      .all();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('正文：贴 cairn 标签自动建任务。');
    const steps = s.db.select().from(stepTable).where(eq(stepTable.buildId, body.threadId!)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
  });
});

describe('B two-layer dedupe', () => {
  test('B1 the same delivery delivered twice within the 60s window -> duplicate, no double creation', async () => {
    const first = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(webhookReceiverResponseSchema.parse(await first.json()).result).toBe('created');
    const second = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await second.json());
    expect(body.result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
    expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
  });

  test('B2 the same issue with a different delivery (replay) -> duplicate (the sourceRef persistent gate)', async () => {
    await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const replay = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': 'different-delivery-2',
    });
    const body = webhookReceiverResponseSchema.parse(await replay.json());
    expect(body.result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
  });
});

describe('C ignored / noop (defense against GitHub retry storms)', () => {
  test('C1 a ping event -> 202 ignored, zero side effects, zero outbound', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { zen: 'Keep it simple.' },
      {
        'x-github-event': 'ping',
        'x-github-delivery': DELIVERY,
      },
    );
    expect(res.status).toBe(202);
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('ignored');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  test('C2 an unknown event (push) -> 202 ignored', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { ref: 'refs/heads/main' },
      { 'x-github-event': 'push', 'x-github-delivery': DELIVERY },
    );
    expect(webhookReceiverResponseSchema.parse(await res.json()).result).toBe('ignored');
  });

  test('C3 not labeled / not the trigger label -> 202 ignored, zero outbound', async () => {
    const opened = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { action: 'opened', issue: { number: 7 }, repository: { full_name: REPO } },
      { 'x-github-event': 'issues', 'x-github-delivery': 'd-opened' },
    );
    expect(webhookReceiverResponseSchema.parse(await opened.json()).result).toBe('ignored');
    const otherLabel = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      labeledPayload('bug'),
      {
        'x-github-event': 'issues',
        'x-github-delivery': 'd-other',
      },
    );
    expect(webhookReceiverResponseSchema.parse(await otherLabel.json()).result).toBe('ignored');
    expect(mock.calls).toHaveLength(0);
  });

  test('C4 a malformed payload (missing issue.number) -> 202 ignored (not 400)', async () => {
    const res = await post(
      s.app,
      `/api/webhook/github/${token.plaintext}`,
      { action: 'labeled', repository: { full_name: REPO } },
      { 'x-github-event': 'issues', 'x-github-delivery': 'd-malformed' },
    );
    expect(res.status).toBe(202);
    expect(webhookReceiverResponseSchema.parse(await res.json()).result).toBe('ignored');
  });
});

describe('D misconfigured / upstream transient failure', () => {
  test('D1 a repo with no mapped project -> 202 misconfigured', async () => {
    await req(s.app, 'DELETE', `/api/projects/${await postGithubProject(s.app)}`);
    const projects = s.db
      .select()
      .from((await import('../src/db/schema.js')).project)
      .all();
    for (const p of projects) {
      await req(s.app, 'DELETE', `/api/projects/${p.id}`);
    }
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('misconfigured');
    expect(mock.calls).toHaveLength(0);
  });

  test('D2 GitHub not connected -> 202 misconfigured', async () => {
    s.db
      .delete((await import('../src/db/schema.js')).githubConnection)
      .where(eq((await import('../src/db/schema.js')).githubConnection.teamId, s.team.id))
      .run();
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    const body = webhookReceiverResponseSchema.parse(await res.json());
    expect(body.result).toBe('misconfigured');
  });

  test('D3 an upstream transient failure (the issue detail 502 family) -> 502 passed through', async () => {
    const failing = ghMock(defaultRoutes({ [ISSUE_PATH]: { status: 500, body: {} } }));
    s.dispose();
    s = bootServer({ githubFetch: failing.impl });
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    await postGithubProject(s.app);
    token = await createWebhookToken(s.app, s.team.id);
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(502);
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });
});

describe('E the token surface', () => {
  test('E1 a wrong token -> 401 {error} same shape, lastUsedAt unwritten, zero outbound', async () => {
    const res = await post(s.app, '/api/webhook/github/pacm_wh_wrong_value', labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    const tokenRow = s.db
      .select()
      .from(webhookTokenTable)
      .where(eq(webhookTokenTable.id, token.id))
      .get();
    expect(tokenRow?.lastUsedAt).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  test('E2 a delivery after revocation -> 401', async () => {
    const del = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${token.id}`);
    expect(del.status).toBe(204);
    const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, labeledPayload(), {
      'x-github-event': 'issues',
      'x-github-delivery': DELIVERY,
    });
    expect(res.status).toBe(401);
  });

  test('E3 token mgmt: one-time plaintext on create + masked in the list + deletion 404 / cross-team', async () => {
    const created = await createWebhookToken(s.app, s.team.id, 'second');
    expect(created.plaintext).toMatch(/^cairn_wh_[0-9a-f]{36}$/);
    const list = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/webhook-tokens`)
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain(created.plaintext);
    expect(list.every((row) => typeof row.masked === 'string')).toBe(true);
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/nope`)).status).toBe(
      404,
    );
    expect(
      (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${created.id}`)).status,
    ).toBe(204);
    expect(
      (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/webhook-tokens/${created.id}`)).status,
    ).toBe(404);
  });

  test('E3 the requireTeam gate: a wrong team id -> 404', async () => {
    expect((await req(s.app, 'GET', '/api/teams/other-team/webhook-tokens')).status).toBe(404);
    expect(
      (await req(s.app, 'POST', '/api/teams/other-team/webhook-tokens', { name: 'x' })).status,
    ).toBe(404);
  });
});

describe('F the token-auth exempt surface (CAIRN_TOKEN on)', () => {
  function bootAuthed(): TestServer {
    const authed = bootServer({ authToken: 'gate-token', githubFetch: mock.impl });
    upsertGithubConnection(
      { db: authed.db, box: authed.secretBox },
      { teamId: authed.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    return authed;
  }

  test('F1 the receiver is reachable without a Bearer (its own token gate works as usual: a wrong value 401)', async () => {
    const authed = bootAuthed();
    const { createWebhookToken: createRow } = await import('../src/services/webhook-tokens.js');
    const authedToken = createRow({ db: authed.db }, { teamId: authed.team.id, name: 'authed' });
    const res = await post(
      authed.app,
      `/api/webhook/github/${authedToken.plaintext}`,
      labeledPayload(),
      {
        'x-github-event': 'ping',
        'x-github-delivery': DELIVERY,
      },
    );
    expect(res.status).toBe(202);
    const wrong = await post(
      authed.app,
      '/api/webhook/github/wrong',
      {},
      {
        'x-github-event': 'ping',
      },
    );
    expect(wrong.status).toBe(401);
    authed.dispose();
  });

  test('F2 the token mgmt endpoints still want a Bearer (no credential 401, the gate shape)', async () => {
    const authed = bootAuthed();
    expect(
      (await req(authed.app, 'GET', `/api/teams/${authed.team.id}/webhook-tokens`)).status,
    ).toBe(401);
    expect(
      (await req(authed.app, 'POST', `/api/teams/${authed.team.id}/webhook-tokens`, {})).status,
    ).toBe(401);
    authed.dispose();
  });

  test('F3 the /api/webhookfoo segment boundary is not exempt -> 401', async () => {
    const authed = bootAuthed();
    const res = await post(authed.app, '/api/webhookfoo/x', {});
    expect(res.status).toBe(401);
    authed.dispose();
  });
});

describe('direct service-surface call (delivery header absent + silent logger)', () => {
  test('no delivery header -> not entered into the dedupe ledger, still triaged normally', async () => {
    const response = await receiveGithubWebhook(
      {
        db: s.db,
        hub: s.hub,
        user: s.user,
        box: s.secretBox,
        ...(mock.impl ? { githubFetch: mock.impl } : {}),
      },
      { token: token.plaintext, event: 'ping', deliveryId: undefined, body: {} },
    );
    expect(response.result).toBe('ignored');
  });
});

describe('#1406 the webhook and another import path race on the same issue', () => {
  test('a webhook delivery and a direct import arrive together: one card, the later path 409s', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const gated: FetchLike = async (input, init) => {
      if (new URL(String(input)).pathname === ISSUE_PATH) await gate;
      return mock.impl(input, init);
    };
    const projectRow = s.db
      .select()
      .from(projectTable)
      .where(eq(projectTable.githubRepo, REPO))
      .get();
    if (projectRow === undefined) throw new Error('project missing');
    const deps = { db: s.db, hub: s.hub, user: s.user, box: s.secretBox, githubFetch: gated };
    const hook = receiveGithubWebhook(deps, {
      token: token.plaintext,
      event: 'issues',
      deliveryId: 'race-delivery-1',
      body: labeledPayload(),
    });
    const direct = importGithubIssue(deps, projectRow, 7);
    setTimeout(open, 20);
    const [hookResult, directResult] = await Promise.allSettled([hook, direct]);
    const rows = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.sourceRef, `github:${REPO}#7`))
      .all();
    expect(rows).toHaveLength(1);
    expect(hookResult.status).toBe('fulfilled');
    const hookBody = (hookResult as PromiseFulfilledResult<{ result: string }>).value;
    if (hookBody.result === 'created') {
      expect(directResult.status).toBe('rejected');
      const reason = (directResult as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(HttpError);
      expect((reason as HttpError).status).toBe(409);
      expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
    } else {
      expect(hookBody.result).toBe('duplicate');
      expect(directResult.status).toBe('fulfilled');
      expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(0);
    }
  });
});

const REFUSED_LOG = 'github webhook import refused';
const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';
const CAP_DETAIL = `project at the in-flight cap (${ISSUE_INTAKE_IN_FLIGHT_CAP} open github-issue tasks)`;

type LogLine = Record<string, unknown>;

async function deliverHttp(
  body: unknown,
  deliveryId: string,
): Promise<{ status: number; body: ReturnType<typeof webhookReceiverResponseSchema.parse> }> {
  const res = await post(s.app, `/api/webhook/github/${token.plaintext}`, body, {
    'x-github-event': 'issues',
    'x-github-delivery': deliveryId,
  });
  const json: unknown = await res.json();
  return {
    status: res.status,
    body: (res.status === 202 ? webhookReceiverResponseSchema.parse(json) : json) as ReturnType<
      typeof webhookReceiverResponseSchema.parse
    >,
  };
}

function captureLogger(): { logger: pino.Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        lines.push(JSON.parse(line) as LogLine);
      },
    },
  );
  return { logger, lines };
}

async function deliverDirect(body: unknown, deliveryId: string, fetchImpl: FetchLike = mock.impl) {
  const { logger, lines } = captureLogger();
  const response = await receiveGithubWebhook(
    { ...s.svc, box: s.secretBox, githubFetch: fetchImpl, logger },
    { token: token.plaintext, event: 'issues', deliveryId, body },
  );
  return { response, lines };
}

const refusals = (lines: LogLine[]) => lines.filter((l) => l.msg === REFUSED_LOG);
const permissionReads = () => mock.calls.filter((p) => p.endsWith('/permission'));
const issueReads = () => mock.calls.filter((p) => /\/issues\/\d+$/.test(p));
const issueTasks = () =>
  s.db.select().from(todoTable).where(eq(todoTable.sourceKind, 'github-issue')).all();

let taskSeq = 900;

function insertIssueTask(
  n: number,
  phase: Phase,
  sourceKind: TodoSourceKind = 'github-issue',
): void {
  taskSeq += 1;
  s.db
    .insert(todoTable)
    .values({
      id: `todo-wh-${taskSeq}`,
      teamId: s.team.id,
      projectId,
      title: `issue ${n}`,
      spec: '',
      phase,
      phaseAt: Date.now(),
      seqNum: taskSeq,
      sourceKind,
      sourceRef: `github:${REPO}#${n}`,
      createdBy: s.user.id,
    })
    .run();
}

function gatedFetch(paths: string[]): { impl: FetchLike; open: () => void } {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const impl: FetchLike = async (input, init) => {
    if (paths.includes(new URL(String(input)).pathname)) await gate;
    return mock.impl(input, init);
  };
  return { impl, open };
}

function listForPoller(n: number, labeler: string): void {
  routes[`/repos/${REPO}/issues`] = {
    body: [
      {
        number: n,
        title: `issue ${n}`,
        state: 'open',
        labels: [{ name: 'ready-for-agent', color: '0E8A16' }],
        created_at: '2026-10-21T00:00:00Z',
        body: null,
      },
    ],
  };
  routes[`/repos/${REPO}/issues/${n}`] = { body: { ...ISSUE_DETAIL, number: n } };
  routes[`/repos/${REPO}/issues/${n}/events`] = {
    body: [
      {
        id: 1,
        actor: { login: labeler, id: 1, type: 'User' },
        event: 'labeled',
        commit_id: null,
        created_at: '2026-10-21T00:00:01Z',
        label: { name: 'ready-for-agent', color: '0E8A16' },
        performed_via_github_app: null,
      },
    ],
  };
}

describe('#1459 W the labeler (sender) is checked per D5', () => {
  test('W1 an external author auto-labeled via the issue template (sender = the author, permission 404) -> 202 ignored, no import, no issue read, logged', async () => {
    routes[permissionPath('outsider')] = { status: 404, body: { message: 'Not Found' } };
    const payload = labeledPayload('cairn', { sender: 'outsider', author: 'outsider' });
    const http = await deliverHttp(payload, 'w1-http');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w1-http',
      detail: SENDER_REFUSED_DETAIL,
    });
    expect(permissionReads()).toEqual([permissionPath('outsider')]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
    const direct = await deliverDirect(payload, 'w1-direct');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({
        deliveryId: 'w1-direct',
        issue: 7,
        sender: 'outsider',
        reason: 'sender-below-triage',
        detail: `outsider is below triage on ${REPO}`,
      }),
    ]);
    expect(permissionReads()).toHaveLength(1);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W2 the labeler has only read (role read, triage false) -> 202 ignored, no import', async () => {
    routes[permissionPath('reader')] = { body: permissionBody('reader', 'read', 'read', false) };
    const http = await deliverHttp(labeledPayload('cairn', { sender: 'reader' }), 'w2');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w2',
      detail: SENDER_REFUSED_DETAIL,
    });
    const direct = await deliverDirect(labeledPayload('cairn', { sender: 'reader' }), 'w2-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ sender: 'reader', reason: 'sender-below-triage' }),
    ]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test.each([
    ['triage', permissionBody('labeler', 'read', 'triage')],
    ['write', permissionBody('labeler', 'write', 'write')],
    ['maintain', permissionBody('labeler', 'write', 'maintain')],
    ['admin', permissionBody('labeler', 'admin', 'admin')],
    ['custom role built on triage', permissionBody('labeler', 'read', 'issue-wrangler', true)],
  ])('W3 打标人 %s → 202 created（先读 permission 再导入）', async (_role, body) => {
    routes[permissionPath('labeler')] = { body };
    const http = await deliverHttp(labeledPayload('cairn', { sender: 'labeler' }), 'w3');
    expect(http.status).toBe(202);
    expect(http.body.result).toBe('created');
    expect(issueTasks()).toHaveLength(1);
    expect(permissionReads()).toEqual([permissionPath('labeler')]);
    expect(mock.calls.indexOf(permissionPath('labeler'))).toBeLessThan(
      mock.calls.indexOf(ISSUE_PATH),
    );
  });

  test.each([
    ['403', { status: 403, body: { message: 'Forbidden' } }],
    ['500', { status: 500, body: {} }],
    ['502', { status: 502, body: {} }],
    ['network error / timeout', { body: null, throws: true }],
    ['malformed 200 body', { body: { role_name: 'admin' } }],
  ] satisfies Array<[string, MockRoute]>)(
    'W4 permission 读失败（%s）→ 202 ignored，不导入，记日志，不缓存',
    async (_case, route) => {
      routes[permissionPath(SENDER)] = route;
      const http = await deliverHttp(labeledPayload(), 'w4-http');
      expect(http.status).toBe(202);
      expect(http.body).toEqual({
        result: 'ignored',
        deliveryId: 'w4-http',
        detail: SENDER_REFUSED_DETAIL,
      });
      const direct = await deliverDirect(labeledPayload(), 'w4-direct');
      expect(direct.response.result).toBe('ignored');
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({
          sender: SENDER,
          reason: 'permission-unreadable',
          detail: `permission of ${SENDER} on ${REPO} unreadable`,
        }),
      ]);
      expect(permissionReads()).toHaveLength(2);
      expect(issueReads()).toHaveLength(0);
      expect(issueTasks()).toHaveLength(0);
    },
  );

  const RESET_AT = new Date(1_800_000_600_000).toISOString();
  test.each([
    ['429 without headers', { status: 429, body: { message: 'API rate limit exceeded' } }, null],
    [
      '429 with retry-after 60',
      {
        status: 429,
        headers: { 'retry-after': '60' },
        body: { message: 'API rate limit exceeded' },
      },
      'retry-after',
    ],
    [
      '403 with x-ratelimit-remaining 0 and x-ratelimit-reset',
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000600' },
        body: { message: 'API rate limit exceeded for user ID 1.' },
      },
      RESET_AT,
    ],
    [
      '403 secondary limit, message only',
      {
        status: 403,
        body: {
          message:
            'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
        },
      },
      null,
    ],
  ] satisfies Array<[string, MockRoute, string | null]>)(
    'W4b permission 读遇限流（%s）→ 202 ignored rate-limited，不导入，记日志带重置时刻，不缓存，限流过后照判',
    async (_case, route, reset) => {
      routes[permissionPath(SENDER)] = route;
      const http = await deliverHttp(labeledPayload(), 'w4b-http');
      expect(http.status).toBe(202);
      expect(http.body).toEqual({
        result: 'ignored',
        deliveryId: 'w4b-http',
        detail: SENDER_REFUSED_DETAIL,
      });
      const direct = await deliverDirect(labeledPayload(), 'w4b-direct');
      expect(direct.response).toEqual({
        result: 'ignored',
        deliveryId: 'w4b-direct',
        detail: SENDER_REFUSED_DETAIL,
      });
      const prefix = `github rate limited reading the permission of ${SENDER} on ${REPO}`;
      const [line] = refusals(direct.lines);
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({
          deliveryId: 'w4b-direct',
          sender: SENDER,
          reason: 'rate-limited',
          status: route.status,
          resetAt: reset === null ? null : reset === 'retry-after' ? expect.any(String) : reset,
        }),
      ]);
      if (reset === null) expect(line?.detail).toBe(prefix);
      else if (reset === 'retry-after') {
        expect(line?.detail).toMatch(
          new RegExp(`^${prefix} \\(resets at \\d{4}-\\d\\d-\\d\\dT[^)]+Z\\)$`),
        );
      } else expect(line?.detail).toBe(`${prefix} (resets at ${reset})`);
      expect(permissionReads()).toHaveLength(2);
      expect(issueReads()).toHaveLength(0);
      expect(issueTasks()).toHaveLength(0);
      routes[permissionPath(SENDER)] = { body: permissionBody(SENDER, 'admin', 'admin') };
      const after = await deliverHttp(labeledPayload(), 'w4b-after');
      expect(after.body.result).toBe('created');
      expect(permissionReads()).toHaveLength(3);
      expect(issueTasks()).toHaveLength(1);
    },
  );

  test('W5a the team has no GitHub connection -> 202 misconfigured, zero outbound (no anonymous read), logged', async () => {
    s.db.delete(githubConnectionTable).where(eq(githubConnectionTable.teamId, s.team.id)).run();
    const http = await deliverHttp(labeledPayload(), 'w5a');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'misconfigured',
      deliveryId: 'w5a',
      detail: 'github connection not found',
    });
    const direct = await deliverDirect(labeledPayload(), 'w5a-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'no-github-connection' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W5b the connection token does not decrypt (broken ciphertext) -> 202 misconfigured (not 500), zero outbound, logged', async () => {
    s.db
      .update(githubConnectionTable)
      .set({ accessTokenCipher: 'not-a-sealed-token' })
      .where(eq(githubConnectionTable.teamId, s.team.id))
      .run();
    const http = await deliverHttp(labeledPayload(), 'w5b');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'misconfigured',
      deliveryId: 'w5b',
      detail: 'github token unreadable',
    });
    const direct = await deliverDirect(labeledPayload(), 'w5b-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'token-unreadable' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W12a the payload has no sender -> 202 ignored, zero outbound, logged', async () => {
    const payload = labeledPayload('cairn', { sender: null });
    const http = await deliverHttp(payload, 'w12a');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w12a',
      detail: 'event has no sender',
    });
    const direct = await deliverDirect(payload, 'w12a-direct');
    expect(refusals(direct.lines)).toEqual([expect.objectContaining({ reason: 'no-sender' })]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W12b the sender is a ghost (the placeholder account GitHub uses when it cannot resolve a person, permission 404) -> 202 ignored', async () => {
    routes[permissionPath('ghost')] = { status: 404, body: { message: 'Not Found' } };
    const http = await deliverHttp(labeledPayload('cairn', { sender: 'ghost' }), 'w12b');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'w12b',
      detail: SENDER_REFUSED_DETAIL,
    });
    const direct = await deliverDirect(labeledPayload('cairn', { sender: 'ghost' }), 'w12b-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ sender: 'ghost', reason: 'sender-below-triage' }),
    ]);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W13 a webhook-imported card still has createdBy = the seed user (untouched by the poller close reconcile)', async () => {
    const http = await deliverHttp(labeledPayload(), 'w13');
    expect(http.body.result).toBe('created');
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, http.body.todoId!)).get();
    expect(row?.createdBy).toBe(s.user.id);
  });

  test('W14a two deliveries from the same sender (different issues): permission is read once (the same cache as the poller)', async () => {
    routes[`/repos/${REPO}/issues/8`] = { body: { ...ISSUE_DETAIL, number: 8 } };
    const first = await deliverHttp(labeledPayload('cairn', { issue: 7 }), 'w14a-1');
    const second = await deliverHttp(labeledPayload('cairn', { issue: 8 }), 'w14a-2');
    expect([first.body.result, second.body.result]).toEqual(['created', 'created']);
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
  });

  test('W14b the poller reuses the answer the webhook read: claiming an issue from the same labeler reads no permission again', async () => {
    const hook = await deliverHttp(labeledPayload(), 'w14b');
    expect(hook.body.result).toBe('created');
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
    listForPoller(8, SENDER);
    s.db
      .update(projectTable)
      .set({ autonomy: { enabled: true, quietMinutes: 0, cooldownMinutes: 0, dailyBudgetUsd: 0 } })
      .where(eq(projectTable.id, projectId))
      .run();
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: mock.impl });
    const tally = await intake.sweep();
    expect(tally?.imported).toBe(1);
    expect(issueTasks().map((t) => t.sourceRef)).toEqual([`github:${REPO}#7`, `github:${REPO}#8`]);
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
  });
});

describe('#1459 W counted toward the in-flight cap', () => {
  test('W6 the project is at its cap (todo / building / failed, three cards) -> 202 ignored, zero outbound, logged', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    insertIssueTask(103, 'failed');
    const http = await deliverHttp(labeledPayload(), 'w6');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({ result: 'ignored', deliveryId: 'w6', detail: CAP_DETAIL });
    const direct = await deliverDirect(labeledPayload(), 'w6-direct');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ issue: 7, reason: 'at-cap' }),
    ]);
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(ISSUE_INTAKE_IN_FLIGHT_CAP);
  });

  test('W6b done / closed cards and self-created issue cards do not count -> 202 created', async () => {
    insertIssueTask(101, 'done');
    insertIssueTask(102, 'closed');
    insertIssueTask(103, 'building', 'github-issue-self');
    const http = await deliverHttp(labeledPayload(), 'w6b');
    expect(http.body.result).toBe('created');
  });

  test('W8 one slot below the cap, two deliveries arrive together (batch labeling) -> only one imported, the other 202 ignored at cap', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    routes[`/repos/${REPO}/issues/8`] = { body: { ...ISSUE_DETAIL, number: 8 } };
    const gated = gatedFetch([ISSUE_PATH, `/repos/${REPO}/issues/8`]);
    const a = deliverDirect(labeledPayload('cairn', { issue: 7 }), 'w8-a', gated.impl);
    const b = deliverDirect(labeledPayload('cairn', { issue: 8 }), 'w8-b', gated.impl);
    setTimeout(gated.open, 30);
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.response.result).sort()).toEqual(['created', 'ignored']);
    const refused = results.find((r) => r.response.result === 'ignored');
    expect(refused?.response.detail).toBe(CAP_DETAIL);
    expect(refusals(refused?.lines ?? [])).toEqual([expect.objectContaining({ reason: 'at-cap' })]);
    expect(issueTasks()).toHaveLength(ISSUE_INTAKE_IN_FLIGHT_CAP);
  });
});

describe('#1459 W concurrency and redelivery', () => {
  test('W7 the webhook and the poller import the same issue simultaneously -> one card (the other path 409s)', async () => {
    listForPoller(7, SENDER);
    const gated = gatedFetch([ISSUE_PATH]);
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: gated.impl });
    const hook = deliverDirect(labeledPayload(), 'w7', gated.impl);
    const sweep = intake.sweep();
    setTimeout(gated.open, 30);
    const [hookResult, tally] = await Promise.all([hook, sweep]);
    expect(issueTasks()).toHaveLength(1);
    expect(['created', 'duplicate']).toContain(hookResult.response.result);
    const webhookImported = hookResult.response.result === 'created' ? 1 : 0;
    expect((tally?.imported ?? 0) + webhookImported).toBe(1);
    expect(s.db.select().from(chiefThreadTable).all()).toHaveLength(1);
  });

  test('W9 a rejected delivery redelivered (same X-GitHub-Delivery): 202 duplicate within the window, still judged 202 ignored outside it, never imported', async () => {
    routes[permissionPath('outsider')] = { status: 404, body: { message: 'Not Found' } };
    const payload = labeledPayload('cairn', { sender: 'outsider', author: 'outsider' });
    const first = await deliverHttp(payload, 'w9');
    expect(first.status).toBe(202);
    expect(first.body.result).toBe('ignored');
    const inWindow = await deliverHttp(payload, 'w9');
    expect(inWindow.status).toBe(202);
    expect(inWindow.body.result).toBe('duplicate');
    resetWebhookDeliveryWindow();
    const later = await deliverHttp(payload, 'w9');
    expect(later.status).toBe(202);
    expect(later.body).toEqual(first.body);
    expect(issueTasks()).toHaveLength(0);
  });
});

describe('#1459 round 2 W legacy malformed githubRepo', () => {
  test.each([
    ['../user', '~proj-dotdot-owner'],
    ['owner/..', '~proj-dotdot-repo'],
  ])(
    'W17 项目存的 githubRepo 是 %s（含 . / .. 段）→ 202 misconfigured，零出站，不进权限缓存，记日志',
    async (githubRepo, id) => {
      s.db
        .insert(projectTable)
        .values({ id, name: id, teamId: s.team.id, repoKind: 'github', githubRepo })
        .run();
      const payload = { ...labeledPayload(), repository: { full_name: githubRepo } };
      const http = await deliverHttp(payload, `w17-http-${id}`);
      expect(http.status).toBe(202);
      expect(http.body.result).toBe('misconfigured');
      const direct = await deliverDirect(payload, `w17-direct-${id}`);
      expect(direct.response.result).toBe('misconfigured');
      expect(refusals(direct.lines)).toEqual([
        expect.objectContaining({ projectId: id, reason: 'malformed-repo' }),
      ]);
      expect(mock.calls).toEqual([]);
      expect(issueTasks()).toHaveLength(0);
    },
  );
});

describe('#1459 round 2 W audit rows', () => {
  test('W18 the orchestration throws after a successful import (the chief has no bound agent, 409) -> the card exists, the import accepted audit row is still written', async () => {
    s.db.update(chiefTable).set({ agentId: null }).where(eq(chiefTable.teamId, s.team.id)).run();
    const { logger, lines } = captureLogger();
    const run = receiveGithubWebhook(
      { ...s.svc, box: s.secretBox, githubFetch: mock.impl, logger },
      { token: token.plaintext, event: 'issues', deliveryId: 'w18', body: labeledPayload() },
    );
    await expect(run).rejects.toMatchObject({ status: 409 });
    const tasks = issueTasks();
    expect(tasks).toHaveLength(1);
    expect(lines.filter((l) => l.msg === 'github webhook import accepted')).toEqual([
      expect.objectContaining({ deliveryId: 'w18', todoId: tasks[0]?.id, sender: SENDER }),
    ]);
  });
});

describe('#1459 round 2 W the live in-flight count and the import 404', () => {
  test('W15 the webhook import is still waiting on GitHub while the poller sweeps: one slot below the cap, the poller counts the in-flight one, reads no list, claims nothing', async () => {
    insertIssueTask(101, 'todo');
    insertIssueTask(102, 'building');
    listForPoller(8, SENDER);
    const gated = gatedFetch([ISSUE_PATH]);
    const hook = deliverDirect(labeledPayload(), 'w15', gated.impl);
    await vi.waitFor(() => expect(importsInFlightFor(projectId)).toBe(1));
    const intake = createIssueIntake({ ...s.svc, box: s.secretBox }, { githubFetch: mock.impl });
    const tally = await intake.sweep();
    expect(tally?.imported).toBe(0);
    expect(mock.calls.filter((p) => p === `/repos/${REPO}/issues`)).toHaveLength(0);
    gated.open();
    const hookResult = await hook;
    expect(hookResult.response.result).toBe('created');
    expect(
      issueTasks()
        .map((t) => t.sourceRef)
        .sort(),
    ).toEqual([`github:${REPO}#101`, `github:${REPO}#102`, `github:${REPO}#7`].sort());
  });

  test('W16 the team GitHub connection is deleted while the permission read awaits -> the import own 404 becomes 202 misconfigured, no card created', async () => {
    const dropping: FetchLike = async (input, init) => {
      if (new URL(String(input)).pathname === permissionPath(SENDER)) {
        s.db.delete(githubConnectionTable).where(eq(githubConnectionTable.teamId, s.team.id)).run();
      }
      return mock.impl(input, init);
    };
    const direct = await deliverDirect(labeledPayload(), 'w16', dropping);
    expect(direct.response).toEqual({
      result: 'misconfigured',
      deliveryId: 'w16',
      detail: 'github connection not found',
    });
    expect(permissionReads()).toEqual([permissionPath(SENDER)]);
    expect(issueReads()).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
  });
});

describe('#1459 round 2 W review findings', () => {
  test('W19 during import GitHub says the issue does not exist (detail read 404, the connection intact) -> 202 misconfigured saying the issue is unreadable, not that the connection is gone, logged', async () => {
    routes[ISSUE_PATH] = { status: 404, body: { message: 'Not Found' } };
    const direct = await deliverDirect(labeledPayload(), 'w19');
    expect(direct.response).toEqual({
      result: 'misconfigured',
      deliveryId: 'w19',
      detail: `issue ${REPO}#7 not found on GitHub (or not visible to the team token)`,
    });
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ deliveryId: 'w19', issue: 7, reason: 'issue-not-found' }),
    ]);
    expect(issueTasks()).toHaveLength(0);
  });

  test.each([
    ['..'],
    ['.'],
    ['a/b'],
    [''],
    ['alice.acme'],
    ['_alice'],
    ['-alice'],
    ['alice_'],
    ['a'.repeat(40)],
    [`${'a'.repeat(31)}_abcdefgh`],
    [`${'a'.repeat(40)}[bot]`],
  ])('W20 sender 的 login 不是 GitHub 账号名（%j）→ 202 ignored，零出站，记日志', async (login) => {
    const payload = { ...labeledPayload(), sender: { login, type: 'User' } };
    const direct = await deliverDirect(payload, 'w20');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: login === '' ? 'no-sender' : 'sender-malformed' }),
    ]);
    expect(mock.calls).toEqual([]);
    expect(issueTasks()).toHaveLength(0);
  });

  test('W20b a bot account (login with [bot]) still gets its permission read', async () => {
    routes[`/repos/${REPO}/collaborators/octo-helper%5Bbot%5D/permission`] = {
      status: 404,
      body: { message: 'Not Found' },
    };
    const payload = { ...labeledPayload(), sender: { login: 'octo-helper[bot]', type: 'Bot' } };
    const direct = await deliverDirect(payload, 'w20b');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({ reason: 'sender-below-triage' }),
    ]);
    expect(permissionReads()).toHaveLength(1);
  });

  test.each([
    ['alice_acme', 'User'],
    ['mona-cat_octo', 'User'],
    ['octo_admin', 'User'],
    [`${'a'.repeat(30)}_abcdefgh`, 'User'],
    ['octo-builder[bot]', 'Bot'],
  ])(
    'W21 GitHub 认的账号名（%s：EMU 托管账号带下划线与短码、bot 带 [bot]）→ 读权限，够 triage 就导入',
    async (login, type) => {
      routes[`/repos/${REPO}/collaborators/${encodeURIComponent(login)}/permission`] = {
        body: permissionBody(login, 'admin', 'admin'),
      };
      const payload = { ...labeledPayload(), sender: { login, type } };
      const direct = await deliverDirect(payload, 'w21');
      expect(direct.response.result).toBe('created');
      expect(refusals(direct.lines)).toEqual([]);
      expect(permissionReads()).toHaveLength(1);
      expect(issueTasks()).toHaveLength(1);
    },
  );
});

describe('#1459 round 3 W the sender in logs', () => {
  test('W22 a very long sender on sender-malformed (the payload has no length cap) -> the log line records only the first 64 characters and the total length', async () => {
    const login = `${'.'.repeat(1000)}/x`;
    const payload = { ...labeledPayload(), sender: { login, type: 'User' } };
    const direct = await deliverDirect(payload, 'w22');
    expect(direct.response.result).toBe('ignored');
    expect(refusals(direct.lines)).toEqual([
      expect.objectContaining({
        reason: 'sender-malformed',
        sender: login.slice(0, 64),
        senderLength: login.length,
      }),
    ]);
    expect(mock.calls).toEqual([]);
  });
});

describe('#1491 W the trigger gate', () => {
  function setAutonomy(over: Record<string, unknown>): void {
    s.db
      .update(projectTable)
      .set({
        autonomy: {
          enabled: true,
          quietMinutes: 10,
          cooldownMinutes: 15,
          dailyBudgetUsd: 5,
          ...over,
        },
      })
      .where(eq(projectTable.id, projectId))
      .run();
  }

  function intakeState() {
    return s.db
      .select()
      .from(autonomyStateTable)
      .where(eq(autonomyStateTable.projectId, projectId))
      .get();
  }

  test('W-gate1 the project turned off background auto tasks -> 202 ignored, zero outbound, no card, the reason queryable', async () => {
    setAutonomy({ enabled: false });
    const http = await deliverHttp(labeledPayload(), 'wg1');
    expect(http.status).toBe(202);
    expect(http.body).toEqual({
      result: 'ignored',
      deliveryId: 'wg1',
      detail: 'project autonomy gate: disabled',
    });
    expect(mock.calls).toHaveLength(0);
    expect(issueTasks()).toHaveLength(0);
    expect(intakeState()?.lastBlockedReason).toBe('disabled');
  });

  test('W-gate2 the day budget is full -> 202 ignored; an unreadable spend claims nothing either', async () => {
    setAutonomy({});
    insertIssueTask(901, 'done');
    const todoId = `todo-wh-${taskSeq}`;
    s.db
      .insert(buildTableForGate)
      .values({
        id: 'b-gate',
        todoId,
        withPlan: false,
        triggerSource: 'chief',
        createdAt: Date.now(),
      })
      .run();
    s.db.insert(tokenUsageTable).values({ buildId: 'b-gate', model: 'a/m', costTotal: 5 }).run();
    const full = await deliverHttp(labeledPayload(), 'wg2');
    expect(full.body).toMatchObject({ result: 'ignored', detail: 'project autonomy gate: budget' });
    s.db.run(sql`ALTER TABLE token_usage RENAME TO token_usage_gone`);
    const unreadable = await deliverHttp(labeledPayload(), 'wg2b');
    expect(unreadable.body).toMatchObject({
      result: 'ignored',
      detail: 'project autonomy gate: budget-unreadable',
    });
    expect(issueTasks().filter((t) => t.phase !== 'done')).toHaveLength(0);
  });

  test('W-gate3 recent human use and cooldown do not block the webhook; the import records one start', async () => {
    setAutonomy({ dailyBudgetUsd: 0 });
    s.db
      .insert(autonomyStateTable)
      .values({ projectId, kind: 'issue-intake', lastStartedAt: Date.now() })
      .run();
    const before = Date.now();
    const http = await deliverHttp(labeledPayload(), 'wg3');
    expect(http.body.result).toBe('created');
    expect(intakeState()?.lastStartedAt).toBeGreaterThanOrEqual(before);
  });
});
