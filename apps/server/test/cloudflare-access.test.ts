import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createAccessVerifier } from '../src/lib/cloudflare-access.js';
import { bootServer, type TestServer } from './helpers.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-tag-for-cairn';
const OWNER = 'owner@example.com';
const CONFIG = { teamDomain: TEAM, aud: AUD, ownerEmails: [OWNER] };

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  otherKey = other.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(
  claims: Record<string, unknown> = { email: OWNER },
  options: { key?: CryptoKey; iss?: string; aud?: string; exp?: number | null; kid?: string } = {},
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'k1' })
    .setIssuer(options.iss ?? `https://${TEAM}`)
    .setAudience(options.aud ?? AUD)
    .setIssuedAt();
  if (options.exp !== null) jwt = jwt.setExpirationTime(options.exp ?? '10m');
  return jwt.sign(options.key ?? signingKey);
}

describe('createAccessVerifier', () => {
  test('a token Cloudflare signed for this app and an allowed email is the owner until it expires', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const verdict = await createAccessVerifier(
      CONFIG,
      keys,
    )(await token({ email: OWNER }, { exp }));
    expect(verdict).toEqual({ kind: 'owner', email: OWNER, expiresAt: exp * 1000 });
  });

  test('the allowlist ignores case and surrounding spaces', async () => {
    const verify = createAccessVerifier({ ...CONFIG, ownerEmails: ['  Owner@Example.com '] }, keys);
    expect((await verify(await token({ email: 'OWNER@example.COM' }))).kind).toBe('owner');
  });

  test('a valid token for an email not on the allowlist is refused', async () => {
    const verdict = await createAccessVerifier(
      CONFIG,
      keys,
    )(await token({ email: 'other@example.com' }));
    expect(verdict).toEqual({ kind: 'not-allowed' });
  });

  test('a token for another app, another team, expired, without expiry or without email is invalid', async () => {
    const verify = createAccessVerifier(CONFIG, keys);
    const past = Math.floor(Date.now() / 1000) - 60;
    for (const bad of [
      await token({ email: OWNER }, { aud: 'another-app' }),
      await token({ email: OWNER }, { iss: 'https://evil.cloudflareaccess.com' }),
      await token({ email: OWNER }, { exp: past }),
      await token({ email: OWNER }, { exp: null }),
      await token({ common_name: 'service-token-id' }),
    ]) {
      expect((await verify(bad)).kind).toBe('invalid');
    }
  });

  test('a token signed by another key, an unknown key id or a symmetric algorithm is invalid', async () => {
    const verify = createAccessVerifier(CONFIG, keys);
    const hs = await new SignJWT({ email: OWNER })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('a-shared-secret-of-enough-length-1234'));
    for (const bad of [
      await token({ email: OWNER }, { key: otherKey }),
      await token({ email: OWNER }, { kid: 'unknown' }),
      hs,
      'not-a-jwt',
      '',
    ]) {
      expect((await verify(bad)).kind).toBe('invalid');
    }
    expect((await verify(undefined)).kind).toBe('invalid');
  });

  test('when the signing keys cannot be fetched nobody is let in', async () => {
    const down: JWTVerifyGetKey = async () => {
      throw new TypeError('fetch failed');
    };
    const slow: JWTVerifyGetKey = async () => {
      throw new errors.JWKSTimeout();
    };
    for (const keySet of [down, slow]) {
      expect(await createAccessVerifier(CONFIG, keySet)(await token())).toEqual({
        kind: 'unavailable',
      });
    }
  });
});

describe('POST /api/auth/access', () => {
  let server: TestServer | null = null;
  afterEach(() => {
    server?.dispose();
    server = null;
  });
  const boot = (withAccess = true) => {
    server = bootServer({
      authToken: 'owner-token',
      accessVerifier: withAccess ? createAccessVerifier(CONFIG, keys) : null,
    });
    return server;
  };
  const exchange = (s: TestServer, headers: Record<string, string>) =>
    s.app.request('/api/auth/access', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', ...headers },
    });
  const cookieOf = (res: Response) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0] ?? '')
      .find((value) => value.startsWith('cairn_auth=')) ?? '';

  test('a verified Access identity becomes an owner session the rest of the app accepts', async () => {
    const s = boot();
    expect((await s.app.request('/api/teams')).status).toBe(401);
    const res = await exchange(s, { 'cf-access-jwt-assertion': await token() });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).not.toBe('');
    expect((await s.app.request('/api/teams', { headers: { cookie } })).status).toBe(200);
  });

  test('the session never outlives the Access token', async () => {
    const s = boot();
    const exp = Math.floor(Date.now() / 1000) + 120;
    const res = await exchange(s, {
      'cf-access-jwt-assertion': await token({ email: OWNER }, { exp }),
    });
    const header =
      (res.headers.getSetCookie?.() ?? []).find((v) => v.startsWith('cairn_auth=')) ?? '';
    const maxAge = Number(/Max-Age=(\d+)/i.exec(header)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(120);
  });

  test('the plain email header Cloudflare also sends is never trusted on its own', async () => {
    const s = boot();
    const res = await exchange(s, { 'cf-access-authenticated-user-email': OWNER });
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toBe('');
  });

  test('an email not on the allowlist is refused and gets no session', async () => {
    const s = boot();
    const res = await exchange(s, {
      'cf-access-jwt-assertion': await token({ email: 'other@example.com' }),
    });
    expect(res.status).toBe(403);
    expect(cookieOf(res)).toBe('');
  });

  test('an exchange started by another site is refused', async () => {
    const s = boot();
    const res = await exchange(s, {
      'sec-fetch-site': 'cross-site',
      'cf-access-jwt-assertion': await token(),
    });
    expect(res.status).toBe(403);
    expect(cookieOf(res)).toBe('');
  });

  test('with Access identity not configured the exchange does not exist', async () => {
    const s = boot(false);
    const res = await exchange(s, { 'cf-access-jwt-assertion': await token() });
    expect(res.status).toBe(404);
  });
});

describe('Access identity configuration', () => {
  const ENV = [
    'CAIRN_ACCESS_TEAM_DOMAIN',
    'CAIRN_ACCESS_AUD',
    'CAIRN_ACCESS_OWNER_EMAILS',
  ] as const;
  const withEnv = <T>(values: Partial<Record<(typeof ENV)[number], string>>, run: () => T): T => {
    const saved = ENV.map((name) => [name, process.env[name]] as const);
    for (const name of ENV) delete process.env[name];
    Object.assign(process.env, values);
    try {
      return run();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  test('it is off when none of the three settings is set', () => {
    expect(withEnv({}, () => loadConfig().cloudflareAccess)).toBeNull();
  });

  test('all three settings turn it on with the owner emails split', () => {
    const config = withEnv(
      {
        CAIRN_ACCESS_TEAM_DOMAIN: TEAM,
        CAIRN_ACCESS_AUD: AUD,
        CAIRN_ACCESS_OWNER_EMAILS: `${OWNER}, second@example.com`,
      },
      () => loadConfig().cloudflareAccess,
    );
    expect(config).toEqual({
      teamDomain: TEAM,
      aud: AUD,
      ownerEmails: [OWNER, 'second@example.com'],
    });
  });

  test('a partial setting refuses to start and names what is missing', () => {
    expect(() => withEnv({ CAIRN_ACCESS_TEAM_DOMAIN: TEAM }, () => loadConfig())).toThrow(
      /CAIRN_ACCESS_AUD.*CAIRN_ACCESS_OWNER_EMAILS/,
    );
  });
});
