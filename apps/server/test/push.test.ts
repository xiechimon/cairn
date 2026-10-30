import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pushSubscriptionBodySchema } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import { loadConfig } from '../src/config.js';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread,
  pushDigestItem,
  pushSubscription,
} from '../src/db/schema.js';
import { finishTodoDone } from '../src/services/builds.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import {
  buildPushPayload,
  digestSlotDueAt,
  digestSlotsDue,
  loadOrCreateVapidKeys,
  queuePushDigest,
  sendPushToUser,
  sweepPushDigest,
} from '../src/services/push.js';
import { createScheduler } from '../src/services/scheduler.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TEST_PUSH_HOSTS = new Set(['127.0.0.1', 'push.example']);

function makeKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

interface FakePush {
  requests: { method: string; path: string; authorization: string | null }[];
  endpoint(path: string): string;
  status(path: string, status: number): void;
  stall(path: string): void;
  close(): void;
}

export function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve(`https://127.0.0.1:${addr.port}`);
    });
  });
}

async function fakePushServer(): Promise<FakePush> {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-push-cert-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const requests: FakePush['requests'] = [];
  const statuses = new Map<string, number>();
  const stalled = new Set<string>();
  const server: Server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    (req, res) => {
      const path = req.url ?? '/';
      requests.push({
        method: req.method ?? 'POST',
        path,
        authorization: (req.headers.authorization as string | undefined) ?? null,
      });
      req.resume();
      if (stalled.has(path)) return;
      req.on('end', () => {
        res.writeHead(statuses.get(path) ?? 201);
        res.end();
      });
    },
  );
  const base = await listen(server);
  return {
    requests,
    endpoint: (path) => `${base}${path}`,
    status: (path, status) => {
      statuses.set(path, status);
    },
    stall: (path) => {
      stalled.add(path);
    },
    close: () => {
      server.closeAllConnections();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function subscribe(
  app: Parameters<typeof req>[0],
  teamId: string,
  endpoint: string,
  origin = 'https://cairn.test',
) {
  const res = await req(app, 'POST', `/api/teams/${teamId}/push/subscriptions`, {
    endpoint,
    keys: makeKeys(),
    origin,
  });
  if (res.status !== 201) throw new Error(`subscribe: ${res.status}`);
}

async function makeTodo(s: ReturnType<typeof bootServer>) {
  const projectId = await postProject(s.app);
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '写周报',
    spec: '',
  });
  if (res.status !== 201) throw new Error(`todo: ${res.status}`);
  return (await res.json()) as { id: string };
}

function subRows(s: ReturnType<typeof bootServer>) {
  return s.db.select().from(pushSubscription).all();
}

function insertChiefThread(s: ReturnType<typeof bootServer>, threadId: string): void {
  const now = Date.now();
  s.db
    .insert(chiefTable)
    .values({
      id: `chief-${s.user.id}-${s.team.id}`,
      userId: s.user.id,
      teamId: s.team.id,
      agentId: null,
      charter: '',
      lastTurnAt: null,
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId: `chief-${s.user.id}-${s.team.id}`,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'test',
      createdAt: now,
      updatedAt: now,
      lastTurnAt: null,
      sessionId: 'session-test',
      sessionOpenedAt: now,
    })
    .run();
}

