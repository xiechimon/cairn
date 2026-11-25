import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOST_UPDATE_REQUEST_FILE,
  HOST_UPDATE_STATUS_FILE,
  type HostUpdateStatus,
  serverUpdateResponseSchema,
  serverVersionResponseSchema,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { chief, chiefThread, step } from '../src/db/schema.js';
import {
  maybeRetriggerIdleHostUpdate,
  readServerVersionInfo,
} from '../src/services/server-version.js';
import { bootServer, redeemTestPairing, req, type TestServer } from './helpers.js';

const TOKEN = 'cairn-remote-version-test-token-0123456789';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

const cleanupDirs: string[] = [];
const servers: TestServer[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of servers.splice(0)) s.dispose();
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function reqWith(
  s: TestServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

function writeStatus(homeDir: string, status: HostUpdateStatus): void {
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, HOST_UPDATE_STATUS_FILE), `${JSON.stringify(status)}\n`, {
    mode: 0o600,
  });
}

describe('GET /api/server/version and POST /api/server/update', () => {
  test('requires auth when token auth is enabled and allows owner and paired device', async () => {
    vi.stubEnv('CAIRN_SERVER_VERSION', '0.1.720');
    vi.stubEnv('CAIRN_SERVER_COMMIT', 'abc1234');
    const s = bootServer({ authToken: TOKEN });
    servers.push(s);

    expect((await req(s.app, 'GET', '/api/server/version')).status).toBe(401);
    expect((await req(s.app, 'POST', '/api/server/update', {})).status).toBe(401);

    const ownerRes = await reqWith(s, 'GET', '/api/server/version', authHeaders);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.headers.get('cache-control')).toContain('no-store');
    const parsed = serverVersionResponseSchema.parse(await ownerRes.json());
    expect(parsed.version).toBe('0.1.720');
    expect(parsed.commit).toBe('abc1234');
    expect(parsed.busy).toBe(false);
    expect(parsed.updater.supported).toBe(false);
    expect(parsed.updater.state).toBe('unsupported');
    expect(parsed.updater.reason).toBe('no-updater');

    const issued = await reqWith(s, 'POST', '/api/remote/pairing', authHeaders);
    const { code } = (await issued.json()) as { code: string };
    const paired = await redeemTestPairing(s.app, code, 'macbook');
    const { token } = (await paired.json()) as { token: string };
    const deviceRes = await reqWith(s, 'GET', '/api/server/version', {
      authorization: `Bearer ${token}`,
    });
    expect(deviceRes.status).toBe(200);
  });

  test('reports busy true when a chief turn or claimed build step is active', async () => {
    vi.stubEnv('CAIRN_SERVER_VERSION', '0.1.720');
    const s = bootServer({ authToken: null });
    servers.push(s);

    const idleBody = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(idleBody.busy).toBe(false);

    const now = Date.now();
    s.db
      .insert(chief)
      .values({ id: 'chief-busy', userId: s.user.id, teamId: s.team.id, createdAt: now })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'thread-busy',
        chiefId: 'chief-busy',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Busy thread',
        activeRun: { phase: 'chief' },
        createdAt: now,
        updatedAt: now,
        sessionId: 'thread-busy',
        sessionOpenedAt: now,
      })
      .run();

    const busyTurn = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(busyTurn.busy).toBe(true);

    s.db.delete(chiefThread).run();

    s.db
      .insert(step)
      .values({
        id: 'step-claimed',
        buildId: 'build-1',
        kind: 'build',
        status: 'claimed',
        createdAt: now,
        claimedAt: now,
      })
      .run();

    const busyStep = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(busyStep.busy).toBe(true);
  });

  test('reads live host-update-status.json and ignores stale in-progress status from dead PID', async () => {
    const homeDir = makeTestTempDir('cairn-ver-status-');
    cleanupDirs.push(homeDir);
    const s = bootServer({ authToken: null, homeDir });
    servers.push(s);

    writeStatus(homeDir, {
      pid: process.pid,
      kind: 'desktop',
      supported: true,
      blocker: null,
      state: 'downloading',
      targetVersion: '0.1.721',
      percent: 45,
      reason: null,
      handledRequestId: 'req-1',
      updatedAt: Date.now(),
    });

    const liveRes = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(liveRes.updater).toMatchObject({
      supported: true,
      state: 'downloading',
      targetVersion: '0.1.721',
      percent: 45,
      reason: null,
    });

    writeStatus(homeDir, {
      pid: 999_999,
      kind: 'desktop',
      supported: true,
      blocker: null,
      state: 'downloading',
      targetVersion: '0.1.721',
      percent: 45,
      reason: null,
      handledRequestId: 'req-1',
      updatedAt: Date.now() - 15 * 60_000,
    });

    const staleRes = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(staleRes.updater.state).toBe('idle');
    expect(staleRes.updater.percent).toBeNull();
  });

  test('POST /api/server/update returns unsupported when no updater exists and writes 0600 request + triggers once when supported', async () => {
    const homeDir = makeTestTempDir('cairn-ver-trigger-');
    cleanupDirs.push(homeDir);
    const triggers: Array<{ id: string; requestedVersion: string | null }> = [];
    const s = bootServer({
      authToken: null,
      homeDir,
      hostUpdate: {
        trigger: async (request) => {
          triggers.push({ id: request.id, requestedVersion: request.requestedVersion });
        },
      },
    });
    servers.push(s);

    const unsupportedRes = await req(s.app, 'POST', '/api/server/update', {
      targetVersion: '0.1.721',
    });
    expect(unsupportedRes.status).toBe(200);
    const unsupported = serverUpdateResponseSchema.parse(await unsupportedRes.json());
    expect(unsupported.accepted).toBe(false);
    expect(unsupported.updater.state).toBe('unsupported');
    expect(triggers).toHaveLength(0);

    writeStatus(homeDir, {
      pid: process.pid,
      kind: 'desktop',
      supported: true,
      blocker: null,
      state: 'idle',
      targetVersion: null,
      percent: null,
      reason: null,
      handledRequestId: null,
      updatedAt: Date.now(),
    });

    const acceptedRes = await req(s.app, 'POST', '/api/server/update', {
      targetVersion: '0.1.721',
    });
    expect(acceptedRes.status).toBe(202);
    const accepted = serverUpdateResponseSchema.parse(await acceptedRes.json());
    expect(accepted.accepted).toBe(true);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.requestedVersion).toBe('0.1.721');

    const reqPath = join(homeDir, HOST_UPDATE_REQUEST_FILE);
    const mode = statSync(reqPath).mode & 0o777;
    expect(mode).toBe(0o600);
    const written = JSON.parse(readFileSync(reqPath, 'utf8')) as {
      id: string;
      requestedVersion: string | null;
    };
    expect(written.id).toBe(triggers[0]?.id);
    expect(written.requestedVersion).toBe('0.1.721');

    const duplicateRes = await req(s.app, 'POST', '/api/server/update', {
      targetVersion: '0.1.721',
    });
    expect(duplicateRes.status).toBe(202);
    expect(triggers).toHaveLength(1);
  });

  test('detects launchd resident updater plist as supported when desktop status file is absent', async () => {
    const homeDir = makeTestTempDir('cairn-ver-launchd-');
    const plistPath = join(homeDir, 'app.cairn.updater.plist');
    cleanupDirs.push(homeDir);
    writeFileSync(plistPath, '<plist/>');
    chmodSync(plistPath, 0o600);

    vi.stubEnv('CAIRN_MANAGED_BY', 'launchd');
    vi.stubEnv('CAIRN_UPDATER_PLIST', plistPath);

    const triggers: string[] = [];
    const s = bootServer({
      authToken: null,
      homeDir,
      hostUpdate: {
        trigger: async (request) => {
          triggers.push(request.id);
        },
      },
    });
    servers.push(s);

    const version = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(version.updater.supported).toBe(true);
    expect(version.updater.state).toBe('idle');

    const res = await req(s.app, 'POST', '/api/server/update', { targetVersion: '0.1.722' });
    expect(res.status).toBe(202);
    expect(triggers).toHaveLength(1);
  });

  test('keeps background-agent waiting-idle after one-shot updater exits and retriggers when server becomes idle', async () => {
    const homeDir = makeTestTempDir('cairn-ver-bg-idle-');
    const plistPath = join(homeDir, 'app.cairn.updater.plist');
    cleanupDirs.push(homeDir);
    writeFileSync(plistPath, '<plist/>');
    chmodSync(plistPath, 0o600);

    vi.stubEnv('CAIRN_MANAGED_BY', 'launchd');
    vi.stubEnv('CAIRN_UPDATER_PLIST', plistPath);

    const triggers: string[] = [];
    const s = bootServer({
      authToken: null,
      homeDir,
      hostUpdate: {
        trigger: async (request) => {
          triggers.push(request.id);
        },
      },
    });
    servers.push(s);

    const now = Date.now();
    s.db
      .insert(chief)
      .values({ id: 'chief-1', userId: s.user.id, teamId: s.team.id, createdAt: now })
      .run();
    s.db
      .insert(chiefThread)
      .values({
        id: 'thread-1',
        chiefId: 'chief-1',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Busy',
        activeRun: { phase: 'chief' },
        createdAt: now,
        updatedAt: now,
        sessionId: 'thread-1',
        sessionOpenedAt: now,
      })
      .run();

    const first = await req(s.app, 'POST', '/api/server/update', { targetVersion: '0.1.722' });
    expect(first.status).toBe(202);
    expect(triggers).toHaveLength(1);
    const reqJson = JSON.parse(readFileSync(join(homeDir, HOST_UPDATE_REQUEST_FILE), 'utf8')) as {
      id: string;
    };

    writeStatus(homeDir, {
      pid: 999_999,
      kind: 'background-agent',
      supported: true,
      blocker: null,
      state: 'waiting-idle',
      targetVersion: '0.1.722',
      percent: 100,
      reason: null,
      handledRequestId: reqJson.id,
      updatedAt: now,
    });

    const versionWhileBusy = serverVersionResponseSchema.parse(
      await (await req(s.app, 'GET', '/api/server/version')).json(),
    );
    expect(versionWhileBusy.busy).toBe(true);
    expect(versionWhileBusy.updater.state).toBe('waiting-idle');

    const retriggerBusy = await maybeRetriggerIdleHostUpdate({
      db: s.db,
      homeDir,
      hostUpdate: {
        now: () => now + 60_000,
        trigger: async (request) => {
          triggers.push(request.id);
        },
      },
    });
    expect(retriggerBusy).toBe(false);
    expect(triggers).toHaveLength(1);

    s.db.delete(chiefThread).run();

    const retriggerIdle = await maybeRetriggerIdleHostUpdate({
      db: s.db,
      homeDir,
      hostUpdate: {
        now: () => now + 60_000,
        trigger: async (request) => {
          triggers.push(request.id);
        },
      },
    });
    expect(retriggerIdle).toBe(true);
    expect(triggers).toHaveLength(2);
  });

  test('rejects invalid targetVersion and reads version from app bundle Info.plist fallback', async () => {
    const appDir = makeTestTempDir('cairn-ver-plist-');
    cleanupDirs.push(appDir);
    const plistDir = join(appDir, 'Cairn.app', 'Contents');
    mkdirSync(join(plistDir, 'MacOS'), { recursive: true });
    writeFileSync(
      join(plistDir, 'Info.plist'),
      '<plist><dict><key>CFBundleShortVersionString</key><string>0.1.719</string></dict></plist>',
    );
    expect(
      readServerVersionInfo({
        env: {},
        execPath: join(plistDir, 'MacOS', 'Cairn'),
      }).version,
    ).toBe('0.1.719');

    const s = bootServer({ authToken: null });
    servers.push(s);
    const bad = await req(s.app, 'POST', '/api/server/update', { targetVersion: 'not-semver' });
    expect(bad.status).toBe(400);
  });
});
