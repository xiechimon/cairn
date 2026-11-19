import {
  type AutonomySettings,
  GITHUB_WEBHOOK_DELIVERY_LIMIT,
  githubIssueSourceRef,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  githubConnection as githubConnectionTable,
  project as projectTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { countsAsMemberWrite } from '../src/services/autonomy-gates.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { githubFake, type RawIssue } from './fakes/github.js';
import { bootServer, req, seedRoute, type TestServer } from './helpers.js';

const OWNER = 'xiechimon';
const REPO = 'xiechimon/cairn';
const TOKEN = 'ghp_webhook_test_token';
const LABEL = 'ready-for-agent';
const CHIEF_AGENT_ID = 'agent-intake';

const ISSUE: RawIssue = {
  number: 7,
  title: 'webhook me',
  state: 'open',
  labels: [{ name: LABEL, color: '0E8A16' }],
  created_at: '2026-11-20T10:00:00Z',
  body: 'issue body',
};

const GATES_OFF: AutonomySettings = {
  enabled: true,
  actionTier: 'guarded',
  quietMinutes: 0,
  cooldownMinutes: 0,
  dailyBudgetUsd: 0,
};

const servers: TestServer[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) s.dispose();
});

function permissionBody(login: string, permission: string, roleName: string) {
  return { permission, role_name: roleName, user: { login } };
}

function seedChief(s: TestServer): void {
  seedRoute(s, 'coordinator', { id: CHIEF_AGENT_ID, provider: 'stub-gw', modelId: 'stub-model' });
  s.db
    .insert(chiefTable)
    .values({
      id: `chief-${s.user.id}-${s.team.id}`,
      userId: s.user.id,
      teamId: s.team.id,
      watches: [],
      wakes: [],
      createdAt: Date.now(),
    })
    .run();
}

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: OWNER, accessToken: TOKEN, scope: 'read:user repo' },
  );
}

async function postGithubProject(s: TestServer, githubRepo = REPO): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', {
    name: 'cairn',
    kind: 'github',
    githubRepo,
  });
  if (res.status !== 201) throw new Error(`postGithubProject: ${res.status}`);
  const id = ((await res.json()) as { id: string }).id;
  s.db.update(projectTable).set({ autonomy: GATES_OFF }).where(eq(projectTable.id, id)).run();
  return id;
}

async function makeWorld(opts: { githubRepo?: string; chief?: boolean } = {}) {
  const gh = githubFake(REPO, {
    issues: [structuredClone(ISSUE)],
    permissions: [[OWNER, { body: permissionBody(OWNER, 'admin', 'admin') }]],
  });
  const s = bootServer({ githubFetch: gh.impl });
  servers.push(s);
  seedConnection(s);
  if (opts.chief !== false) seedChief(s);
  const projectId = await postGithubProject(s, opts.githubRepo);
  return { s, gh, projectId };
}

function issuesEvent(overrides: Record<string, unknown> = {}) {
  return {
    action: 'labeled',
    issue: { number: ISSUE.number },
    label: { name: LABEL },
    repository: { full_name: REPO },
    sender: { login: OWNER },
    ...overrides,
  };
}

