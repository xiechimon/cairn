import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  BROWSER_AUTH_HEADER,
  CLOUD_URL_ENV,
  DEFAULT_CAIRN_CLOUD_URL,
  ENV_VARS,
  resolveDesktopCloudUrl,
} from '@cairn/shared';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { loadConfig } from '../src/config.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { cloudAccountFilePath } from '../src/services/cloud-account.js';
import { issuePairingGrant, pairFromGrant } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const OWNER = 'cloud-account-owner-token-0123456789abcdef';
const CLOUD_URL = 'https://cairn-cloud-portal.fly.dev';
const tempDirs: string[] = [];
const prevCloudEnv = process.env[CLOUD_URL_ENV];
const prevHomeEnv = process.env[ENV_VARS.home];

afterEach(() => {
  if (prevCloudEnv === undefined) delete process.env[CLOUD_URL_ENV];
  else process.env[CLOUD_URL_ENV] = prevCloudEnv;
  if (prevHomeEnv === undefined) delete process.env[ENV_VARS.home];
  else process.env[ENV_VARS.home] = prevHomeEnv;
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function call(
  appRequest: (input: string, init?: RequestInit) => Response | Promise<Response>,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  return Promise.resolve(
    appRequest(path, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { [BROWSER_AUTH_HEADER]: '1' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );
}

describe('cloud account config and desktop defaults', () => {
  test('resolveDesktopCloudUrl returns default URL unless disabled', () => {
    expect(resolveDesktopCloudUrl({})).toBe(DEFAULT_CAIRN_CLOUD_URL);
    expect(resolveDesktopCloudUrl({ CAIRN_CLOUD_URL: '' })).toBe(DEFAULT_CAIRN_CLOUD_URL);
    expect(resolveDesktopCloudUrl({ CAIRN_CLOUD_URL: 'https://cloud.example.com/' })).toBe(
      'https://cloud.example.com/',
    );
    for (const off of ['off', 'OFF', 'false', 'none', '0']) {
      expect(resolveDesktopCloudUrl({ CAIRN_CLOUD_URL: off })).toBeNull();
    }
  });

  test('loadConfig accepts https or loopback http CAIRN_CLOUD_URL and rejects non-loopback http', () => {
    const home = makeTestTempDir('cloud-cfg-');
    tempDirs.push(home);
    process.env[ENV_VARS.home] = home;

    process.env[CLOUD_URL_ENV] = 'https://cairn-cloud-portal.fly.dev/';
    expect(loadConfig().cloudUrl).toBe('https://cairn-cloud-portal.fly.dev');

    process.env[CLOUD_URL_ENV] = 'http://127.0.0.1:8788';
    expect(loadConfig().cloudUrl).toBe('http://127.0.0.1:8788');

    process.env[CLOUD_URL_ENV] = 'off';
    expect(loadConfig().cloudUrl).toBeNull();

    process.env[CLOUD_URL_ENV] = 'http://evil.example.com';
    expect(() => loadConfig()).toThrow();
  });
});

describe('cloud account routes and persistence', () => {
  let cloudHandler: (url: string, init?: RequestInit) => Response | Promise<Response> = async () =>
    Response.json({});
  const pkceStates = new Map();
  const s = bootServer({
    authToken: OWNER,
    cloudUrl: CLOUD_URL,
    cloudPkceStates: pkceStates,
    cloudFetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      cloudHandler(typeof input === 'string' ? input : input.toString(), init)) as typeof fetch,
  });

  beforeEach(() => {
    pkceStates.clear();
    rmSync(cloudAccountFilePath(s.dataDir), { force: true });
  });

  test('unconfigured CAIRN_CLOUD_URL reports configured:false and rejects connect start with 409', async () => {
    const unconfigured = bootServer({ authToken: OWNER, cloudUrl: null });
    const statusRes = await call(unconfigured.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toMatchObject({ configured: false, linked: false });

    const startRes = await call(unconfigured.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: {},
    });
    expect(startRes.status).toBe(409);
  });

  test('paired device (via=device) receives 403 on every owner cloud route', async () => {
    const grant = issuePairingGrant(s.db);
    const paired = pairFromGrant(s.db, {
      code: grant.code,
      teamId: s.team.id,
      name: 'iPhone',
      browserMarkHash: null,
    });
    expect(paired).not.toBeNull();
    const deviceHeaders = { authorization: `Bearer ${paired!.token}` };

    for (const [method, path] of [
      ['GET', '/api/cloud/status'],
      ['POST', '/api/cloud/connect/start'],
      ['POST', '/api/cloud/checkout'],
      ['POST', '/api/cloud/billing-portal'],
      ['POST', '/api/cloud/disconnect'],
    ] as const) {
      const res = await call(s.app.request, method, path, {
        headers: deviceHeaders,
        ...(method === 'GET' ? {} : { body: {} }),
      });
      expect(res.status).toBe(403);
    }
  });

  test('validates returnTo paths and rejects unsafe control-plane redirect URLs', async () => {
    cloudHandler = async (url, init) => {
      if (url === `${CLOUD_URL}/api/app-auth/exchange`) {
        return Response.json({
          accessToken: 'ccs_test_token_1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: { sub: 'user_1', name: 'Mon', email: null, avatarUrl: 'https://img.example/a.png' },
        });
      }
      if (url === `${CLOUD_URL}/api/billing/checkout` && init?.method === 'POST') {
        return Response.json({ checkoutUrl: 'http://evil-checkout.example/pay' });
      }
      if (url === `${CLOUD_URL}/api/billing/portal` && init?.method === 'POST') {
        return Response.json({ portalUrl: 'javascript:alert(1)' });
      }
      return Response.json({
        user: { sub: 'user_1', name: 'Mon', email: null, avatarUrl: 'https://img.example/a.png' },
        subscribed: false,
        hasBillingCustomer: true,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        tenant: { appName: 'u-1', url: 'http://insecure.example', status: 'ready', region: 'sin' },
      });
    };

    for (const bad of [
      'https://evil.com/phish',
      '//evil.com',
      '/settings',
      '/app\\evil',
      '/app@evil',
    ]) {
      const res = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
        headers: { authorization: `Bearer ${OWNER}` },
        body: { returnTo: bad },
      });
      expect(res.status).toBe(400);
    }

    const startRes = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: { returnTo: '/app?project=p1' },
    });
    expect(startRes.status).toBe(200);
    const { authorizationUrl } = (await startRes.json()) as { authorizationUrl: string };
    const state = new URL(authorizationUrl).searchParams.get('state')!;
    const cbRes = await call(
      s.app.request,
      'GET',
      `/api/cloud/callback?code=cca_ok&state=${state}`,
    );
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe('/app?project=p1&cloud=connected');

    const statusRes = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as { workspace: { url: string | null } };
    expect(statusBody.workspace?.url).toBeNull();

    const checkoutRes = await call(s.app.request, 'POST', '/api/cloud/checkout', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(checkoutRes.status).toBe(502);

    const portalRes = await call(s.app.request, 'POST', '/api/cloud/billing-portal', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(portalRes.status).toBe(502);
  });

  test('PKCE exchange verifies S256 challenge, prevents state replay, and serves escaped Desktop completion HTML', async () => {
    let seenVerifier = '';
    cloudHandler = async (url, init) => {
      if (url === `${CLOUD_URL}/api/app-auth/exchange`) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { codeVerifier: string };
        seenVerifier = body.codeVerifier;
        return Response.json({
          accessToken: 'ccs_desktop_token',
          expiresAt: Date.now() + 3_600_000,
          user: {
            sub: 'user_desk',
            name: '<script>alert(1)</script>',
            email: null,
            avatarUrl: null,
          },
        });
      }
      if (url === `${CLOUD_URL}/api/app-auth/revoke`) {
        return Response.json({ ok: true });
      }
      return Response.json({
        user: {
          sub: 'user_desk',
          name: '<script>alert(1)</script>',
          email: null,
          avatarUrl: null,
        },
        subscribed: true,
        hasBillingCustomer: true,
        subscriptionStatus: 'active',
        currentPeriodEnd: 1_800_000_000_000,
        tenant: {
          appName: 'u-desk',
          url: 'https://u-desk.fly.dev',
          status: 'ready',
          region: 'sin',
        },
      });
    };

    const startRes = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}`, host: '127.0.0.1:8787' },
      body: { shell: 'desktop', returnTo: '/app' },
    });
    const { authorizationUrl } = (await startRes.json()) as { authorizationUrl: string };
    const authUrl = new URL(authorizationUrl);
    const challenge = authUrl.searchParams.get('code_challenge');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authUrl.searchParams.get('state')!;
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:8787/api/cloud/callback',
    );

    const cbRes = await call(
      s.app.request,
      'GET',
      `/api/cloud/callback?code=cca_desk&state=${encodeURIComponent(state)}`,
    );
    expect(cbRes.status).toBe(200);
    expect(cbRes.headers.get('x-frame-options')).toBe('DENY');
    const html = await cbRes.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(createHash('sha256').update(seenVerifier, 'ascii').digest('base64url')).toBe(challenge);

    const replay = await call(
      s.app.request,
      'GET',
      `/api/cloud/callback?code=cca_desk&state=${encodeURIComponent(state)}`,
    );
    expect(replay.status).toBe(302);
    expect(replay.headers.get('location')).toBe('/app?cloud=error&reason=state');

    const encPath = cloudAccountFilePath(s.dataDir);
    expect(existsSync(encPath)).toBe(true);

    const statusRes = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toMatchObject({
      configured: true,
      linked: true,
      subscribed: true,
      currentPeriodEnd: new Date(1_800_000_000_000).toISOString(),
      workspace: { appName: 'u-desk', url: 'https://u-desk.fly.dev/', status: 'ready' },
    });

    const disconnectRes = await call(s.app.request, 'POST', '/api/cloud/disconnect', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(disconnectRes.status).toBe(200);
    expect(existsSync(encPath)).toBe(false);
  });

  test('handles 401 clear vs concurrent login race, corrupt/expired files, offline fallback, and PKCE 32-flow cap', async () => {
    let releaseMeGate!: () => void;
    const meInFlightGate = new Promise<void>((resolve) => {
      releaseMeGate = resolve;
    });
    let notifyEnteredMe!: () => void;
    const enteredMeGate = new Promise<void>((resolve) => {
      notifyEnteredMe = resolve;
    });
    let pauseOnMe = false;
    let meStatusCode = 200;
    let exchangeSeq = 0;
    let exchangeExpiresAt: number | string = '2099-01-01T00:00:00.000Z';

    cloudHandler = async (url) => {
      if (url === `${CLOUD_URL}/api/me`) {
        if (pauseOnMe) {
          pauseOnMe = false;
          notifyEnteredMe();
          await meInFlightGate;
        }
        if (meStatusCode === 401) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        if (meStatusCode === 503) return new Response('down', { status: 503 });
        return Response.json({
          user: { sub: 'user_new', name: 'New Mon', email: null, avatarUrl: null },
          subscribed: false,
          hasBillingCustomer: false,
          subscriptionStatus: null,
          currentPeriodEnd: null,
          tenant: null,
        });
      }
      if (url === `${CLOUD_URL}/api/app-auth/exchange`) {
        exchangeSeq += 1;
        return Response.json({
          accessToken: `ccs_fresh_token_${exchangeSeq}`,
          expiresAt: exchangeExpiresAt,
          user: { sub: 'user_new', name: 'New Mon', email: null, avatarUrl: null },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const filePath = cloudAccountFilePath(s.dataDir);
    mkdirSync(s.dataDir, { recursive: true });

    const otherBox = createEphemeralSecretBox();
    writeFileSync(filePath, otherBox.seal('corrupt'), { mode: 0o600 });
    const corruptRes = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(corruptRes.status).toBe(200);
    expect(await corruptRes.json()).toMatchObject({ linked: false });

    const start1 = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: { returnTo: '/app' },
    });
    const state1 = new URL(
      ((await start1.json()) as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state')!;
    const cb1 = await call(s.app.request, 'GET', `/api/cloud/callback?code=c1&state=${state1}`);
    expect(cb1.status).toBe(302);

    meStatusCode = 503;
    const offlineRes = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(offlineRes.status).toBe(200);
    expect(await offlineRes.json()).toMatchObject({
      linked: true,
      cloudReachable: false,
      user: { sub: 'user_new', name: 'New Mon' },
    });

    pauseOnMe = true;
    meStatusCode = 401;
    const statusPromise = call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    await enteredMeGate;
    const start2 = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: { returnTo: '/app' },
    });
    const state2 = new URL(
      ((await start2.json()) as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state')!;
    await call(s.app.request, 'GET', `/api/cloud/callback?code=c2&state=${state2}`);
    releaseMeGate();
    await statusPromise;
    expect(existsSync(filePath)).toBe(true);

    meStatusCode = 200;
    const afterRace = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect((await afterRace.json()) as { linked: boolean }).toMatchObject({ linked: true });

    pkceStates.clear();
    pkceStates.set('stale-1', {
      verifier: 'v',
      returnTo: '/app',
      origin: 'http://localhost',
      shell: 'browser',
      createdAt: Date.now() - 11 * 60_000,
    });
    for (let i = 0; i < 32; i += 1) {
      const res = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
        headers: { authorization: `Bearer ${OWNER}` },
        body: {},
      });
      expect(res.status).toBe(200);
    }
    expect(pkceStates.has('stale-1')).toBe(false);
    const capRes = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: {},
    });
    expect(capRes.status).toBe(429);

    pkceStates.clear();
    exchangeExpiresAt = '2020-01-01T00:00:00.000Z';
    const expStart = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: {},
    });
    const expState = new URL(
      ((await expStart.json()) as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state')!;
    await call(s.app.request, 'GET', `/api/cloud/callback?code=c&state=${expState}`);
    const expStatus = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(await expStatus.json()).toMatchObject({ linked: false });

    exchangeExpiresAt = '2099-01-01T00:00:00.000Z';
    const s401 = await call(s.app.request, 'POST', '/api/cloud/connect/start', {
      headers: { authorization: `Bearer ${OWNER}` },
      body: {},
    });
    const state401 = new URL(
      ((await s401.json()) as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state')!;
    await call(s.app.request, 'GET', `/api/cloud/callback?code=c401&state=${state401}`);
    meStatusCode = 401;
    const clearedOn401 = await call(s.app.request, 'GET', '/api/cloud/status', {
      headers: { authorization: `Bearer ${OWNER}` },
    });
    expect(await clearedOn401.json()).toMatchObject({ linked: false });
    expect(existsSync(filePath)).toBe(false);
  });
});
