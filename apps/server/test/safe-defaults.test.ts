import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  ENV_VARS,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '@cairn/shared';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  authStartupRefusal,
  ensureAccessToken,
  ignoredTailscaleUsersWarning,
  insecureBindWarning,
  isLoopbackHost,
  loadConfig,
} from '../src/config.js';
import { bootServer, req } from './helpers.js';

const TOKEN = 'safe-defaults-token-0123456789abcdef';
const tmpDirs: string[] = [];

function freshHome(): string {
  const home = makeTestTempDir('safe-defaults-');
  tmpDirs.push(home);
  return home;
}

function stubFreshInstall(home: string): void {
  vi.stubEnv(ENV_VARS.home, home);
  vi.stubEnv(ENV_VARS.token, '');
  vi.stubEnv(ENV_VARS.requireToken, '');
  vi.stubEnv(ENV_VARS.auth, '');
  vi.stubEnv('HOST', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) releaseTestTempDir(dir);
});

describe('#2057 default bind', () => {
  test('HOST unset binds loopback, never every interface', () => {
    stubFreshInstall(freshHome());
    expect(loadConfig().host).toBe('127.0.0.1');
  });

  test('an explicit HOST is kept verbatim', () => {
    stubFreshInstall(freshHome());
    vi.stubEnv('HOST', '192.168.1.10');
    expect(loadConfig().host).toBe('192.168.1.10');
  });

  test.each([
    ['127.0.0.1', true],
    ['127.0.0.2', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['localhost', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['100.64.0.2', false],
    ['example.com', false],
    ['127.0.0.1.evil.example', false],
  ])('isLoopbackHost(%s) = %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe('#2057 generated access token', () => {
  test('first run writes a 0600 token file and returns it as the auth token', () => {
    const home = freshHome();
    stubFreshInstall(home);
    const config = ensureAccessToken(loadConfig());
    expect(config.authToken).toMatch(/^[0-9a-f]{64}$/);
    const path = join(home, ACCESS_TOKEN_FILE_NAME);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(parseAccessTokenFile(readFileSync(path, 'utf8'))).toBe(config.authToken);
  });

  test('a restart reuses the stored token and does not rewrite the file', () => {
    const home = freshHome();
    stubFreshInstall(home);
    const first = ensureAccessToken(loadConfig());
    const path = join(home, ACCESS_TOKEN_FILE_NAME);
    const before = readFileSync(path, 'utf8');
    const second = ensureAccessToken(loadConfig());
    expect(second.authToken).toBe(first.authToken);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('an operator-written token file is never overwritten', () => {
    const home = freshHome();
    stubFreshInstall(home);
    writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(TOKEN));
    expect(ensureAccessToken(loadConfig()).authToken).toBe(TOKEN);
    expect(readFileSync(join(home, ACCESS_TOKEN_FILE_NAME), 'utf8')).toBe(
      formatAccessTokenFile(TOKEN),
    );
  });

  test('a lost race against another writer adopts the stored token', () => {
    const home = freshHome();
    stubFreshInstall(home);
    const loaded = loadConfig();
    writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(TOKEN));
    expect(ensureAccessToken(loaded).authToken).toBe(TOKEN);
  });

  test('CAIRN_TOKEN in the environment wins and no file is created', () => {
    const home = freshHome();
    stubFreshInstall(home);
    vi.stubEnv(ENV_VARS.token, TOKEN);
    expect(ensureAccessToken(loadConfig()).authToken).toBe(TOKEN);
    expect(() => statSync(join(home, ACCESS_TOKEN_FILE_NAME))).toThrow(/ENOENT/);
  });

  test('CAIRN_AUTH=off leaves the token null and creates no file', () => {
    const home = freshHome();
    stubFreshInstall(home);
    vi.stubEnv(ENV_VARS.auth, 'off');
    const config = ensureAccessToken(loadConfig());
    expect(config.authToken).toBeNull();
    expect(() => statSync(join(home, ACCESS_TOKEN_FILE_NAME))).toThrow(/ENOENT/);
  });

  test('CAIRN_AUTH=off ignores a stored token file, even a malformed one', () => {
    const home = freshHome();
    stubFreshInstall(home);
    writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), 'OTHER_KEY=x\n');
    vi.stubEnv(ENV_VARS.auth, 'off');
    expect(loadConfig().authToken).toBeNull();
  });

  test('container mode never generates: requireToken without a token stays null', () => {
    const home = freshHome();
    stubFreshInstall(home);
    const config = ensureAccessToken(loadConfig({ requireToken: true }));
    expect(config.authToken).toBeNull();
    expect(() => statSync(join(home, ACCESS_TOKEN_FILE_NAME))).toThrow(/ENOENT/);
  });

  test('a non-loopback bind never generates: the refusal handles it', () => {
    const home = freshHome();
    stubFreshInstall(home);
    const config = ensureAccessToken(loadConfig({ host: '0.0.0.0' }));
    expect(config.authToken).toBeNull();
    expect(() => statSync(join(home, ACCESS_TOKEN_FILE_NAME))).toThrow(/ENOENT/);
  });

  test('CAIRN_AUTH accepts only off; any other value fails closed', () => {
    stubFreshInstall(freshHome());
    for (const value of ['0', 'false', 'none', 'on', 'OFFF']) {
      vi.stubEnv(ENV_VARS.auth, value);
      expect(() => loadConfig(), value).toThrow(/CAIRN_AUTH/);
    }
    vi.stubEnv(ENV_VARS.auth, 'OFF');
    expect(loadConfig().authOff).toBe(true);
  });
});

describe('#2057 startup refusals', () => {
  test('a LAN bind without a token refuses and names the ways to fix it', () => {
    const refusal = authStartupRefusal(loadConfig({ host: '192.168.1.10', authToken: null }));
    expect(refusal).toMatch(/192\.168\.1\.10/);
    expect(refusal).toMatch(/CAIRN_TOKEN/);
    expect(refusal).toMatch(/refusing to start/);
  });

  test.each(['0.0.0.0', '::', '100.64.0.2', 'example.com'])(
    'host %s without a token refuses',
    (host) => {
      expect(authStartupRefusal(loadConfig({ host, authToken: null }))).not.toBeNull();
    },
  );

  test('a LAN bind with a token starts', () => {
    expect(authStartupRefusal(loadConfig({ host: '0.0.0.0', authToken: TOKEN }))).toBeNull();
  });

  test('a loopback bind without a token is not refused: the token is generated', () => {
    expect(authStartupRefusal(loadConfig({ host: '127.0.0.1', authToken: null }))).toBeNull();
  });

  test('CAIRN_AUTH=off on an all-interface bind refuses, even with a token set', () => {
    for (const authToken of [null, TOKEN]) {
      const refusal = authStartupRefusal(loadConfig({ host: '0.0.0.0', authOff: true, authToken }));
      expect(refusal).toMatch(/CAIRN_AUTH=off/);
      expect(refusal).toMatch(/loopback/);
    }
  });

  test('CAIRN_AUTH=off on a LAN address refuses', () => {
    expect(
      authStartupRefusal(loadConfig({ host: '192.168.1.10', authOff: true, authToken: null })),
    ).toMatch(/CAIRN_AUTH=off/);
  });

  test('CAIRN_AUTH=off on loopback is the one accepted opt-out', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(
        authStartupRefusal(loadConfig({ host, authOff: true, authToken: null })),
        host,
      ).toBeNull();
    }
  });

  test('CAIRN_AUTH=off contradicts CAIRN_REQUIRE_TOKEN and refuses', () => {
    expect(
      authStartupRefusal(
        loadConfig({ host: '127.0.0.1', authOff: true, requireToken: true, authToken: null }),
      ),
    ).toMatch(/CAIRN_REQUIRE_TOKEN/);
  });

  test('the Docker rule is preserved: requireToken without a token refuses on any host', () => {
    for (const host of ['127.0.0.1', '0.0.0.0']) {
      expect(authStartupRefusal(loadConfig({ host, requireToken: true, authToken: null }))).toMatch(
        /CAIRN_TOKEN/,
      );
    }
    expect(
      authStartupRefusal(loadConfig({ host: '0.0.0.0', requireToken: true, authToken: TOKEN })),
    ).toBeNull();
  });
});

