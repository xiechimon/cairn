import { BROWSER_AUTH_HEADER, BROWSER_SESSION_PATH } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer } from './helpers.js';

describe('POST /api/auth/session owner token login', () => {
  test('valid owner token issues HttpOnly owner session cookie and rejects wrong token or missing origin proof', async () => {
    const token = 'owner-secret-token-for-test';
    const s = bootServer({ authToken: token });

    const noProof = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(noProof.status).toBe(403);

    const badToken = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        authorization: 'Bearer wrong-token',
      },
    });
    expect(badToken.status).toBe(401);

    const ok = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        authorization: `Bearer ${token}`,
      },
    });
    expect(ok.status).toBe(204);
    const setCookieHeader = ok.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('cairn_auth=');
    expect(setCookieHeader).toContain('HttpOnly');

    const cookiePair = setCookieHeader.split(';', 1)[0]!;
    const check = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'GET',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        cookie: cookiePair,
      },
    });
    expect(check.status).toBe(204);

    const cookieOnlyPost = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        cookie: cookiePair,
      },
    });
    expect(cookieOnlyPost.status).toBe(403);
  });

  test('valid paired device token issues HttpOnly device session cookie that ends on revocation', async () => {
    const token = 'owner-secret-token-for-device-session';
    const s = bootServer({ authToken: token });
    const issued = await s.app.request('/api/remote/pairing', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await s.app.request('/api/remote/pair', {
      method: 'POST',
      headers: { [BROWSER_AUTH_HEADER]: '1', 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'paired-mac' }),
    });
    expect(paired.status).toBe(201);
    const { token: deviceToken, deviceId } = (await paired.json()) as {
      token: string;
      deviceId: string;
    };

    const ok = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        authorization: `Bearer ${deviceToken}`,
      },
    });
    expect(ok.status).toBe(204);
    const deviceCookie = (ok.headers.get('set-cookie') ?? '').split(';', 1)[0]!;
    expect(deviceCookie).toContain('cairn_auth=');
    expect(
      (
        await s.app.request(BROWSER_SESSION_PATH, {
          method: 'GET',
          headers: { [BROWSER_AUTH_HEADER]: '1', cookie: deviceCookie },
        })
      ).status,
    ).toBe(204);

    const bogusBearerWithCookie = await s.app.request(BROWSER_SESSION_PATH, {
      method: 'POST',
      headers: {
        [BROWSER_AUTH_HEADER]: '1',
        cookie: deviceCookie,
        authorization: 'Bearer not-a-valid-token',
      },
    });
    expect(bogusBearerWithCookie.status).toBe(403);
    expect(bogusBearerWithCookie.headers.get('set-cookie')).toBeNull();

    const revoked = await s.app.request(`/api/remote/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.status).toBe(204);
    expect(
      (
        await s.app.request(BROWSER_SESSION_PATH, {
          method: 'GET',
          headers: { [BROWSER_AUTH_HEADER]: '1', cookie: deviceCookie },
        })
      ).status,
    ).toBe(401);
  });
});