describe('VAPID keys and subscription routes', () => {
  test('rejects symlinked key parents and files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-vapid-'));
    const targetDir = join(dir, 'target');
    const parentLink = join(dir, 'parent-link');
    const fileLink = join(dir, 'file-link');
    mkdirSync(targetDir);
    symlinkSync(targetDir, parentLink);
    symlinkSync(join(dir, 'target.json'), fileLink);
    expect(() => loadOrCreateVapidKeys(join(parentLink, 'vapid.json'))).toThrow();
    expect(() => loadOrCreateVapidKeys(fileLink)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test('repairs existing key and directory permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-vapid-'));
    const keysPath = join(dir, 'nested', 'vapid.json');
    try {
      const first = loadOrCreateVapidKeys(keysPath);
      chmodSync(dirname(keysPath), 0o755);
      chmodSync(keysPath, 0o644);
      const second = loadOrCreateVapidKeys(keysPath);
      expect(second.publicKey).toBe(first.publicKey);
      expect(statSync(dirname(keysPath)).mode & 0o777).toBe(0o700);
      expect(statSync(keysPath).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uses the configured origin instead of the submitted origin', async () => {
    const s = bootServer({
      webOrigin: 'https://cairn.example',
      pushEndpointHosts: TEST_PUSH_HOSTS,
    });
    try {
      const endpoint = 'https://push.example/team-scoped';
      await subscribe(s.app, s.team.id, endpoint, 'https://attacker.example');
      const row = subRows(s)[0];
      expect(row).not.toHaveProperty('origin');
      const conflict = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, {
        endpoint,
        keys: makeKeys(),
      });
      expect(conflict.status).toBe(201);
      const payload = JSON.parse(
        buildPushPayload(s.vapidKeys?.webOrigin ?? '', {
          title: 't',
          body: 'b',
          href: '/x',
          tag: 't',
        }),
      ) as { notification: { navigate: string } };
      expect(payload.notification.navigate).toBe('https://cairn.example/x');
    } finally {
      s.dispose();
    }
  });
  test('returns the public key or 404 when VAPID is disabled', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/push/key`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { publicKey: string }).publicKey).toBe(
      (s.vapidKeys ?? { publicKey: '' }).publicKey,
    );
    const off = bootServer({ vapidKeys: null });
    const resOff = await req(off.app, 'GET', `/api/teams/${off.team.id}/push/key`);
    expect(resOff.status).toBe(404);
    s.dispose();
    off.dispose();
  });

  test('upserts subscriptions and rejects malformed requests and foreign teams', async () => {
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    const endpoint = 'https://push.example/sub-1';
    await subscribe(s.app, s.team.id, endpoint);
    await subscribe(s.app, s.team.id, endpoint);
    expect(subRows(s)).toHaveLength(1);
    expect(subRows(s)[0]?.userId).toBe(s.user.id);
    const bad = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, {
      endpoint: '',
      keys: { p256dh: 'x', auth: 'y' },
      origin: 'https://cairn.test',
    });
    expect(bad.status).toBe(400);
    const otherTeam = await req(s.app, 'POST', '/api/teams/team-nope/push/subscriptions', {
      endpoint: 'https://push.example/sub-2',
      keys: makeKeys(),
      origin: 'https://cairn.test',
    });
    expect(otherTeam.status).toBe(404);
    s.dispose();
  });

  test('requires a bearer token on every push route when token authentication is enabled', async () => {
    const s = bootServer({ authToken: 'sekrit', pushEndpointHosts: TEST_PUSH_HOSTS });
    const teamId = s.team.id;
    const bodies: [string, string, unknown][] = [
      ['GET', `/api/teams/${teamId}/push/key`, undefined],
      [
        'POST',
        `/api/teams/${teamId}/push/subscriptions`,
        { endpoint: 'https://push.example/a', keys: makeKeys(), origin: 'https://cairn.test' },
      ],
      ['DELETE', `/api/teams/${teamId}/push/subscriptions`, { endpoint: 'https://push.example/a' }],
    ];
    for (const [method, path, body] of bodies) {
      const denied = await req(s.app, method, path, body);
      expect(denied.status, `${method} ${path} without token`).toBe(401);
      const ok = await s.app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sekrit',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      expect(ok.status, `${method} ${path} with token`).not.toBe(401);
    }
    s.dispose();
  });

  test('deletes only subscriptions owned by the current user', async () => {
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    const endpoint = 'https://push.example/own';
    await subscribe(s.app, s.team.id, endpoint);
    s.db
      .insert(pushSubscription)
      .values({
        id: 'sub-other',
        userId: 'user-other',
        teamId: s.team.id,
        endpoint: 'https://push.example/other',
        p256dh: 'p',
        auth: 'a',
        createdAt: 0,
      })
      .run();
    const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/push/subscriptions`, {
      endpoint: 'https://push.example/other',
    });
    expect(res.status).toBe(204);
    expect(subRows(s).map((r) => r.endpoint)).toEqual([endpoint, 'https://push.example/other']);
    const res2 = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/push/subscriptions`, {
      endpoint,
    });
    expect(res2.status).toBe(204);
    expect(subRows(s).map((r) => r.endpoint)).toEqual(['https://push.example/other']);
    s.dispose();
  });
});

describe('subscription authorization boundaries', () => {
  test.each(['owner', 'team'])(
    'rejects cross-%s endpoint takeover and deletion',
    async (boundary) => {
      const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
      try {
        const endpoint = 'https://push.example/protected';
        const original = {
          id: 'protected-subscription',
          userId: boundary === 'owner' ? 'another-user' : s.user.id,
          teamId: boundary === 'team' ? 'another-team' : s.team.id,
          endpoint,
          p256dh: 'original-key',
          auth: 'original-auth',
          createdAt: 1,
        };
        s.db.insert(pushSubscription).values(original).run();
        const takeover = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, {
          endpoint,
          keys: makeKeys(),
        });
        expect(takeover.status).toBe(409);
        expect(subRows(s)).toEqual([original]);
        const deletion = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/push/subscriptions`, {
          endpoint,
        });
        expect(deletion.status).toBe(204);
        expect(subRows(s)).toEqual([original]);
        const foreignRoute = await req(
          s.app,
          'DELETE',
          '/api/teams/another-team/push/subscriptions',
          { endpoint },
        );
        expect(foreignRoute.status).toBe(404);
        expect(subRows(s)).toEqual([original]);
      } finally {
        s.dispose();
      }
    },
  );

  test('delivers only to the requested owner and team', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      await subscribe(s.app, s.team.id, fake.endpoint('/own'));
      const foreignSubscriptions: Array<[string, string, string]> = [
        ['/other-team', s.user.id, 'another-team'],
        ['/other-owner', 'another-user', s.team.id],
      ];
      for (const [path, userId, teamId] of foreignSubscriptions) {
        const keys = makeKeys();
        s.db
          .insert(pushSubscription)
          .values({
            id: path,
            userId,
            teamId,
            endpoint: fake.endpoint(path),
            p256dh: keys.p256dh,
            auth: keys.auth,
            createdAt: 1,
          })
          .run();
      }
      if (s.vapidKeys === null) throw new Error('test VAPID keys missing');
      await sendPushToUser(s.db, s.vapidKeys, s.user.id, s.team.id, {
        title: 'Scoped',
        body: 'Private',
        href: '/app',
        tag: 'scoped',
      });
      expect(fake.requests.map((request) => request.path)).toEqual(['/own']);
      expect(subRows(s)).toHaveLength(3);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('rejects request 31 within a minute and allows requests after the window expires', async () => {
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const body = { endpoint: 'https://push.example/rate-limit', keys: makeKeys() };
      for (let request = 1; request <= 30; request += 1) {
        const response = await req(
          s.app,
          'POST',
          `/api/teams/${s.team.id}/push/subscriptions`,
          body,
        );
        expect(response.status, `request ${request}`).toBe(201);
      }
      const before = subRows(s);
      clock.mockReturnValue(1_800_000_059_999);
      const limited = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, body);
      expect(limited.status).toBe(429);
      expect(subRows(s)).toEqual(before);
      clock.mockReturnValue(1_800_000_060_000);
      const renewed = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, body);
      expect(renewed.status).toBe(201);
    } finally {
      clock.mockRestore();
      s.dispose();
    }
  });
});

