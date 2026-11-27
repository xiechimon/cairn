import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOST_UPDATE_REQUEST_FILE,
  HOST_UPDATE_STATUS_FILE,
  type HostUpdateStatus,
  type RemoteVersionState,
  type ServerVersionResponse,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { appMenuTemplate } from '../src/app-menu.js';
import { desktopStateToHostStatus } from '../src/host-update.js';
import { createIdleWatch, type IdleSample, REMOTE_REQUEST_IDLE_MS } from '../src/idle-update.js';
import {
  createRemoteVersionController,
  createUpdateChannelHandlers,
  formatAboutVersion,
} from '../src/remote-version.js';
import { SIGNATURE_REFUSAL } from '../src/update-core.js';

const START = 1_000_000;

function idleSample(at: number, change: Partial<IdleSample> = {}): IdleSample {
  return {
    now: START + at,
    ready: true,
    guardSettled: true,
    locked: false,
    inputIdleMs: 0,
    cairnFocused: true,
    turnInFlight: false,
    dialogOpen: false,
    stepsInFlight: 0,
    ...change,
  };
}

function versionPayload(
  version: string | null,
  overrides: Partial<ServerVersionResponse> = {},
): ServerVersionResponse {
  return {
    version,
    commit: 'abc1234',
    busy: false,
    updater: {
      supported: true,
      state: 'idle',
      targetVersion: null,
      percent: null,
      reason: null,
      updatedAt: null,
    },
    ...overrides,
  };
}

describe('idle-update remote request and serverBusy holds', () => {
  test('remoteRequested applies once safe without waiting 15 minutes, but holds when actively typing or serverBusy', () => {
    const watch = createIdleWatch();
    expect(
      watch.sample(
        idleSample(0, {
          remoteRequested: true,
          cairnFocused: true,
          inputIdleMs: REMOTE_REQUEST_IDLE_MS - 1_000,
        }),
      ),
    ).toEqual({ apply: false, hold: 'in-use' });

    expect(
      watch.sample(
        idleSample(1_000, {
          remoteRequested: true,
          cairnFocused: false,
          serverBusy: true,
        }),
      ),
    ).toEqual({ apply: false, hold: 'steps' });

    expect(
      watch.sample(
        idleSample(2_000, {
          remoteRequested: true,
          cairnFocused: false,
          serverBusy: false,
        }),
      ),
    ).toEqual({ apply: true, trigger: 'remote-request' });

    expect(
      watch.sample(
        idleSample(3_000, {
          remoteRequested: true,
          cairnFocused: true,
          inputIdleMs: REMOTE_REQUEST_IDLE_MS,
          serverBusy: false,
        }),
      ),
    ).toEqual({ apply: true, trigger: 'remote-request' });
  });
});

