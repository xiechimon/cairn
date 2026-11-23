import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { BROWSER_AUTH_HEADER, formatAccessTokenFile, parseAccessTokenFile } from '@cairn/shared';
import { runTokenCommand } from '@cairn/shared/token-command';
import { expect, test, vi } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import { pairingGrant } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { createServerLogger } from '../src/lib/logger.js';
import { runServerCommand } from '../src/server-command.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bootServer } from './helpers.js';

const OWNER = 'synthetic-owner-link-token';
const MINT = '/api/auth/owner-link';
const REDEEM = `${MINT}/redeem`;
const LOCAL = 'http://127.0.0.1:8787';
const TAILNET = 'https://cairn.example.ts.net';
const BROWSER = { 'sec-fetch-site': 'same-origin', [BROWSER_AUTH_HEADER]: '1' };
const BEARER = { authorization: `Bearer ${OWNER}` };
const PAIRING = '/api/remote/pairing';
const PROVIDER = {
  providerId: 'owner-link-test',
  label: 'Owner link test',
  baseUrl: 'https://models.example.test/v1',
  api: 'openai-completions',
  models: [{ id: 'fixture', name: 'Fixture' }],
};

type Server = ReturnType<typeof bootServer>;

function post(
  s: Server,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  origin = LOCAL,
) {
  return s.app.request(
    `${origin}${path}`,
    {
      method: 'POST',
      headers: { host: new URL(origin).host, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    origin === LOCAL
      ? { incoming: { socket: { remoteAddress: '127.0.0.1', localPort: 8787 } } }
      : undefined,
  );
}

async function mint(s: Server) {
  const res = await post(s, MINT, {}, BEARER);
  expect(res.status).toBe(201);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return (await res.json()) as { code: string; expiresAt: number };
}

function sessionCookie(res: Response) {
  const cookie = res.headers.getSetCookie().find((value) => value.startsWith('cairn_auth='));
  expect(cookie).toMatch(/; HttpOnly/i);
  return { cookie: cookie?.split(';')[0] ?? '' };
}

async function device(s: Server) {
  const grant = await post(s, PAIRING, {}, BEARER);
  expect(grant.status).toBe(201);
  const { code } = (await grant.json()) as { code: string };
  const res = await post(s, '/api/remote/pair', { code, name: 'Office' }, BROWSER);
  expect(res.status).toBe(201);
  const { token } = (await res.json()) as { token: string };
  return { headers: { ...BROWSER, ...sessionCookie(res) }, token };
}

test('without local peer identity an anonymous or paired browser cannot act as owner, but an owner link can', async () => {
  const s = bootServer({ authToken: OWNER });
  seedLocalMachine(s.db, s.team.id);
  const provider = `/api/teams/${s.team.id}/providers`;
  const start = await post(s, '/api/machine/enroll/start', { name: hostname() });
  expect(start.status).toBe(200);
  const { enrollId } = (await start.json()) as { enrollId: string };
  const confirm = '/api/machine/enroll/confirm';
  expect((await s.app.request('/api/auth/session', { headers: BROWSER })).status).toBe(401);
  expect((await post(s, '/api/auth/bootstrap', {}, BROWSER)).status).toBe(401);
  expect((await post(s, MINT, {}, BROWSER)).status).toBe(401);
  expect((await post(s, provider, PROVIDER, BROWSER)).status).toBe(401);
  expect((await post(s, confirm, { enrollId }, BROWSER)).status).toBe(401);
  const paired = await device(s);
  expect((await post(s, provider, PROVIDER, paired.headers)).status).toBe(403);
  expect((await post(s, confirm, { enrollId }, paired.headers)).status).toBe(403);
  expect((await post(s, MINT, {}, paired.headers)).status).toBe(403);
  expect((await post(s, MINT, {}, { authorization: `Bearer ${paired.token}` })).status).toBe(403);

  const { code } = await mint(s);
  const redeemed = await post(s, REDEEM, { code }, BROWSER);
  expect(redeemed.status).toBe(200);
  expect(redeemed.headers.get('cache-control')).toBe('no-store');
  const owner = { ...BROWSER, ...sessionCookie(redeemed) };
  expect((await s.app.request('/api/auth/session', { headers: owner })).status).toBe(204);
  expect((await post(s, MINT, {}, owner)).status).toBe(403);
  expect((await post(s, MINT, {}, { ...owner, authorization: 'Bearer wrong' })).status).toBe(403);
  expect((await post(s, provider, PROVIDER, owner)).status).toBe(201);
  expect((await post(s, confirm, { enrollId }, owner)).status).toBe(200);
});

test('codes are hashed, kind-scoped and expire at ten minutes', async () => {
  const s = bootServer({ authToken: OWNER });
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(now);
    const { code, expiresAt } = await mint(s);
    expect(Buffer.from(code, 'base64url')).toHaveLength(32);
    expect(expiresAt).toBe(now + 600_000);
    expect(s.db.select().from(pairingGrant).all()).toEqual([
      expect.objectContaining({ codeHash: hashCredential(code) }),
    ]);
    const openDeviceGrants = await s.app.request(PAIRING, { headers: BEARER });
    expect(await openDeviceGrants.json()).toEqual([]);
    expect((await post(s, '/api/remote/pair', { code, name: 'Office' }, BROWSER)).status).toBe(401);
    const grant = await post(s, PAIRING, {}, BEARER);
    const deviceCode = ((await grant.json()) as { code: string }).code;
    expect((await post(s, REDEEM, { code: deviceCode }, BROWSER)).status).toBe(401);
    expect(
      (await post(s, '/api/remote/pair', { code: deviceCode, name: 'Office' }, BROWSER)).status,
    ).toBe(201);
    vi.setSystemTime(expiresAt);
    const expired = await post(s, REDEEM, { code }, BROWSER);
    expect(expired.status).toBe(401);
    expect(expired.headers.getSetCookie().some((value) => value.startsWith('cairn_auth='))).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});

test('only one concurrent redeem wins and the code does not reach the logger', async () => {
  const lines: string[] = [];
  const logger = createServerLogger([], { level: 'trace' }, { write: (line) => lines.push(line) });
  const s = bootServer({ authToken: OWNER, logger });
  const { code } = await mint(s);
  const redeem = () => post(s, REDEEM, { code }, BROWSER);
  const responses = await Promise.all([redeem(), redeem()]);
  expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
  expect((await redeem()).status).toBe(401);
  expect(lines.join('')).not.toContain(code);
});

test('redemption needs same-origin browser proof and a local or advertised HTTPS origin', async () => {
  const s = bootServer({
    authToken: OWNER,
    remote: {
      tailnetStatus: () => ({
        enabled: true,
        state: 'ready',
        dnsName: 'cairn.example.ts.net',
        ips: [],
        authUrl: null,
        error: null,
      }),
    },
  });
  const { code } = await mint(s);
  for (const [origin, headers] of [
    [LOCAL, {}],
    [LOCAL, { 'sec-fetch-site': 'cross-site' }],
    [LOCAL, { 'sec-fetch-site': 'none' }],
    [LOCAL, { ...BROWSER, origin: 'https://untrusted.example' }],
    [LOCAL, { ...BROWSER, host: '127.0.0.1:9090' }],
    [LOCAL, { ...BROWSER, 'x-forwarded-for': '192.0.2.10' }],
    ['https://untrusted.example', BROWSER],
    ['http://cairn.example.ts.net', BROWSER],
  ] as [string, Record<string, string>][]) {
    const refused = await post(s, REDEEM, { code }, headers, origin);
    expect(refused.status).toBe(403);
    expect(refused.headers.get('cache-control')).toBe('no-store');
  }
  const redeemed = await post(s, REDEEM, { code }, { ...BROWSER, origin: TAILNET }, TAILNET);
  expect(redeemed.status).toBe(200);
  expect(
    redeemed.headers.getSetCookie().find((value) => value.startsWith('cairn_auth=')),
  ).toMatch(/; Secure/i);
});

test('sign-in is served before SPA assets and clears the fragment before redeeming', async () => {
  const s = bootServer({ authToken: OWNER });
  const res = await s.app.request('/app/sign-in');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  const page = await res.text();
  expect(page).toContain('history.replaceState');
  expect(page.indexOf('history.replaceState')).toBeLessThan(page.indexOf('fetch('));
  expect(page).not.toMatch(/<script[^>]*\bsrc=/i);
});

test('server token --link uses the file token and prints a fresh fragment link without printing the token', async () => {
  const s = bootServer({ authToken: OWNER });
  const home = s.reposDir;
  writeFileSync(join(home, 'token'), formatAccessTokenFile(OWNER));
  const fetchLocal = vi.fn((url: string, init: RequestInit) => s.app.request(url, init));
  vi.stubGlobal('fetch', fetchLocal);
  try {
    const out: string[] = [];
    const io = {
      env: { CAIRN_HOME: home, HOST: '0.0.0.0', PORT: '8787' },
      writeOut: (line: string) => out.push(line),
      writeErr: (line: string) => out.push(line),
    };
    expect(await runServerCommand(['token', '--link'], io)).toBe(0);
    expect(await runServerCommand(['token', '--link'], io)).toBe(0);
    expect(fetchLocal).toHaveBeenCalledTimes(2);
    expect(fetchLocal).toHaveBeenCalledWith(
      `${LOCAL}${MINT}`,
      expect.objectContaining({ redirect: 'error' }),
    );
    const output = out.join('');
    expect(output).not.toContain(OWNER);
    const codes = [...output.matchAll(/http:\/\/127\.0\.0\.1:8787\/app\/sign-in#code=([\w-]+)/g)];
    expect(codes).toHaveLength(2);
    expect(codes[0]?.[1]).not.toBe(codes[1]?.[1]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('server token --rotate revokes all owner sessions and unused owner links, not paired or Access sessions', async () => {
  const { reposDir: home } = bootServer();
  const dir = join(home, 'server');
  mkdirSync(dir);
  const opened = openDbWithHandle(join(dir, 'server.db'));
  try {
    writeFileSync(join(home, 'token'), formatAccessTokenFile(OWNER));
    const s = bootServer({ db: opened.db, authToken: OWNER });
    const first = sessionCookie(await post(s, REDEEM, { code: (await mint(s)).code }, BROWSER));
    const second = issueBrowserSession(s.db, 'owner');
    const access = issueBrowserSession(s.db, 'external');
    const paired = await device(s);
    const { code } = await mint(s);
    const output: string[] = [];
    expect(
      runTokenCommand({ rotate: true }, { env: { CAIRN_HOME: home }, writeOut: () => {} }),
    ).toBe(1);
    expect(parseAccessTokenFile(readFileSync(join(home, 'token'), 'utf8'))).toBe(OWNER);
    const status = await runServerCommand(['token', '--rotate'], {
      env: { CAIRN_HOME: home },
      writeOut: (line) => output.push(line),
      writeErr: (line) => output.push(line),
    });
    expect(status, output.join('')).toBe(0);
    const rotated = parseAccessTokenFile(readFileSync(join(home, 'token'), 'utf8'));
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe(OWNER);
    const check = async (headers: Record<string, string>) =>
      (await s.app.request('/api/auth/session', { headers: { ...BROWSER, ...headers } })).status;
    expect(await check(first)).toBe(401);
    expect(await check({ cookie: `cairn_auth=${second.token}` })).toBe(401);
    expect(await check({ cookie: `cairn_auth=${access.token}` })).toBe(204);
    expect(await check(paired.headers)).toBe(204);
    expect((await post(s, REDEEM, { code }, BROWSER)).status).toBe(401);
  } finally {
    opened.close();
  }
});