function deliver(
  s: TestServer,
  token: string,
  opts: { event?: string; deliveryId?: string; cairnDeliveryId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.event !== undefined) headers['x-github-event'] = opts.event;
  if (opts.deliveryId !== undefined) headers['x-github-delivery'] = opts.deliveryId;
  if (opts.cairnDeliveryId !== undefined) headers['x-cairn-delivery'] = opts.cairnDeliveryId;
  return Promise.resolve(
    s.app.request(`/api/webhook/github/${token}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body ?? issuesEvent()),
    }),
  );
}

interface DeliveryBody {
  result: string;
  deliveryId?: string;
  todoId?: string;
  threadId?: string;
}

async function delivered(res: Response): Promise<DeliveryBody> {
  return (await res.json()) as DeliveryBody;
}

async function mint(s: TestServer): Promise<{ webhookUrl: string; token: string; masked: string }> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/github/webhook`);
  expect(res.status).toBe(200);
  return (await res.json()) as { webhookUrl: string; token: string; masked: string };
}

function connectionRow(s: TestServer) {
  return s.db
    .select()
    .from(githubConnectionTable)
    .where(eq(githubConnectionTable.teamId, s.team.id))
    .get();
}

describe('token management', () => {
  test('mint returns the plaintext once and persists hash + masked on the connection', async () => {
    const { s } = await makeWorld();
    const first = await mint(s);
    expect(first.token).toMatch(/^cairn-wh-[0-9a-f]{48}$/);
    expect(first.webhookUrl).toContain(`/api/webhook/github/${first.token}`);
    expect(first.masked).toBe(`${first.token.slice(0, 12)}…${first.token.slice(-4)}`);
    const row = connectionRow(s);
    expect(row?.webhookTokenHash).toBe(sha256Hex(first.token));
    expect(row?.webhookMasked).toBe(first.masked);
    expect(row?.webhookDeliveries).toEqual([]);
    const second = await mint(s);
    expect(second.token).not.toBe(first.token);
    expect(connectionRow(s)?.webhookTokenHash).toBe(sha256Hex(second.token));
    const status = await req(s.app, 'GET', `/api/teams/${s.team.id}/github/connection`);
    const body = (await status.json()) as Record<string, unknown>;
    expect(body.webhookMasked).toBe(second.masked);
    expect(body.webhookTokenHash).toBeUndefined();
    expect(body.webhookDeliveries).toBeUndefined();
  });

  test('mint without a github connection answers 404; revoke clears the token columns', async () => {
    const gh = githubFake(REPO);
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    const noConnection = await req(s.app, 'POST', `/api/teams/${s.team.id}/github/webhook`);
    expect(noConnection.status).toBe(404);
    seedConnection(s);
    const { token } = await mint(s);
    const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/webhook`);
    expect(res.status).toBe(204);
    const row = connectionRow(s);
    expect(row?.webhookTokenHash).toBeNull();
    expect(row?.webhookMasked).toBeNull();
    expect(row?.webhookDeliveries).toBeNull();
    expect(row?.webhookLastUsedAt).toBeNull();
    const delivered = await deliver(s, token, { event: 'issues', deliveryId: 'd-revoked' });
    expect(delivered.status).toBe(401);
  });
});

describe('receiveGithubWebhook', () => {
  test('issues/labeled + ready-for-agent creates the todo and the orchestration thread', async () => {
    const { s, gh } = await makeWorld();
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-1' });
    expect(res.status).toBe(202);
    const body = await delivered(res);
    expect(body.result).toBe('created');
    expect(body.deliveryId).toBe('d-1');
    const todoId = body.todoId ?? '';
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.sourceRef).toBe(githubIssueSourceRef('xiechimon', 'cairn', ISSUE.number));
    expect(row?.createdBy).toBe(CHIEF_AGENT_ID);
    expect(row?.phase).toBe('todo');
    const threads = s.db.select().from(chiefThreadTable).all();
    expect(threads.some((t) => t.id === body.threadId)).toBe(true);
    expect(gh.permissionReads(OWNER).length).toBeGreaterThan(0);
    expect(connectionRow(s)?.webhookDeliveries).toEqual(['d-1']);
    expect(connectionRow(s)?.webhookLastUsedAt).not.toBeNull();
  });

  test('without a bound coordinator the todo is still created under the owner user', async () => {
    const { s } = await makeWorld({ chief: false });
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-nochief' });
    expect(res.status).toBe(202);
    const body = await delivered(res);
    expect(body.result).toBe('created');
    const row = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, body.todoId ?? ''))
      .get();
    expect(row?.createdBy).toBe(s.user.id);
  });

  test('the same X-GitHub-Delivery answers duplicate', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const first = await deliver(s, token, { event: 'issues', deliveryId: 'd-dup' });
    expect((await delivered(first)).result).toBe('created');
    const second = await deliver(s, token, { event: 'issues', deliveryId: 'd-dup' });
    expect(second.status).toBe(202);
    expect((await delivered(second)).result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
  });

  test('a new delivery id for an already-imported issue answers duplicate via sourceRef', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const first = await deliver(s, token, { event: 'issues', deliveryId: 'd-a' });
    expect((await delivered(first)).result).toBe('created');
    const second = await deliver(s, token, { event: 'issues', deliveryId: 'd-b' });
    expect(second.status).toBe(202);
    expect((await delivered(second)).result).toBe('duplicate');
    expect(s.db.select().from(todoTable).all()).toHaveLength(1);
    expect(connectionRow(s)?.webhookDeliveries).toEqual(['d-a', 'd-b']);
  });

  test('ping, wrong label, unlabeled and missing sender answer ignored', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const ping = await deliver(s, token, { event: 'ping', deliveryId: 'd-ping' });
    expect((await delivered(ping)).result).toBe('ignored');
    const wrongLabel = await deliver(s, token, {
      event: 'issues',
      deliveryId: 'd-label',
      body: issuesEvent({ label: { name: 'other-label' } }),
    });
    expect((await delivered(wrongLabel)).result).toBe('ignored');
    const unlabeled = await deliver(s, token, {
      event: 'issues',
      deliveryId: 'd-unlabeled',
      body: issuesEvent({ action: 'unlabeled' }),
    });
    expect((await delivered(unlabeled)).result).toBe('ignored');
    const noSender = await deliver(s, token, {
      event: 'issues',
      deliveryId: 'd-nosender',
      body: issuesEvent({ sender: null }),
    });
    expect((await delivered(noSender)).result).toBe('ignored');
    const malformed = await deliver(s, token, {
      event: 'issues',
      deliveryId: 'd-malformed',
      body: { action: 'labeled' },
    });
    expect((await delivered(malformed)).result).toBe('ignored');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });

  test('unknown token answers 401 and a rotated token retires the old one', async () => {
    const { s } = await makeWorld();
    const unknown = await deliver(s, `cairn-wh-${'0'.repeat(48)}`, {
      event: 'issues',
      deliveryId: 'd-x',
    });
    expect(unknown.status).toBe(401);
    const first = await mint(s);
    const second = await mint(s);
    const oldToken = await deliver(s, first.token, { event: 'issues', deliveryId: 'd-old' });
    expect(oldToken.status).toBe(401);
    const newToken = await deliver(s, second.token, { event: 'issues', deliveryId: 'd-new' });
    expect(newToken.status).toBe(202);
    expect((await delivered(newToken)).result).toBe('created');
  });

  test('a repository without a bound project answers misconfigured', async () => {
    const { s } = await makeWorld({ githubRepo: 'xiechimon/other-repo' });
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-mismatch' });
    expect(res.status).toBe(202);
    expect((await delivered(res)).result).toBe('misconfigured');
    expect(connectionRow(s)?.webhookDeliveries).toEqual(['d-mismatch']);
  });

  test('a sender below triage answers ignored', async () => {
    const { s, gh } = await makeWorld();
    gh.state.permissions.set('outsider', {
      body: permissionBody('outsider', 'read', 'read'),
    });
    const { token } = await mint(s);
    const res = await deliver(s, token, {
      event: 'issues',
      deliveryId: 'd-outsider',
      body: issuesEvent({ sender: { login: 'outsider' } }),
    });
    expect(res.status).toBe(202);
    expect((await delivered(res)).result).toBe('ignored');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });

  test('x-cairn-delivery supplies the delivery id when x-github-delivery is absent', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const first = await deliver(s, token, { event: 'issues', cairnDeliveryId: 'cd-1' });
    expect((await delivered(first)).result).toBe('created');
    const second = await deliver(s, token, { event: 'issues', cairnDeliveryId: 'cd-1' });
    expect((await delivered(second)).result).toBe('duplicate');
  });

  test('deliveries stay bounded to the last 50 ids', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const history = Array.from({ length: GITHUB_WEBHOOK_DELIVERY_LIMIT }, (_, i) => `d-${i}`);
    s.db
      .update(githubConnectionTable)
      .set({ webhookDeliveries: history })
      .where(eq(githubConnectionTable.teamId, s.team.id))
      .run();
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-new' });
    expect(res.status).toBe(202);
    const kept = connectionRow(s)?.webhookDeliveries ?? [];
    expect(kept).toHaveLength(GITHUB_WEBHOOK_DELIVERY_LIMIT);
    expect(kept.at(-1)).toBe('d-new');
    expect(kept).not.toContain('d-0');
  });

  test('webhook deliveries do not count as member writes', () => {
    expect(countsAsMemberWrite('POST', '/api/webhook/github/some-token', 202)).toBe(false);
  });

  test('the webhook path is exempt from token auth', async () => {
    const gh = githubFake(REPO);
    const s = bootServer({ authToken: 'owner-secret', githubFetch: gh.impl });
    servers.push(s);
    seedConnection(s);
    const guarded = await req(s.app, 'GET', `/api/teams/${s.team.id}/github/connection`);
    expect(guarded.status).toBe(401);
    const res = await deliver(s, `cairn-wh-${'0'.repeat(48)}`, {
      event: 'issues',
      deliveryId: 'd-auth',
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).not.toBe('Unauthorized');
  });

  test('the repository match is case-insensitive', async () => {
    const { s } = await makeWorld({ githubRepo: 'XiechiMon/Cairn' });
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-case' });
    expect((await delivered(res)).result).toBe('created');
  });

  test('an archived project does not bind the repository', async () => {
    const { s, projectId } = await makeWorld();
    s.db
      .update(projectTable)
      .set({ archivedAt: Date.now() })
      .where(eq(projectTable.id, projectId))
      .run();
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-archived' });
    expect((await delivered(res)).result).toBe('misconfigured');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });

  test('a labeled event whose issue no longer carries the label answers ignored', async () => {
    const gh = githubFake(REPO, {
      issues: [{ ...structuredClone(ISSUE), labels: [{ name: 'other-label' }] }],
      permissions: [[OWNER, { body: permissionBody(OWNER, 'admin', 'admin') }]],
    });
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    seedConnection(s);
    seedChief(s);
    await postGithubProject(s);
    const { token } = await mint(s);
    const res = await deliver(s, token, { event: 'issues', deliveryId: 'd-nolabel' });
    expect(res.status).toBe(202);
    expect((await delivered(res)).result).toBe('ignored');
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
  });

  test('concurrent deliveries for different issues still honor the in-flight cap', async () => {
    const gh = githubFake(REPO, {
      issues: [structuredClone(ISSUE), { ...structuredClone(ISSUE), number: 8 }],
      permissions: [[OWNER, { body: permissionBody(OWNER, 'admin', 'admin') }]],
    });
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    seedConnection(s);
    seedChief(s);
    const projectId = await postGithubProject(s);
    for (const n of [101, 102]) {
      s.db
        .insert(todoTable)
        .values({
          id: `seed-issue-${n}`,
          teamId: s.team.id,
          projectId,
          title: `seed ${n}`,
          spec: '',
          phase: 'todo',
          phaseAt: Date.now(),
          seqNum: n,
          sourceKind: 'github-issue',
          sourceRef: githubIssueSourceRef('xiechimon', 'cairn', n),
          createdBy: CHIEF_AGENT_ID,
        })
        .run();
    }
    const { token } = await mint(s);
    const [first, second] = await Promise.all([
      deliver(s, token, {
        event: 'issues',
        deliveryId: 'd-cap-1',
        body: issuesEvent({ issue: { number: 7 } }),
      }).then(delivered),
      deliver(s, token, {
        event: 'issues',
        deliveryId: 'd-cap-2',
        body: issuesEvent({ issue: { number: 8 } }),
      }).then(delivered),
    ]);
    expect([first.result, second.result].sort()).toEqual(['created', 'ignored']);
    expect(
      s.db.select().from(todoTable).where(eq(todoTable.sourceKind, 'github-issue')).all(),
    ).toHaveLength(3);
  });

  test('an oversized body is refused before the token check', async () => {
    const gh = githubFake(REPO);
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    const res = await s.app.request(`/api/webhook/github/cairn-wh-${'0'.repeat(48)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});