describe('createRemoteVersionController', () => {
  test('stays current and never triggers update when remote version >= app version', async () => {
    const states: RemoteVersionState[] = [];
    const aboutCalls: Array<{ version: string | null; commit: string | null }> = [];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(versionPayload('0.1.721')), { status: 200 }),
    );

    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.721',
      fetchImpl: fetchMock,
      onState: (next) => states.push(next),
      onAbout: (info) => aboutCalls.push(info),
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state()).toMatchObject({
      phase: 'current',
      serverVersion: '0.1.721',
      serverCommit: 'abc1234',
    });
    expect(aboutCalls.at(-1)).toEqual({ version: '0.1.721', commit: 'abc1234' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test('triggers remote update, survives restart network drop, and reloads once new version answers', async () => {
    const reload = vi.fn();
    let getCount = 0;
    let postCount = 0;
    const responses: Array<() => Response> = [
      () => new Response(JSON.stringify(versionPayload('0.1.720')), { status: 200 }),
      () =>
        new Response(
          JSON.stringify(
            versionPayload('0.1.720', {
              busy: true,
              updater: {
                supported: true,
                state: 'waiting-idle',
                targetVersion: '0.1.721',
                percent: null,
                reason: null,
                updatedAt: Date.now(),
              },
            }),
          ),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify(
            versionPayload('0.1.720', {
              updater: {
                supported: true,
                state: 'restarting',
                targetVersion: '0.1.721',
                percent: null,
                reason: null,
                updatedAt: Date.now(),
              },
            }),
          ),
          { status: 200 },
        ),
      () => {
        throw new TypeError('fetch failed');
      },
      () =>
        new Response(JSON.stringify(versionPayload('0.1.721', { commit: 'def5678' })), {
          status: 200,
        }),
    ];

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST' && url.endsWith('/api/server/update')) {
        postCount += 1;
        expect((init.headers as Record<string, string>)?.origin).toBe(
          'https://remote.example.test',
        );
        return new Response(
          JSON.stringify({
            accepted: true,
            updater: {
              supported: true,
              state: 'checking',
              targetVersion: '0.1.721',
              percent: null,
              reason: null,
              updatedAt: Date.now(),
            },
          }),
          { status: 202 },
        );
      }
      const next = responses[Math.min(getCount, responses.length - 1)];
      if (next === undefined) throw new Error('missing mock response');
      getCount += 1;
      return next();
    });

    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.721',
      pollMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onState: () => {},
      onAbout: () => {},
      onReloadReady: reload,
    });

    await controller.check();
    expect(postCount).toBe(1);
    expect(controller.state().phase).toBe('updating');

    await vi.waitFor(() => {
      expect(controller.state().phase).toBe('current');
    });
    expect(controller.state().serverVersion).toBe('0.1.721');
    expect(controller.state().serverCommit).toBe('def5678');
    expect(reload).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test('detects old server lacking /api/server/version without looping and sets About unknown', async () => {
    const aboutCalls: Array<{ version: string | null; commit: string | null }> = [];
    const fetchMock = vi.fn(async () => new Response('{"error":"Not found"}', { status: 404 }));

    const controller = createRemoteVersionController({
      origin: 'https://old.example.test',
      appVersion: '0.1.721',
      fetchImpl: fetchMock,
      onState: () => {},
      onAbout: (info) => aboutCalls.push(info),
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state()).toMatchObject({
      phase: 'old-server',
      serverVersion: null,
      serverCommit: null,
    });
    expect(aboutCalls.at(-1)).toEqual({ version: null, commit: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test('reports unsupported when remote host has no updater and does not POST update', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            versionPayload('0.1.720', {
              updater: {
                supported: false,
                state: 'unsupported',
                targetVersion: null,
                percent: null,
                reason: 'no-updater',
                updatedAt: null,
              },
            }),
          ),
          { status: 200 },
        ),
    );

    const controller = createRemoteVersionController({
      origin: 'https://cli.example.test',
      appVersion: '0.1.721',
      fetchImpl: fetchMock,
      onState: () => {},
      onAbout: () => {},
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state()).toMatchObject({
      phase: 'unsupported',
      serverVersion: '0.1.720',
      reason: 'no-updater',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test('stops auto-triggering when remote host reports failed and allows manual retry', async () => {
    let postCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST' && url.endsWith('/api/server/update')) {
        postCount += 1;
        return new Response(
          JSON.stringify({
            accepted: true,
            updater: {
              supported: true,
              state: 'failed',
              targetVersion: '0.1.721',
              percent: null,
              reason: 'offline',
              updatedAt: Date.now(),
            },
          }),
          { status: 202 },
        );
      }
      return new Response(
        JSON.stringify(
          versionPayload('0.1.720', {
            updater: {
              supported: true,
              state: postCount > 0 ? 'failed' : 'idle',
              targetVersion: postCount > 0 ? '0.1.721' : null,
              percent: null,
              reason: postCount > 0 ? 'offline' : null,
              updatedAt: Date.now(),
            },
          }),
        ),
        { status: 200 },
      );
    });

    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.721',
      pollMs: 5,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onState: () => {},
      onAbout: () => {},
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state()).toMatchObject({ phase: 'failed', reason: 'offline' });
    expect(postCount).toBe(1);

    await controller.check();
    expect(postCount).toBe(1);

    await controller.retry();
    expect(postCount).toBe(2);
    controller.stop();
  });

  test('waits on 401 awaiting-auth, re-probes on onAuthChanged, and sends same-origin header', async () => {
    let authed = false;
    let postHeaders: Record<string, string> = {};
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!authed) return new Response('Unauthorized', { status: 401 });
      if (init?.method === 'POST' && url.endsWith('/api/server/update')) {
        postHeaders = Object.fromEntries(new Headers(init.headers).entries());
        return new Response(
          JSON.stringify({
            accepted: true,
            updater: {
              supported: true,
              state: 'checking',
              targetVersion: '0.1.721',
              percent: null,
              reason: null,
              updatedAt: Date.now(),
            },
          }),
          { status: 202 },
        );
      }
      return new Response(JSON.stringify(versionPayload('0.1.720')), { status: 200 });
    });

    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.721',
      pollMs: 60_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onState: () => {},
      onAbout: () => {},
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state().phase).toBe('awaiting-auth');

    authed = true;
    controller.onAuthChanged();
    await vi.waitFor(() => {
      expect(controller.state().phase).toBe('updating');
    });
    expect(postHeaders['sec-fetch-site']).toBe('same-origin');
    expect(postHeaders.origin).toBe('https://remote.example.test');
    controller.stop();
  });

  test('transitions to failed when server stays offline past restartTimeoutMs', async () => {
    let nowMs = 1_000;
    let postDone = false;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postDone = true;
        return new Response(
          JSON.stringify({
            accepted: true,
            updater: {
              supported: true,
              state: 'restarting',
              targetVersion: '0.1.721',
              percent: 100,
              reason: null,
              updatedAt: nowMs,
            },
          }),
          { status: 202 },
        );
      }
      if (!postDone) {
        return new Response(JSON.stringify(versionPayload('0.1.720')), { status: 200 });
      }
      nowMs += 20_000;
      return new Response('Bad Gateway', { status: 502 });
    });

    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.721',
      pollMs: 5,
      restartTimeoutMs: 30_000,
      now: () => nowMs,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onState: () => {},
      onAbout: () => {},
      onReloadReady: vi.fn(),
    });

    await controller.check();
    expect(controller.state().phase).toBe('restarting');
    await vi.waitFor(() => {
      expect(controller.state().phase).toBe('failed');
    });
    controller.stop();
  });

  test('maps desktop host status cleanly and separates S5 remote channels from S7 local shell channels', async () => {
    const calls: string[] = [];
    const localState = { status: 'available' as const, version: '0.1.730' };
    const remoteState = {
      phase: 'updating' as const,
      appVersion: '0.1.730',
      serverVersion: '0.1.720',
      serverCommit: '1111111',
      targetVersion: '0.1.730',
      updaterState: 'downloading' as const,
      percent: 45,
      reason: null,
    };
    const channels = createUpdateChannelHandlers({
      localUpdater: {
        state: () => localState,
        check: async () => {
          calls.push('local:check');
        },
        install: async () => {
          calls.push('local:install');
        },
      },
      remote: () => ({
        state: () => remoteState,
        retry: async () => {
          calls.push('remote:retry');
        },
      }),
    });
    expect(channels.shellState()).toEqual(localState);
    expect(channels.remoteState()).toEqual(remoteState);
    await channels.shellCheck();
    await channels.shellInstall();
    await channels.remoteRetry();
    expect(calls).toEqual(['local:check', 'local:install', 'remote:retry']);

    expect(formatAboutVersion('0.1.730', '606d9c2ef')).toEqual({
      applicationVersion: '0.1.730',
      version: '606d9c2',
    });
    expect(formatAboutVersion(null, '606d9c2ef')).toEqual({
      applicationVersion: 'Dev',
      version: '606d9c2',
    });
    expect(formatAboutVersion(null, null)).toEqual({
      applicationVersion: 'Unknown',
      version: '',
    });

    expect(
      desktopStateToHostStatus(
        { status: 'ready', version: '0.1.721' },
        { handledRequestId: 'req-1', now: 100, pid: 42 },
      ),
    ).toMatchObject({
      pid: 42,
      kind: 'desktop',
      state: 'waiting-idle',
      targetVersion: '0.1.721',
      handledRequestId: 'req-1',
    });

    expect(
      desktopStateToHostStatus(
        { status: 'error', message: SIGNATURE_REFUSAL },
        { handledRequestId: 'req-1', now: 100, pid: 42 },
      ),
    ).toMatchObject({ state: 'failed', reason: 'signature-refused' });
  });
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('host-update request deduplication on startup', () => {
  test('ignores already-handled request id or version already satisfied', async () => {
    const mod = (await import('../src/host-update.js')) as Record<string, unknown>;
    expect(typeof mod.initialHandledHostRequestId).toBe('function');
    expect(typeof mod.shouldHandleHostUpdateRequest).toBe('function');
    const dir = makeTestTempDir('cairn-host-upd-');
    tempDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const status: HostUpdateStatus = {
      pid: 100,
      kind: 'desktop',
      supported: true,
      blocker: null,
      state: 'up-to-date',
      targetVersion: null,
      percent: null,
      reason: null,
      handledRequestId: 'req-done',
      updatedAt: 1_000,
    };
    writeFileSync(join(dir, HOST_UPDATE_STATUS_FILE), JSON.stringify(status));
    writeFileSync(
      join(dir, HOST_UPDATE_REQUEST_FILE),
      JSON.stringify({ id: 'req-done', requestedVersion: '0.1.721', requestedAt: 900 }),
    );
    const initial = (mod.initialHandledHostRequestId as (home: string) => string | null)(dir);
    expect(initial).toBe('req-done');
    const shouldHandle = mod.shouldHandleHostUpdateRequest as (
      req: { id: string; requestedVersion: string | null; requestedAt: number },
      opts: { appVersion: string; handledRequestId: string | null },
    ) => boolean;
    expect(
      shouldHandle(
        { id: 'req-done', requestedVersion: '0.1.721', requestedAt: 900 },
        { appVersion: '0.1.720', handledRequestId: initial },
      ),
    ).toBe(false);
    expect(
      shouldHandle(
        { id: 'req-old', requestedVersion: '0.1.721', requestedAt: 900 },
        { appVersion: '0.1.721', handledRequestId: null },
      ),
    ).toBe(false);
    expect(
      shouldHandle(
        { id: 'req-new', requestedVersion: '0.1.722', requestedAt: 900 },
        { appVersion: '0.1.721', handledRequestId: initial },
      ),
    ).toBe(true);
  });
});