describe('#2057 insecureBindWarning leaves no dangerous case unwarned', () => {
  test.each(['0.0.0.0', '::', '192.168.1.10', '100.64.0.2', 'example.com'])(
    'host %s with no token warns',
    (host) => {
      const warning = insecureBindWarning(loadConfig({ host, authToken: null }));
      expect(warning).toMatch(new RegExp(host.replaceAll('.', '\\.')));
      expect(warning).toMatch(/CAIRN_TOKEN/);
    },
  );

  test('CAIRN_AUTH=off on loopback warns that every local process reaches the API', () => {
    const warning = insecureBindWarning(
      loadConfig({ host: '127.0.0.1', authOff: true, authToken: null }),
    );
    expect(warning).toMatch(/CAIRN_AUTH=off/);
  });

  test('a token on any host, or the default loopback with a token, does not warn', () => {
    expect(insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: TOKEN }))).toBeNull();
    expect(insecureBindWarning(loadConfig({ host: '127.0.0.1', authToken: TOKEN }))).toBeNull();
  });
});

describe('#2057 the Tailscale identity header grants nothing', () => {
  const headers = { 'Tailscale-User-Login': 'xiechimon@github', 'x-forwarded-for': '127.0.0.1' };

  test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'a forged header from loopback peer %s is rejected on /api/*',
    async (remoteAddress) => {
      const s = bootServer({ authToken: TOKEN });
      const res = await Promise.resolve(
        s.app.request('/api/user/me', { headers }, { incoming: { socket: { remoteAddress } } }),
      );
      expect(res.status).toBe(401);
    },
  );

  test('a forged header from loopback cannot confirm a machine enrollment', async () => {
    const s = bootServer({ authToken: TOKEN });
    const start = await req(s.app, 'POST', '/api/machine/enroll/start', { name: 'forged' });
    const { enrollId } = (await start.json()) as { enrollId: string };
    const res = await Promise.resolve(
      s.app.request(
        '/api/machine/enroll/confirm',
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ enrollId }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );
    expect(res.status).toBe(401);
  });

  test('CAIRN_TAILSCALE_USERS is ignored and does not grant access', () => {
    expect(ignoredTailscaleUsersWarning({})).toBeNull();
    expect(ignoredTailscaleUsersWarning({ CAIRN_TAILSCALE_USERS: '' })).toBeNull();
    expect(ignoredTailscaleUsersWarning({ CAIRN_TAILSCALE_USERS: 'a@github' })).toMatch(
      /CAIRN_TAILSCALE_USERS is ignored and does not grant access/,
    );
  });
});
