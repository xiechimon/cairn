import { describe, expect, test } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import {
  pollGithubDeviceCode,
  refreshGithubDeviceToken,
  requestGithubDeviceCode,
} from '../src/services/github-device-core.js';

function world(status = 200, headers: Record<string, string> = {}) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  const replies: unknown[] = [];
  const fetch: FetchLike = async (input, init) => {
    requests.push({ url: String(input), body: new URLSearchParams(init?.body) });
    const body = replies.shift();
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { deps: { fetch }, requests, replies };
}

const GRANT = {
  access_token: 'ghu_core_access',
  refresh_token: 'ghr_core_refresh',
  expires_in: 28_800,
  refresh_token_expires_in: 15_552_000,
};

describe('storage-free GitHub device transport', () => {
  test.each([
    [403, {}, 403],
    [403, { 'x-ratelimit-remaining': '15' }, 403],
    [403, { 'x-ratelimit-remaining': '0' }, 429],
    [403, { 'retry-after': '60' }, 429],
    [429, {}, 429],
  ] as const)(
    'distinguishes permission HTTP %s from an actual rate limit: %j',
    async (status, headers, expected) => {
      const w = world(status, headers);
      await expect(requestGithubDeviceCode(w.deps, 'shared-client')).rejects.toMatchObject({
        status: expected,
      });
    },
  );

  test('HTTP 401 rejects only the relevant authorization operation', async () => {
    const w = world(401);
    await expect(requestGithubDeviceCode(w.deps, 'shared-client')).rejects.toMatchObject({
      status: 502,
      message: 'GitHub device authorization failed; check the public App registration',
    });
    expect(await pollGithubDeviceCode(w.deps, 'shared-client', 'private-device')).toEqual({
      status: 'failed',
    });
    await expect(
      refreshGithubDeviceToken(w.deps, 'shared-client', 'old-refresh'),
    ).rejects.toMatchObject({ status: 401 });
  });

  test('returns separate device codes and a verified grant without connection storage or a secret', async () => {
    const w = world();
    for (const deviceCode of ['publication-device', 'connector-device']) {
      w.replies.push({
        device_code: deviceCode,
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        interval: 7,
        expires_in: 900,
      });
    }
    const publication = await requestGithubDeviceCode(w.deps, 'shared-client');
    const connector = await requestGithubDeviceCode(w.deps, 'shared-client');
    expect(publication.deviceCode).toBe('publication-device');
    expect(connector).toMatchObject({ deviceCode: 'connector-device', intervalSeconds: 7 });
    w.replies.push(GRANT, { login: 'octo', id: 42, name: 'Octo Person' });
    const result = await pollGithubDeviceCode(w.deps, 'shared-client', connector.deviceCode);
    expect(result).toMatchObject({
      status: 'complete',
      accessToken: GRANT.access_token,
      refreshToken: GRANT.refresh_token,
      expiresInSeconds: 28_800,
      identity: { login: 'octo', id: 42, name: 'Octo Person' },
    });
    expect(w.requests[2]?.body.get('device_code')).toBe('connector-device');
    expect(w.requests.every(({ body }) => !body.has('client_secret'))).toBe(true);
  });

  test.each([
    [{ error: 'authorization_pending' }, { status: 'pending' }],
    [{ error: 'slow_down' }, { status: 'slow_down' }],
    [
      { error: 'slow_down', interval: 17 },
      { status: 'slow_down', intervalSeconds: 17 },
    ],
    [{ error: 'expired_token' }, { status: 'expired' }],
    [{ error: 'access_denied' }, { status: 'denied' }],
    [{ error: 'incorrect_device_code' }, { status: 'failed' }],
    [{ error: 'device_flow_disabled' }, { status: 'failed' }],
    [{ error: 'unsupported_grant_type' }, { status: 'failed' }],
  ])('polls once and leaves retry scheduling to its caller: %j', async (body, expected) => {
    const w = world();
    w.replies.push(body);
    expect(await pollGithubDeviceCode(w.deps, 'shared-client', 'private-device')).toEqual(expected);
    expect(w.requests).toHaveLength(1);
  });

  test.each(['device_flow_disabled', 'unauthorized_client'])(
    'reports App registration failure for %s without blaming the verification URL',
    async (error) => {
      const w = world();
      w.replies.push({ error, error_description: 'private-provider-details' });
      await expect(requestGithubDeviceCode(w.deps, 'shared-client')).rejects.toThrow(
        'GitHub device authorization failed; check the public App registration',
      );
    },
  );

  test.each([
    ['bad_refresh_token', 401, 'GitHub authorization expired; reconnect GitHub'],
    ['expired_token', 401, 'GitHub authorization expired; reconnect GitHub'],
    ['temporarily_unavailable', 502, 'GitHub token refresh is temporarily unavailable'],
  ] as const)(
    'classifies refresh %s without exposing the upstream description',
    async (error, status, message) => {
      const w = world(400);
      w.replies.push({ error, error_description: 'private-provider-details' });
      await expect(
        refreshGithubDeviceToken(w.deps, 'shared-client', 'old-refresh'),
      ).rejects.toMatchObject({
        status,
        message,
      });
    },
  );

  test('a token grant without a verified identity cannot complete the poll', async () => {
    const w = world();
    w.replies.push(GRANT, { message: 'private-provider-details' });
    await expect(
      pollGithubDeviceCode(w.deps, 'shared-client', 'private-device'),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Could not verify the GitHub account; reconnect GitHub',
    });
  });

  test('returns rotated credentials without a client secret or a storage dependency', async () => {
    const w = world();
    w.replies.push(GRANT);
    expect(await refreshGithubDeviceToken(w.deps, 'shared-client', 'old-refresh')).toMatchObject({
      accessToken: GRANT.access_token,
      refreshToken: GRANT.refresh_token,
      expiresInSeconds: 28_800,
    });
    expect(w.requests[0]?.body.get('refresh_token')).toBe('old-refresh');
    expect(w.requests[0]?.body.has('client_secret')).toBe(false);
  });
});