describe('push subscription validation', () => {
  test('accepts the supported push service hosts', () => {
    for (const endpoint of [
      'https://api.push.apple.com/3/device/token',
      'https://fcm.googleapis.com/fcm/send/token',
      'https://updates.push.services.mozilla.com/wpush/v2/token',
      'https://wns2-example.notify.windows.com/wpush/v2/token',
    ]) {
      expect(
        pushSubscriptionBodySchema.safeParse({
          endpoint,
          keys: { p256dh: 'key', auth: 'auth' },
          origin: 'https://cairn.test',
        }).success,
      ).toBe(true);
    }
  });

  test('rejects non-HTTPS, private, metadata, and unknown push hosts', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/subscription',
      'https://127.0.0.1/subscription',
      'https://100.64.0.1/subscription',
      'https://169.254.169.254/subscription',
      'https://push.example/subscription',
    ]) {
      expect(
        pushSubscriptionBodySchema.safeParse({
          endpoint,
          keys: { p256dh: 'key', auth: 'auth' },
          origin: 'https://cairn.test',
        }).success,
      ).toBe(false);
    }
  });

  test('rejects unsafe endpoints through the HTTP route', async () => {
    const s = bootServer();
    try {
      for (const endpoint of [
        'http://fcm.googleapis.com/subscription',
        'https://127.0.0.1/subscription',
        'https://100.64.0.1/subscription',
        'https://169.254.169.254/subscription',
      ]) {
        const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, {
          endpoint,
          keys: makeKeys(),
          origin: 'https://cairn.test',
        });
        expect(res.status, endpoint).toBe(400);
      }
      expect(subRows(s)).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('limits subscription fields and origin length', () => {
    expect(
      pushSubscriptionBodySchema.safeParse({
        endpoint: `https://fcm.googleapis.com/${'x'.repeat(2048)}`,
        keys: { p256dh: 'key', auth: 'auth' },
        origin: 'https://cairn.test',
      }).success,
    ).toBe(false);
    expect(
      pushSubscriptionBodySchema.safeParse({
        endpoint: 'https://fcm.googleapis.com/subscription',
        keys: { p256dh: 'x'.repeat(257), auth: 'auth' },
        origin: 'https://cairn.test',
      }).success,
    ).toBe(false);
    const parsed = pushSubscriptionBodySchema.parse({
      endpoint: 'https://fcm.googleapis.com/subscription',
      keys: { p256dh: 'key', auth: 'auth' },
      origin: 'https://attacker.example',
    });
    expect(parsed).not.toHaveProperty('origin');
  });
});

