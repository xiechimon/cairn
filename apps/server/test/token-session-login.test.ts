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
});
