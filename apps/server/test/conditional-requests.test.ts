import type { RemoteRoutesResponse, TailnetAccess } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openMemoryDb } from '../src/db/client.js';
import {
  chief,
  chiefThread,
  computer,
  computerCall,
  imConnection,
  imPairingRequest,
  notification,
  phone,
  project,
  step,
  team,
  threadPr,
  todo,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { createImService } from '../src/services/im/core.js';
import type { ImEnv } from '../src/services/im/types.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import { createMailAccount } from '../src/services/mail-accounts.js';
import { issuePairingGrant, pairFromGrant } from '../src/services/paired-devices.js';
import {
  bootServer,
  deliverCodeStep,
  insertClaudeSubscription,
  insertMachine,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const ETAG_RE = /^W\/"[0-9a-f]{40}"$/;
const VARY_PARTS = ['accept-encoding', 'cookie', 'authorization'];
const BOGUS_TAG = '"0000000000000000000000000000000000000000"';

async function postTodo(s: TestServer, projectId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: 'spec',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function addPhoneRow(
  s: TestServer,
  machineId: string,
  fields: Partial<typeof phone.$inferSelect> = {},
): string {
  const id = fields.id ?? newRecordId();
  const now = nowMs();
  s.db
    .insert(phone)
    .values({
      id,
      teamId: s.team.id,
      machineId,
      platform: 'android',
      deviceId: `dev-${id}`,
      name: 'Pixel',
      consentAt: now,
      createdAt: now,
      updatedAt: now,
      ...fields,
    })
    .run();
  return id;
}

async function expectConditionalGet(
  s: TestServer,
  path: string,
  edit: () => Promise<void> | void,
  init: { headers?: Record<string, string> } = {},
  expectChanged?: (body: unknown) => void,
): Promise<void> {
  const first = await s.app.request(path, init);
  expect(first.status).toBe(200);
  const etag = first.headers.get('etag');
  expect(etag).toMatch(ETAG_RE);
  const cacheControl = first.headers.get('cache-control') ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-cache');
  const vary = (first.headers.get('vary') ?? '').toLowerCase();
  for (const part of VARY_PARTS) expect(vary).toContain(part);
  const firstBody: unknown = await first.json();

  const revalidate = (ifNoneMatch: string) =>
    s.app.request(path, {
      ...init,
      headers: { ...init.headers, 'if-none-match': ifNoneMatch },
    });

  const hit = await revalidate(etag ?? '');
  expect(hit.status).toBe(304);
  expect(hit.headers.get('etag')).toBe(etag);
  expect(hit.headers.get('vary')).toBe(first.headers.get('vary'));
  expect(hit.headers.get('cache-control')).toBe(cacheControl);
  expect(await hit.text()).toBe('');

  const miss = await revalidate(BOGUS_TAG);
  expect(miss.status).toBe(200);
  await miss.text();

  await edit();
  const changed = await revalidate(etag ?? '');
  expect(changed.status).toBe(200);
  const nextEtag = changed.headers.get('etag');
  expect(nextEtag).toMatch(ETAG_RE);
  expect(nextEtag).not.toBe(etag);
  const changedBody: unknown = await changed.json();
  expect(changedBody).not.toEqual(firstBody);
  expectChanged?.(changedBody);
}

describe('conditional requests on hot list endpoints', () => {
  test('board todo list and sectioned task list', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todoId = await postTodo(s, projectId);
    const rename = (title: string) => async () => {
      const res = await req(s.app, 'PATCH', `/api/todos/${todoId}`, { title });
      expect(res.status).toBe(200);
    };
    await expectConditionalGet(
      s,
      `/api/todos?teamId=${s.team.id}`,
      rename('title for the todos revalidation'),
      {},
      (body) => {
        const titles = (body as { title: string }[]).map((row) => row.title);
        expect(titles).toContain('title for the todos revalidation');
      },
    );
    await expectConditionalGet(
      s,
      `/api/tasks?teamId=${s.team.id}&sectioned=1`,
      rename('title for the tasks revalidation'),
      {},
      (body) => {
        const titles = (body as { entries: { title: string }[] }).entries.map(
          (entry) => entry.title,
        );
        expect(titles).toContain('title for the tasks revalidation');
      },
    );
  });

  test('a validator from another query string never revalidates different bytes', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    await postTodo(s, projectId);
    const active = `/api/todos?teamId=${s.team.id}`;
    const archived = `${active}&archived=1`;

    const activeRes = await s.app.request(active);
    expect(activeRes.status).toBe(200);
    const activeTag = activeRes.headers.get('etag') ?? '';
    expect(activeTag).toMatch(ETAG_RE);
    expect(((await activeRes.json()) as unknown[]).length).toBeGreaterThan(0);

    const archivedRes = await s.app.request(archived, {
      headers: { 'if-none-match': activeTag },
    });
    expect(archivedRes.status).toBe(200);
    expect(await archivedRes.json()).toEqual([]);
    const archivedTag = archivedRes.headers.get('etag') ?? '';
    expect(archivedTag).toMatch(ETAG_RE);
    expect(archivedTag).not.toBe(activeTag);

    const back = await s.app.request(active, { headers: { 'if-none-match': archivedTag } });
    expect(back.status).toBe(200);
  });

  test('todo, task, needs-you and project lists answer 404 for a foreign team', async () => {
    const s = bootServer();
    s.db.insert(team).values({ id: 'foreign-team', name: 'Foreign', createdAt: 1 }).run();
    s.db
      .insert(project)
      .values({ id: 'foreign-project', teamId: 'foreign-team', name: 'Foreign' })
      .run();
    s.db
      .insert(todo)
      .values({
        id: 'foreign-todo',
        teamId: 'foreign-team',
        projectId: 'foreign-project',
        title: 'Foreign todo',
        spec: '',
        phase: 'todo',
        phaseAt: Date.now(),
        seqNum: 1,
      })
      .run();
    for (const path of ['/api/todos', '/api/tasks', '/api/needs-you', '/api/projects']) {
      const res = await req(s.app, 'GET', `${path}?teamId=foreign-team`);
      expect(res.status).toBe(404);
    }
    const own = await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`);
    expect(own.status).toBe(200);
  });

  test('pull-request panel list', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todoId = await postTodo(s, projectId);
    const { buildId } = deliverCodeStep(s.svc, todoId);
    await expectConditionalGet(
      s,
      '/api/prs',
      () => {
        const now = nowMs();
        s.db
          .insert(threadPr)
          .values({
            id: newRecordId(),
            teamId: s.team.id,
            threadId: todoId,
            buildId,
            repo: 'xiechimon/cairn',
            number: 1,
            title: 'first',
            url: 'https://example.test/pr/1',
            head: 'abc',
            checksReadFor: 'abc',
            createdAt: now,
            updatedAt: now,
          })
          .run();
      },
      {},
      (body) => {
        expect((body as { title: string }[]).map((row) => row.title)).toContain('first');
      },
    );
  });

  test('unread notifications', async () => {
    const s = bootServer();
    const id = `${s.user.id}:entity-1`;
    const now = nowMs();
    s.db
      .insert(notification)
      .values({
        id,
        teamId: s.team.id,
        userId: s.user.id,
        type: 'marked_unread',
        entityId: 'entity-1',
        entityRef: { title: 'card', projectId: null, seqNum: null },
        agentName: 'test',
        createdAt: now,
      })
      .run();
    await expectConditionalGet(
      s,
      `/api/teams/${s.team.id}/notifications`,
      () => {
        s.db.update(notification).set({ readAt: nowMs() }).where(eq(notification.id, id)).run();
      },
      {},
      (body) => {
        expect((body as { unreadThreadIds: string[] }).unreadThreadIds).not.toContain('entity-1');
      },
    );
  });

  test('registered machines', async () => {
    const s = bootServer();
    await expectConditionalGet(
      s,
      `/api/teams/${s.team.id}/machines`,
      () => {
        insertMachine(s, { name: 'extra-box' });
      },
      {},
      (body) => {
        expect(JSON.stringify(body)).toContain('extra-box');
      },
    );
  });

  test('computers', async () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'host',
      capabilities: { computer: true, mcpServers: [], skills: [] },
    });
    await expectConditionalGet(
      s,
      '/api/computers',
      () => {
        s.db.update(computer).set({ state: 'running' }).run();
      },
      {},
      (body) => {
        expect((body as { computers: { state: string }[] }).computers).toContainEqual(
          expect.objectContaining({ state: 'running' }),
        );
      },
    );
  });

  test('chief threads', async () => {
    const s = bootServer();
    await expectConditionalGet(
      s,
      `/api/teams/${s.team.id}/chief/threads`,
      () => {
        const row = s.db.select().from(chief).get();
        if (row === undefined) throw new Error('chief row missing');
        const now = nowMs();
        s.db
          .insert(chiefThread)
          .values({
            id: newRecordId(),
            chiefId: row.id,
            userId: s.user.id,
            teamId: s.team.id,
            title: 'side thread',
            sessionId: newRecordId(),
            sessionOpenedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      },
      {},
      (body) => {
        expect((body as { title: string }[]).map((row) => row.title)).toContain('side thread');
      },
    );
  });

  test('phone handoffs', async () => {
    const s = bootServer();
    const machineId = insertMachine(s, { name: 'mac' });
    addPhoneRow(s, machineId, { handoffReason: 'login', handoffRequestedAt: nowMs() });
    await expectConditionalGet(
      s,
      '/api/phones/handoffs',
      () => {
        s.db.update(phone).set({ name: 'Pixel 2' }).run();
      },
      {},
      (body) => {
        expect(JSON.stringify(body)).toContain('Pixel 2');
      },
    );
  });

  test('machine phones and phone activity', async () => {
    const s = bootServer();
    const machineId = insertMachine(s, { name: 'mac' });
    const phoneId = addPhoneRow(s, machineId);
    const stepId = newRecordId();
    s.db
      .insert(step)
      .values({ id: stepId, buildId: 'conv-1', kind: 'chief', status: 'done', createdAt: nowMs() })
      .run();
    s.db
      .insert(computerCall)
      .values({
        id: newRecordId(),
        teamId: s.team.id,
        stepId,
        toolCallId: 'tc-1',
        machineId,
        phoneId,
        tool: 'phone_manage',
        replaySafe: false,
        params: { action: 'pair' },
        state: 'done',
        deadlineAt: nowMs(),
        createdAt: nowMs(),
      })
      .run();
    await expectConditionalGet(
      s,
      `/api/machines/${machineId}/phones`,
      () => {
        s.db.update(phone).set({ name: 'Pixel 3' }).run();
      },
      {},
      (body) => {
        expect(JSON.stringify(body)).toContain('Pixel 3');
      },
    );
    await expectConditionalGet(
      s,
      `/api/machines/${machineId}/phones/activity`,
      () => {
        s.db.update(computerCall).set({ exitCode: 1 }).run();
      },
      {},
      (body) => {
        expect(
          (body as { activity: { exitCode: number | null }[] }).activity.some(
            (row) => row.exitCode === 1,
          ),
        ).toBe(true);
      },
    );
  });

  test('paired devices', async () => {
    const s = bootServer({ authToken: 'owner-token' });
    const owner = { headers: { authorization: 'Bearer owner-token' } };
    await expectConditionalGet(
      s,
      '/api/remote/devices',
      () => {
        const { code } = issuePairingGrant(s.db);
        const paired = pairFromGrant(s.db, { code, teamId: s.team.id, name: 'phone-1' });
        if (paired === null) throw new Error('pairing failed');
      },
      owner,
      (body) => {
        expect(JSON.stringify(body)).toContain('phone-1');
      },
    );
  });

  test('model routing connections', async () => {
    const s = bootServer();
    await expectConditionalGet(s, `/api/teams/${s.team.id}/model-routing`, () => {
      insertClaudeSubscription(s);
    });
  });
});

describe('sensitive list endpoints stay uncacheable', () => {
  test('remote routes redact the login URL for a paired device and never send a validator', async () => {
    let tailnet: TailnetAccess | null = null;
    const s = bootServer({
      authToken: 'owner-token',
      remote: { tailnetStatus: () => tailnet },
    });
    const owner = { authorization: 'Bearer owner-token' };
    const grant = issuePairingGrant(s.db);
    const paired = pairFromGrant(s.db, { code: grant.code, teamId: s.team.id, name: 'phone-1' });
    if (paired === null) throw new Error('pairing failed');
    const device = { authorization: `Bearer ${paired.token}` };

    const first = await s.app.request('/api/remote/routes', { headers: owner });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('etag')).toBeNull();
    expect(((await first.json()) as RemoteRoutesResponse).tailnet.state).toBe('off');

    tailnet = {
      enabled: true,
      state: 'needs-login',
      dnsName: null,
      ips: [],
      authUrl: 'https://login.tailscale.com/a/abc',
      error: null,
    };
    const ownerRes = await s.app.request('/api/remote/routes', {
      headers: { ...owner, 'if-none-match': BOGUS_TAG },
    });
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.headers.get('cache-control')).toBe('no-store');
    expect(ownerRes.headers.get('etag')).toBeNull();
    const ownerBody = (await ownerRes.json()) as RemoteRoutesResponse;
    expect(ownerBody.tailnet.authUrl).toBe('https://login.tailscale.com/a/abc');

    const deviceRes = await s.app.request('/api/remote/routes', { headers: device });
    expect(deviceRes.status).toBe(200);
    expect(deviceRes.headers.get('cache-control')).toBe('no-store');
    expect(deviceRes.headers.get('etag')).toBeNull();
    const deviceBody = (await deviceRes.json()) as RemoteRoutesResponse;
    expect(deviceBody.tailnet.authUrl).toBeNull();

    const conditional = await s.app.request('/api/remote/routes', {
      headers: { ...device, 'if-none-match': BOGUS_TAG },
    });
    expect(conditional.status).toBe(200);
    const conditionalBody = (await conditional.json()) as RemoteRoutesResponse;
    expect(conditionalBody.tailnet.authUrl).toBeNull();
  });

  test('pairing grants stay owner-only and uncacheable', async () => {
    const s = bootServer({ authToken: 'owner-token' });
    const owner = { authorization: 'Bearer owner-token' };
    const grant = issuePairingGrant(s.db);
    const paired = pairFromGrant(s.db, { code: grant.code, teamId: s.team.id, name: 'phone-1' });
    if (paired === null) throw new Error('pairing failed');
    issuePairingGrant(s.db);

    const res = await s.app.request('/api/remote/pairing', { headers: owner });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    expect(((await res.json()) as unknown[]).length).toBeGreaterThan(0);

    const conditional = await s.app.request('/api/remote/pairing', {
      headers: { ...owner, 'if-none-match': BOGUS_TAG },
    });
    expect(conditional.status).toBe(200);

    const deviceRes = await s.app.request('/api/remote/pairing', {
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(deviceRes.status).toBe(403);
  });

  test('mail accounts stay uncacheable', async () => {
    const s = bootServer({ authToken: 'owner-token' });
    const owner = { authorization: 'Bearer owner-token' };
    const first = await s.app.request(`/api/teams/${s.team.id}/mail/accounts`, {
      headers: owner,
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('etag')).toBeNull();
    expect((await first.json()) as { accounts: unknown[] }).toEqual({ accounts: [] });

    createMailAccount(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        userId: s.user.id,
        body: {
          address: 'owner@example.com',
          imapHost: 'imap.example.com',
          imapPort: 993,
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          password: 'secret',
          wakeMode: 'all',
        },
      },
    );
    const res = await s.app.request(`/api/teams/${s.team.id}/mail/accounts`, {
      headers: { ...owner, 'if-none-match': BOGUS_TAG },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    expect(JSON.stringify(await res.json())).toContain('owner@example.com');
  });
});

describe('conditional requests on im lists', () => {
  const env: ImEnv = {
    fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
    now: () => Date.now(),
    sleep: async () => {},
    connectSocket: () => {
      throw new Error('offline');
    },
  };

  function bootIm(): { s: TestServer } {
    const db = openMemoryDb();
    const { user } = seed(db);
    const attachmentsDir = makeTestTempDir('im-att-');
    const reposDir = makeTestTempDir('im-repos-');
    const service = createImService({
      db,
      hub: new TeamStreamHub(),
      machineHub: new MachineWakeHub(),
      convHub: new ConversationStreamHub(),
      box: createEphemeralSecretBox(),
      user,
      env,
      attachmentsDir,
      reposDir,
      adapters: {},
    });
    onTestFinished(() => {
      void service.shutdown();
      releaseTestTempDir(attachmentsDir);
      releaseTestTempDir(reposDir);
    });
    return { s: bootServer({ db, im: service, vapidKeys: null }) };
  }

  function addConnection(s: TestServer): string {
    const id = newRecordId();
    const now = nowMs();
    s.db
      .insert(imConnection)
      .values({
        id,
        teamId: s.team.id,
        userId: s.user.id,
        platform: 'telegram',
        secretCipher: 'cipher',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return id;
  }

  test('im connections', async () => {
    const { s } = bootIm();
    addConnection(s);
    await expectConditionalGet(s, `/api/teams/${s.team.id}/im/connections`, () => {
      s.db.update(imConnection).set({ statusDetail: 'rate limited' }).run();
    });
  });

  test('im pairing requests', async () => {
    const { s } = bootIm();
    const connId = addConnection(s);
    const now = nowMs();
    s.db
      .insert(imPairingRequest)
      .values({
        id: newRecordId(),
        connId,
        senderId: 'sender-1',
        chatKey: 'chat-1',
        status: 'pending',
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await expectConditionalGet(s, `/api/teams/${s.team.id}/im/pairing-requests`, () => {
      s.db.update(imPairingRequest).set({ status: 'approved', decidedAt: nowMs() }).run();
    });
  });
});

describe('conditional request mechanics', () => {
  test('a gzip conditional request revalidates with the weak tag and Vary it stored', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    for (let i = 0; i < 30; i += 1) {
      await postTodo(s, projectId);
    }
    const path = `/api/todos?teamId=${s.team.id}`;

    const plain = await s.app.request(path);
    const tag = plain.headers.get('etag') ?? '';
    expect(tag).toMatch(ETAG_RE);
    await plain.text();

    const zipped = await s.app.request(path, { headers: { 'accept-encoding': 'gzip' } });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const weakEtag = zipped.headers.get('etag') ?? '';
    expect(weakEtag).toBe(tag);
    const vary = zipped.headers.get('vary');
    expect(vary?.toLowerCase()).toContain('accept-encoding');
    await zipped.text();

    const hit = await s.app.request(path, {
      headers: { 'accept-encoding': 'gzip', 'if-none-match': weakEtag },
    });
    expect(hit.status).toBe(304);
    expect(hit.headers.get('etag')).toBe(weakEtag);
    expect(hit.headers.get('vary')).toBe(vary);
    expect(await hit.text()).toBe('');

    const star = await s.app.request(path, { headers: { 'if-none-match': '*' } });
    expect(star.status).toBe(304);
  });

  test('non-listed endpoints stay uncached', async () => {
    const s = bootServer();
    const res = await s.app.request('/api/user/me');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
  });
});