describe('VAPID configuration', () => {
  test('loads the configured subject without changing the persisted key pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-vapid-'));
    const keysPath = join(dir, 'vapid.json');
    try {
      const first = loadOrCreateVapidKeys(keysPath, 'https://example.com/push-contact');
      const second = loadOrCreateVapidKeys(keysPath, 'mailto:ops@example.com');
      expect(first.subject).toBe('https://example.com/push-contact');
      expect(second).toEqual({
        publicKey: first.publicKey,
        privateKey: first.privateKey,
        subject: 'mailto:ops@example.com',
        webOrigin: 'https://cairn.local',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts only an HTTPS origin for push links and normalizes its trailing slash', () => {
    expect(loadConfig({ webOrigin: 'https://cairn.example/' }).webOrigin).toBe(
      'https://cairn.example',
    );
    for (const webOrigin of [
      'http://cairn.example',
      'https://user:secret@cairn.example',
      'https://cairn.example/path',
      'https://cairn.example/?x=1',
      'https://cairn.example/#fragment',
    ]) {
      expect(() => loadConfig({ webOrigin })).toThrow();
    }
  });

  test('reads the branded subject env and rejects an insecure subject URL', () => {
    const name = 'CAIRN_VAPID_SUBJECT';
    const previous = process.env[name];
    try {
      delete process.env[name];
      expect(loadConfig().vapidSubject).toBe('mailto:push@cairn.dev');
      process.env[name] = 'https://example.com/push-contact';
      expect(loadConfig().vapidSubject).toBe('https://example.com/push-contact');
      expect(() => loadConfig({ vapidSubject: 'http://example.com/push-contact' })).toThrow();
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });
});

describe('push payload format', () => {
  test('limits the title while retaining the complete decision text', () => {
    const payload = JSON.parse(
      buildPushPayload('https://cairn.example', {
        title: 't'.repeat(300),
        body: 'b'.repeat(300),
        href: '/app/todo/todo-1',
        tag: 'user-1:todo-1',
      }),
    ) as { notification: { title: string; body: string } };
    expect(payload.notification.title).toHaveLength(200);
    expect(payload.notification.body).toHaveLength(300);
  });

  test('uses the declarative service worker payload and an absolute navigation URL', () => {
    const payload = JSON.parse(
      buildPushPayload('https://cairn.example', {
        title: '构建待审核',
        body: '#9 写周报',
        href: '/app/todo/todo-1',
        tag: 'user-1:todo-1',
      }),
    ) as Record<string, unknown>;
    expect(payload.web_push).toBe(8030);
    expect(payload.notification).toEqual({
      title: '构建待审核',
      body: '#9 写周报',
      navigate: 'https://cairn.example/app/todo/todo-1',
      tag: 'user-1:todo-1',
    });
  });
});

describe('subscription retention', () => {
  test('keeps at most 20 subscriptions per user and removes the oldest', async () => {
    const s = bootServer();
    try {
      for (let i = 0; i < 21; i += 1) {
        const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/push/subscriptions`, {
          endpoint: `https://fcm.googleapis.com/subscription-${i}`,
          keys: makeKeys(),
          origin: 'https://cairn.test',
        });
        expect(res.status).toBe(201);
      }
      expect(subRows(s)).toHaveLength(20);
      expect(subRows(s).some((row) => row.endpoint.endsWith('-0'))).toBe(false);
    } finally {
      s.dispose();
    }
  });
});