describe('appMenuTemplate with remote state', () => {
  test('shows remote update progress without exposing raw errors', () => {
    const menu = appMenuTemplate(
      { status: 'installing', version: '0.1.721' },
      { check: vi.fn(), install: vi.fn() },
      { send: vi.fn(), back: vi.fn(), forward: vi.fn() },
      'en',
    );
    const appSubmenu = menu[0]?.submenu as Array<{ label?: string; enabled?: boolean }>;
    expect(appSubmenu[1]?.label).toContain('0.1.721');
    expect(appSubmenu[1]?.enabled).toBe(false);
  });
});

describe('bidirectional catch-up and rollback notice in remote-version', () => {
  test('queries ?schema=2, notifies onNewerRelease, surfaces rollbackNotice, tolerates v1, and sends force on retry', async () => {
    const seenUrls: string[] = [];
    const postBodies: Array<Record<string, unknown>> = [];
    const newerReleases: string[] = [];
    const states: RemoteVersionState[] = [];

    let mode: 'v2-newer' | 'v1-current' | 'v2-rollback' = 'v2-newer';
    const controller = createRemoteVersionController({
      origin: 'https://remote.example.test',
      appVersion: '0.1.720',
      fetchImpl: async (input, init) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.includes('/api/server/version')) {
          if (mode === 'v2-newer') {
            return new Response(
              JSON.stringify({
                ...versionPayload('0.1.725'),
                latestRelease: '0.1.726',
                rollbackNotice: null,
              }),
              { status: 200 },
            );
          }
          if (mode === 'v1-current') {
            return new Response(JSON.stringify(versionPayload('0.1.720')), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              ...versionPayload('0.1.719', {
                updater: {
                  supported: true,
                  state: 'idle',
                  targetVersion: null,
                  percent: null,
                  reason: 'blocked',
                  updatedAt: 1000,
                },
              }),
              latestRelease: '0.1.720',
              rollbackNotice: {
                failedVersion: '0.1.720',
                restoredVersion: '0.1.719',
                reason: 'health check failed',
                at: 1000,
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/server/update')) {
          postBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return new Response(
            JSON.stringify({
              accepted: true,
              updater: {
                supported: true,
                state: 'checking',
                targetVersion: '0.1.720',
                percent: null,
                reason: null,
                updatedAt: 2000,
              },
            }),
            { status: 202 },
          );
        }
        return new Response('not found', { status: 404 });
      },
      onState: (s) => states.push(s),
      onAbout: vi.fn(),
      onReloadReady: vi.fn(),
      onNewerRelease: (version) => newerReleases.push(version),
    } as Parameters<typeof createRemoteVersionController>[0] & {
      onNewerRelease: (version: string) => void;
    });

    await controller.check();
    expect(seenUrls[0]).toContain('/api/server/version?schema=2');
    expect(newerReleases).toEqual(['0.1.726']);

    mode = 'v1-current';
    await controller.check();
    expect(states.at(-1)?.phase).toBe('current');

    mode = 'v2-rollback';
    await controller.check();
    expect(states.at(-1)?.rollbackNotice).toMatchObject({
      failedVersion: '0.1.720',
      restoredVersion: '0.1.719',
    });

    await controller.retry();
    expect(postBodies.at(-1)).toEqual({ targetVersion: '0.1.720', force: true });
    controller.stop();
  });
});
