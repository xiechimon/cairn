import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createSecureServer, type ServerHttp2Session, type ServerHttp2Stream } from 'node:http2';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { apnsDevice } from '../src/db/schema.js';
import { type ApnsConfig, loadApnsConfig } from '../src/services/apns.js';
import { bootServer, postProject, req } from './helpers.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

interface ApnsRequest {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

async function fakeApns() {
  const dir = makeTestTempDir('cairn-apns-cert-');
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
  const requests: ApnsRequest[] = [];
  const replies = new Map<string, { status: number; reason?: string }>();
  const sessions = new Set<ServerHttp2Session>();
  const server = createSecureServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) });
  server.on('session', (session) => sessions.add(session));
  server.on('stream', (stream: ServerHttp2Stream, headers) => {
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      raw += chunk;
    });
    stream.on('end', () => {
      const path = String(headers[':path']);
      requests.push({
        path,
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])),
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      const reply = replies.get(path.split('/').at(-1) ?? '') ?? { status: 200 };
      stream.respond({ ':status': reply.status, 'content-type': 'application/json' });
      stream.end(reply.reason === undefined ? '' : JSON.stringify({ reason: reply.reason }));
    });
  });
  const origin = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(
        typeof address === 'object' && address !== null ? `https://127.0.0.1:${address.port}` : '',
      );
    });
  });
  return {
    origin,
    requests,
    reply: (token: string, status: number, reason?: string) =>
      replies.set(token, { status, reason }),
    close: () => {
      for (const session of sessions) session.destroy();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function bootWithApns(origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const apns: ApnsConfig = {
    key: privateKey,
    keyId: 'KEY1234567',
    teamId: 'TEAM123456',
    bundleId: 'dev.cairn.ios',
    origins: { sandbox: origin, production: origin },
  };
  const s = bootServer({
    vapidKeys: {
      ...webpush.generateVAPIDKeys(),
      subject: 'mailto:push@cairn.dev',
      webOrigin: 'https://cairn.example',
      apns,
    },
  });
  return { s, publicKey };
}

async function register(s: ReturnType<typeof bootServer>, token: string) {
  return req(s.app, 'POST', `/api/teams/${s.team.id}/push/apns-devices`, {
    token,
    environment: 'sandbox',
  });
}

async function needsYou(s: ReturnType<typeof bootServer>) {
  const projectId = await postProject(s.app, 'demo', { mergePolicy: 'human' });
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Stream the order export',
    spec: '',
  });
  const todo = (await created.json()) as { id: string };
  expect((await req(s.app, 'PATCH', `/api/todos/${todo.id}`, { phase: 'confirm' })).status).toBe(
    200,
  );
  return todo.id;
}

describe('APNs delivery', () => {
  test('a needs-you event reaches a registered iPhone with a signed token and the thread href', async () => {
    const apple = await fakeApns();
    const { s, publicKey } = bootWithApns(apple.origin);
    try {
      expect((await register(s, TOKEN_A)).status).toBe(201);
      const todoId = await needsYou(s);
      await expect.poll(() => apple.requests.length, { timeout: 3000 }).toBe(1);
      const [sent] = apple.requests;
      expect(sent?.path).toBe(`/3/device/${TOKEN_A}`);
      expect(sent?.headers['apns-topic']).toBe('dev.cairn.ios');
      expect(sent?.headers['apns-push-type']).toBe('alert');
      expect(sent?.body.href).toBe(`/app/todo/${todoId}`);
      expect(sent?.body.aps).toMatchObject({ alert: { title: '方案已就绪' } });
      const [header, claims, signature] = (sent?.headers.authorization ?? '')
        .replace('bearer ', '')
        .split('.');
      expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
        alg: 'ES256',
        kid: 'KEY1234567',
      });
      expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString()).iss).toBe('TEAM123456');
      expect(
        verify(
          'sha256',
          Buffer.from(`${header}.${claims}`),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);
    } finally {
      apple.close();
      s.dispose();
    }
  });

  test('a dead token is pruned and a transient failure keeps the device', async () => {
    const apple = await fakeApns();
    const { s } = bootWithApns(apple.origin);
    try {
      apple.reply(TOKEN_A, 400, 'BadDeviceToken');
      apple.reply(TOKEN_B, 500, 'InternalServerError');
      await register(s, TOKEN_A);
      await register(s, TOKEN_B);
      await needsYou(s);
      await expect.poll(() => apple.requests.length, { timeout: 3000 }).toBe(2);
      await expect
        .poll(
          () =>
            s.db
              .select({ token: apnsDevice.token })
              .from(apnsDevice)
              .all()
              .map((row) => row.token),
          { timeout: 3000 },
        )
        .toEqual([TOKEN_B]);
    } finally {
      apple.close();
      s.dispose();
    }
  });

  test('registration rejects a malformed token and unregistering removes the device', async () => {
    const s = bootServer();
    try {
      expect((await register(s, 'not-a-token')).status).toBe(400);
      const created = await register(s, TOKEN_A);
      expect(await created.json()).toEqual({ ok: true, delivers: false });
      const removed = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/push/apns-devices`, {
        token: TOKEN_A,
      });
      expect(removed.status).toBe(204);
      expect(s.db.select().from(apnsDevice).all()).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('without CAIRN_APNS_* a registered phone is kept, nothing is sent and nothing is logged', async () => {
    expect(
      loadApnsConfig({ keyPath: null, keyId: null, teamId: null, bundleId: 'dev.cairn.ios' }),
    ).toBeNull();
    expect(() =>
      loadApnsConfig({
        keyPath: null,
        keyId: 'KEY1234567',
        teamId: null,
        bundleId: 'dev.cairn.ios',
      }),
    ).toThrow(/together/);
    const s = bootServer();
    const stderr = vi.spyOn(process.stderr, 'write');
    try {
      await register(s, TOKEN_A);
      await needsYou(s);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(stderr.mock.calls.filter(([line]) => String(line).includes('apns'))).toHaveLength(0);
      expect(s.db.select({ token: apnsDevice.token }).from(apnsDevice).all()).toEqual([
        { token: TOKEN_A },
      ]);
    } finally {
      stderr.mockRestore();
      s.dispose();
    }
  });
});