describe('delivery: only decisions push immediately', () => {
  test('approval-needed chief question sends exactly one push whose body carries the question and every option', async () => {
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    try {
      await subscribe(s.app, s.team.id, 'https://push.example/q');
      insertChiefThread(s, 'chief-thread-1');
      const questions = [
        {
          header: '选择方案',
          question: `${'Decision context. '.repeat(20)}Choose A or B?`,
          options: [{ label: '方案 A' }, { label: '方案 B' }],
        },
      ];
      createOrGetQuestion(
        { db: s.db, hub: s.hub, user: s.user, vapidKeys: s.vapidKeys },
        { threadId: 'chief-thread-1', requestId: 'ask-q1', questions },
      );
      expect(send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(send.mock.calls[0]?.[1] ?? '{}')) as {
        notification: { title: string; body: string; navigate: string };
      };
      expect(payload.notification.body).toContain(questions[0]?.question);
      expect(payload.notification.body).toContain('方案 A');
      expect(payload.notification.body).toContain('方案 B');
      expect(payload.notification.navigate).toContain('/app?chief=chief-thread-1');
      const again = createOrGetQuestion(
        { db: s.db, hub: s.hub, user: s.user, vapidKeys: s.vapidKeys },
        { threadId: 'chief-thread-1', requestId: 'ask-q1', questions },
      );
      expect(again.created).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('no vapid keys: chief question still records the notification but never pushes', async () => {
    const s = bootServer({ vapidKeys: null });
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    try {
      insertChiefThread(s, 'chief-thread-2');
      createOrGetQuestion(
        { db: s.db, hub: s.hub, user: s.user, vapidKeys: null },
        {
          threadId: 'chief-thread-2',
          requestId: 'ask-q2',
          questions: [{ header: 'h', question: 'q?', options: [] }],
        },
      );
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('parallel delivery reaches a live endpoint while another is stalled', async () => {
    const fake = await fakePushServer();
    fake.stall('/stalled');
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    const vapid = s.vapidKeys;
    if (vapid === null) throw new Error('test VAPID keys missing');
    let delivery: ReturnType<typeof sendPushToUser> | undefined;
    try {
      await subscribe(s.app, s.team.id, fake.endpoint('/stalled'));
      await subscribe(s.app, s.team.id, fake.endpoint('/live'));
      delivery = sendPushToUser(s.db, vapid, s.user.id, s.team.id, {
        title: 'Title',
        body: 'Body',
        href: '/app',
        tag: 'tag',
      });
      await expect
        .poll(() => fake.requests.some((request) => request.path === '/live'), { timeout: 1500 })
        .toBe(true);
      expect(fake.requests.some((request) => request.path === '/stalled')).toBe(true);
    } finally {
      fake.close();
      await delivery;
      s.dispose();
    }
  });

  test('passes a socket timeout and message TTL to every request', async () => {
    const s = bootServer();
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    try {
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/subscription');
      const vapid = s.vapidKeys;
      if (vapid === null) throw new Error('test VAPID keys missing');
      await sendPushToUser(s.db, vapid, s.user.id, s.team.id, {
        title: 'Title',
        body: 'Body',
        href: '/app',
        tag: 'tag',
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[2]).toMatchObject({ timeout: 10_000, TTL: 3_600 });
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });
});

describe('digest routing: merged, failed, plan-ready, review queue; 410 prunes', () => {
  function digestRows(s: ReturnType<typeof bootServer>) {
    return s.db.select().from(pushDigestItem).all();
  }

  test('PATCH todo phase to confirm queues for the digest and sends no immediate push', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      await subscribe(s.app, s.team.id, fake.endpoint('/route'), 'https://cairn.example');
      const todo = await makeTodo(s);
      const response = await req(s.app, 'PATCH', `/api/todos/${todo.id}`, { phase: 'confirm' });
      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fake.requests).toHaveLength(0);
      expect(digestRows(s)).toHaveLength(1);
      expect(digestRows(s)[0]?.href).toBe(`/app/todo/${todo.id}`);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('queues build review for the digest without an immediate push', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      await subscribe(s.app, s.team.id, fake.endpoint('/review'), 'https://cairn.example');
      const todo = await makeTodo(s);
      setTodoPhase(s.svc, todo.id, 'confirm');
      setTodoPhase(s.svc, todo.id, 'building');
      setTodoPhase(s.svc, todo.id, 'review');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fake.requests).toHaveLength(0);
      expect(digestRows(s)).toHaveLength(2);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('queues merged PR reconciliation for the digest without an immediate push', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      const endpoint = fake.endpoint('/merged');
      await subscribe(s.app, s.team.id, endpoint, 'https://cairn.example');
      const todo = await makeTodo(s);
      setTodoPhase(s.svc, todo.id, 'confirm');
      setTodoPhase(s.svc, todo.id, 'building');
      const buildId = 'build-push-1';
      s.db
        .insert(buildTable)
        .values({
          id: buildId,
          todoId: todo.id,
          withPlan: false,
          triggerSource: 'user',
          createdAt: 0,
          prNumber: 42,
          prUrl: 'https://github.com/x/y/pull/42',
        })
        .run();
      setTodoPhase(s.svc, todo.id, 'review');
      finishTodoDone(s.svc, todo.id, buildId);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fake.requests).toHaveLength(0);
      const rows = digestRows(s);
      expect(rows.some((row) => row.body.includes('PR #42'))).toBe(true);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('queues failed work for the digest without an immediate push', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      await subscribe(s.app, s.team.id, fake.endpoint('/failed'), 'https://cairn.example');
      const todo = await makeTodo(s);
      setTodoPhase(s.svc, todo.id, 'confirm');
      setTodoPhase(s.svc, todo.id, 'building');
      setTodoPhase(s.svc, todo.id, 'failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fake.requests).toHaveLength(0);
      expect(digestRows(s).some((row) => row.body.includes('写周报'))).toBe(true);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('completed work without a PR is queued once and never pushed immediately', async () => {
    const s = bootServer();
    const send = vi.spyOn(webpush, 'sendNotification');
    try {
      const todo = await makeTodo(s);
      setTodoPhase(s.svc, todo.id, 'confirm');
      setTodoPhase(s.svc, todo.id, 'building');
      setTodoPhase(s.svc, todo.id, 'done');
      setTodoPhase(s.svc, todo.id, 'done');
      expect(digestRows(s).filter((row) => row.title === 'Task completed')).toHaveLength(1);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('prunes a 410 subscription while delivering to live subscriptions', async () => {
    const fake = await fakePushServer();
    const s = bootServer({ pushEndpointHosts: TEST_PUSH_HOSTS });
    try {
      const liveEndpoint = fake.endpoint('/live');
      const goneEndpoint = fake.endpoint('/gone');
      fake.status('/gone', 410);
      await subscribe(s.app, s.team.id, liveEndpoint, 'https://cairn.example');
      await subscribe(s.app, s.team.id, goneEndpoint, 'https://cairn.example');
      const vapid = s.vapidKeys;
      if (vapid === null) throw new Error('test VAPID keys missing');
      await sendPushToUser(s.db, vapid, s.user.id, s.team.id, {
        title: 't',
        body: 'b',
        href: '/app',
        tag: 'tag',
      });
      await expect
        .poll(() => subRows(s).some((r) => r.endpoint === goneEndpoint), { timeout: 3000 })
        .toBe(false);
      expect(subRows(s).some((r) => r.endpoint === liveEndpoint)).toBe(true);
    } finally {
      fake.close();
      s.dispose();
    }
  });

  test('sends nothing when VAPID is disabled', async () => {
    const s = bootServer({ vapidKeys: null });
    const todo = await makeTodo(s);
    setTodoPhase(s.svc, todo.id, 'confirm');
    setTodoPhase(s.svc, todo.id, 'building');
    setTodoPhase(s.svc, todo.id, 'failed');
    const send = vi.spyOn(webpush, 'sendNotification');
    try {
      await sweepPushDigest(s.db, null);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });
});

describe('digest sweep job', () => {
  test('sends one push per subscription with the queued items, then clears them', async () => {
    const s = bootServer();
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    try {
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/sub-1');
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/sub-2');
      const todo = await makeTodo(s);
      setTodoPhase(s.svc, todo.id, 'confirm');
      const vapid = s.vapidKeys;
      if (vapid === null) throw new Error('test VAPID keys missing');
      await sweepPushDigest(s.db, vapid);
      expect(send).toHaveBeenCalledTimes(2);
      const payload = JSON.parse(String(send.mock.calls[0]?.[1] ?? '{}')) as {
        notification: { title: string; body: string; tag: string };
      };
      expect(payload.notification.tag).toBe(`${s.user.id}:digest`);
      expect(payload.notification.body).toContain('写周报');
      expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
      send.mockClear();
      await sweepPushDigest(s.db, vapid);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('preserves events queued while a digest is being delivered', async () => {
    const s = bootServer();
    const message = { title: 'Merged', body: 'First event', href: '/app', tag: 'digest' };
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation(async () => {
      queuePushDigest(s.db, s.user.id, s.team.id, { ...message, body: 'New event' });
      return { statusCode: 201, body: '', headers: {} };
    });
    try {
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/sub-1');
      queuePushDigest(s.db, s.user.id, s.team.id, message);
      await sweepPushDigest(s.db, s.vapidKeys);
      expect(
        s.db
          .select()
          .from(pushDigestItem)
          .all()
          .map((row) => row.body),
      ).toEqual(['New event']);
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('keeps queued events when every delivery fails transiently', async () => {
    const s = bootServer();
    const send = vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('Unavailable'));
    try {
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/sub-1');
      queuePushDigest(s.db, s.user.id, s.team.id, {
        title: 'Failed',
        body: 'Retry later',
        href: '/app',
        tag: 'digest',
      });
      await sweepPushDigest(s.db, s.vapidKeys);
      expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('rejects invalid, duplicate, or non-paired digest times', () => {
    expect(loadConfig().pushDigestTimes).toEqual(['09:00', '18:00']);
    for (const times of [['25:00', '18:00'], ['09:60', '18:00'], ['09:00'], ['09:00', '09:00']]) {
      expect(() => loadConfig({ pushDigestTimes: times })).toThrow();
    }
  });

  test('scheduler delivers at both local slots without overlapping sweeps', async () => {
    const s = bootServer();
    let release: (() => void) | undefined;
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ statusCode: 201, body: '', headers: {} });
        }),
    );
    const scheduler = createScheduler(s.svc, {
      tickMs: 15_000,
      pushDigestTimes: ['09:00', '18:00'],
    });
    const message = { title: 'Merged', body: 'Task done', href: '/app', tag: 'digest' };
    try {
      await subscribe(s.app, s.team.id, 'https://fcm.googleapis.com/sub-1');
      queuePushDigest(s.db, s.user.id, s.team.id, message);
      scheduler.tick(new Date(2026, 0, 2, 8, 59).getTime());
      expect(send).not.toHaveBeenCalled();
      scheduler.tick(new Date(2026, 0, 2, 9, 0).getTime());
      expect(send).toHaveBeenCalledTimes(1);
      scheduler.tick(new Date(2026, 0, 2, 18, 0).getTime());
      expect(send).toHaveBeenCalledTimes(1);
      release?.();
      await expect.poll(() => s.db.select().from(pushDigestItem).all().length).toBe(0);
      queuePushDigest(s.db, s.user.id, s.team.id, message);
      scheduler.tick(new Date(2026, 0, 2, 18, 1).getTime());
      expect(send).toHaveBeenCalledTimes(2);
      release?.();
      await expect.poll(() => s.db.select().from(pushDigestItem).all().length).toBe(0);
      scheduler.tick(new Date(2026, 0, 2, 18, 2).getTime());
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      release?.();
      scheduler.stop();
      send.mockRestore();
      s.dispose();
    }
  });

  test('an empty queue sends nothing', async () => {
    const s = bootServer();
    const send = vi.spyOn(webpush, 'sendNotification');
    try {
      const vapid = s.vapidKeys;
      if (vapid === null) throw new Error('test VAPID keys missing');
      await sweepPushDigest(s.db, vapid);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('queuePushDigest writes one row per event', async () => {
    const s = bootServer();
    try {
      queuePushDigest(s.db, s.user.id, s.team.id, {
        title: 'PR 已合并',
        body: '#9 写周报',
        href: '/app/todo/todo-1',
        tag: 'x',
      });
      expect(s.db.select().from(pushDigestItem).all()).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('digestSlotsDue fires each configured local time once per day', async () => {
    const times = ['09:00', '18:00'];
    const last = new Map<string, number>();
    const morning = new Date(2026, 0, 2, 9, 1).getTime();
    const afternoon = new Date(2026, 0, 2, 18, 1).getTime();
    const nextDay = new Date(2026, 0, 3, 9, 1).getTime();
    const first = digestSlotsDue(morning, times, last);
    expect(first).toEqual(['09:00']);
    const at = digestSlotDueAt(morning, '09:00');
    if (at !== null) last.set('09:00', at);
    expect(digestSlotsDue(new Date(2026, 0, 2, 12, 0).getTime(), times, last)).toEqual([]);
    const second = digestSlotsDue(afternoon, times, last);
    expect(second).toEqual(['18:00']);
    const afternoonAt = digestSlotDueAt(afternoon, '18:00');
    if (afternoonAt !== null) last.set('18:00', afternoonAt);
    expect(digestSlotsDue(new Date(2026, 0, 2, 23, 0).getTime(), times, last)).toEqual([]);
    expect(digestSlotsDue(nextDay, times, last)).toEqual(['09:00']);
    expect(digestSlotsDue(morning, [], last)).toEqual([]);
  });
});
