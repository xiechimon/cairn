import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { type AntigravitySignInOutcome, OWNER_CHANNEL_HEADER } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { antigravitySubscription } from '../../server/src/db/schema.js';
import { openAntigravitySubscription } from '../../server/src/services/antigravity-subscriptions.js';
import { bootServer } from '../../server/test/helpers.js';
import { antigravitySignIn } from '../src/antigravity-auth.js';
import { desktopCredentialActions } from '../src/local-credential-actions.js';
import { scanLocalProviders } from '../src/local-providers.js';

const origin = 'http://localhost:3210';
const owner = 'synthetic-owner-token';
const channel = 'synthetic-owner-channel';
let actions: ReturnType<typeof desktopCredentialActions>;
let appData: string;
const tokenFor = (value: string) => `ya29.${value.repeat(64)}`;
let home: string;

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

function offlineServer() {
  const s = bootServer({ authToken: owner, ownerChannel: { key: channel } });
  const toServer = vi.fn((url: string, init: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/tokeninfo') {
      const bearer = new Headers(init.headers).get('authorization');
      expect(bearer).toMatch(/^Bearer ya29\.[a-z]+$/);
      expect(init.redirect).toBe('error');
      return Promise.resolve(Response.json({ expires_in: '7200', sub: `fixture-${bearer?.[12]}` }));
    }
    return s.app.request(url, init);
  });
  vi.stubGlobal('fetch', toServer);
  return s;
}

function oauthFile(home: string, token: string, expiresAt: number, malformed = false) {
  const dir = join(home, '.gemini', 'antigravity-acp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'antigravity-oauth-token'),
    malformed
      ? 'not-json'
      : JSON.stringify({
          token: {
            access_token: token,
            expiry: new Date(expiresAt).toISOString(),
            refresh_token: 'synthetic-refresh',
          },
        }),
  );
}

function mockLogin() {
  const stdin = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return true;
    }),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

beforeEach(() => {
  home = makeTestTempDir('agy-desktop-tests-');
  appData = makeTestTempDir('agy-desktop-data-');
  actions = desktopCredentialActions(origin, owner, channel, appData);
  vi.stubEnv('HOME', home);
  vi.stubEnv('TMPDIR', home);
  vi.stubEnv('CAIRN_AGY_PATH', process.execPath);
  vi.stubEnv('GEMINI_API_KEY', '');
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function saveSignedIn(
  teamId: string,
  label: string,
  pending: Promise<AntigravitySignInOutcome>,
) {
  const outcome = await pending;
  if (!outcome.ok) return outcome;
  const response = await fetch(`${origin}/api/teams/${teamId}/antigravity-subscriptions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${owner}`,
      [OWNER_CHANNEL_HEADER]: channel,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ label, ...outcome.credential }),
  });
  const saved = (await response.json()) as { id: string; label: string };
  return { ok: true as const, subscription: { id: saved.id, label: saved.label } };
}

function completeLogin(
  child: ReturnType<typeof mockLogin>,
  token?: string,
  expiresAt?: number,
  malformed = false,
) {
  const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { cwd: string } | undefined;
  if (options === undefined) throw new Error('Expected the login process to start');
  const { cwd } = options;
  expect(cwd).not.toBe(home);
  if (token !== undefined && expiresAt !== undefined) oauthFile(cwd, token, expiresAt, malformed);
  child.stdout.write('{"id":1,"result":{"authMethods":[{"id":"oauth-personal"}]}}\n');
  child.stdout.write('{"id":2,"result":{}}\n');
  return cwd;
}

test('two default desktop sign-ins save distinct encrypted credentials and read their own catalogs while the first stays active', async () => {
  const s = offlineServer();
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  const created: { id: string; label: string }[] = [];
  const expiresAt = Date.now() + 3_600_000;
  for (const account of ['a', 'b']) {
    const child = mockLogin();
    const pending = antigravitySignIn(appData, () => {}, new AbortController().signal);
    const profile = completeLogin(child, tokenFor(account), expiresAt);
    const outcome = await saveSignedIn(s.team.id, `Account ${account}`, pending);
    expect(outcome).toEqual({
      ok: true,
      subscription: { id: expect.any(String), label: `Account ${account}` },
    });
    expect(existsSync(profile)).toBe(false);
    if (!outcome.ok) throw new Error('Test subscription was not saved');
    created.push(outcome.subscription);
  }
  expect(existsSync(join(home, '.gemini'))).toBe(false);
  const headers = { authorization: `Bearer ${owner}`, [OWNER_CHANNEL_HEADER]: channel };
  const listed = await s.app.request(path, { headers });
  expect(await listed.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: created[0]?.id, enabled: true, hasToken: true }),
      expect.objectContaining({ id: created[1]?.id, enabled: false, hasToken: true }),
    ]),
  );
  for (const [i, account] of ['a', 'b'].entries()) {
    const id = created[i]?.id;
    const row = s.db
      .select()
      .from(antigravitySubscription)
      .all()
      .find((entry) => entry.id === id);
    if (row?.tokenCipher == null) throw new Error('Missing encrypted subscription credential');
    expect(row.tokenCipher).not.toContain(tokenFor(account));
    expect(row.tokenCipher).not.toContain(`fixture-${account}`);
    expect(
      openAntigravitySubscription({ db: s.db, box: s.secretBox }, s.team.id, 'antigravity', row.id),
    ).toBe(JSON.stringify({ kind: 'oauth-personal', token: tokenFor(account), expiresAt }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${tokenFor(account)}`);
        return Response.json({
          models: { [`gemini-account-${account}`]: { displayName: `Account ${account}` } },
        });
      }),
    );
    const result = await s.app.request(`${path}/${id}/upstream-models`, {
      method: 'POST',
      headers,
    });
    expect(await result.json()).toMatchObject({
      status: 'ok',
      models: [{ id: `gemini-account-${account}` }],
    });
  }
});

test('local Antigravity, Devin and Pi imports return metadata only and use the bundled owner channel', async () => {
  const s = offlineServer();
  const input = { teamId: s.team.id, label: 'Imported subscription' };
  const token = tokenFor('c');
  oauthFile(home, token, Date.now() + 60_000);
  mkdirSync(join(home, '.local', 'share', 'devin'), { recursive: true });
  writeFileSync(
    join(home, '.local', 'share', 'devin', 'credentials.toml'),
    'windsurf_api_key = "wsk-synthetic-devin-12345"\n',
  );
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(
    join(home, '.pi', 'agent', 'models.json'),
    JSON.stringify({
      providers: {
        relay: {
          api: 'openai-completions',
          baseUrl: 'https://relay.example.test/v1',
          apiKey: 'synthetic-pi-key',
          models: [{ id: 'fixture-model' }],
        },
      },
    }),
  );
  expect(scanLocalProviders()).toEqual([{ providerId: 'relay', label: 'relay', state: 'ready' }]);
  expect(await actions.importAntigravity(input)).toEqual({
    ok: true,
    subscription: { id: expect.any(String), label: input.label },
  });
  expect(await actions.importDevin(input)).toEqual({
    ok: true,
    subscription: { id: expect.any(String), label: input.label },
  });
  expect(
    await actions.importProviders({ teamId: input.teamId, providerIds: ['relay', 'missing'] }),
  ).toEqual([
    { providerId: 'relay', status: 'saved', id: expect.any(String) },
    { providerId: 'missing', status: 'missing' },
  ]);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  const desktopCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).startsWith(origin));
  expect(desktopCalls).toHaveLength(3);
  for (const [url, init] of desktopCalls) {
    expect(String(url)).toMatch(/^http:\/\/localhost:3210\/api\/teams\//);
    expect(new Headers(init?.headers).get(OWNER_CHANNEL_HEADER)).toBe(channel);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${owner}`);
    expect(init?.redirect).toBe('error');
  }
});

test.each(['missing', 'expired', 'malformed'] as const)(
  'does not reuse a real-home fixture when the private profile has a %s credential',
  async (failure) => {
    offlineServer();
    oauthFile(home, tokenFor('c'), Date.now() + 60_000);
    const child = mockLogin();
    const pending = antigravitySignIn(appData, () => {}, new AbortController().signal);
    const profile = completeLogin(
      child,
      failure === 'missing' ? undefined : tokenFor('a'),
      Date.now() + (failure === 'expired' ? -1000 : 60_000),
      failure === 'malformed',
    );
    await expect(pending).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(existsSync(profile)).toBe(false);
    expect(
      readFileSync(join(home, '.gemini', 'antigravity-acp', 'antigravity-oauth-token'), 'utf8'),
    ).toContain(tokenFor('c'));
    expect(fetch).not.toHaveBeenCalled();
  },
);

function mockServerRefreshProbe(mintedAccessToken: string) {
  vi.mocked(spawn).mockImplementationOnce((_cmd, _args, options) => {
    const cwd = String((options as { cwd?: string } | undefined)?.cwd ?? '');
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      stderr,
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', 0, null));
        return true;
      }),
    });
    let buf = '';
    stdin.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method === 'initialize') {
            stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })}\n`);
          } else if (msg.method === 'session/new') {
            const tokenPath = join(cwd, '.gemini', 'antigravity-acp', 'antigravity-oauth-token');
            const current = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
              token: Record<string, unknown>;
              auth_method?: string;
            };
            current.token.access_token = mintedAccessToken;
            current.token.expiry = new Date(Date.now() + 3_600_000).toISOString();
            writeFileSync(tokenPath, JSON.stringify(current));
            stdout.write(
              `${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'ok' } })}\n`,
            );
          }
        } catch {}
      }
      buf = '';
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
}

test('desktop sign-in captures durable 1// refresh token with AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1 and local import supports acp_token.json', async () => {
  const s = offlineServer();
  const refreshToken = `1//0gDesktopDurable_${'r'.repeat(32)}`;
  const accessToken = tokenFor('d');
  const expiresAt = Date.now() + 3_600_000;
  const child = mockLogin();
  mockServerRefreshProbe(accessToken);
  const pending = antigravitySignIn(appData, () => {}, new AbortController().signal);
  const spawnCall = vi.mocked(spawn).mock.calls.at(-1);
  const options = spawnCall?.[2] as { cwd: string; env?: Record<string, string> } | undefined;
  if (options === undefined) throw new Error('Expected login spawn');
  expect(options.env?.AGY_CLI_FORCE_FILE_TOKEN_STORAGE).toBe('1');
  const dir = join(options.cwd, '.gemini', 'antigravity-acp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'antigravity-oauth-token'),
    JSON.stringify({
      token: {
        access_token: accessToken,
        expiry: new Date(expiresAt).toISOString(),
        refresh_token: refreshToken,
      },
      auth_method: 'consumer',
    }),
  );
  child.stdout.write('{"id":1,"result":{"authMethods":[{"id":"oauth-personal"}]}}\n');
  child.stdout.write('{"id":2,"result":{}}\n');
  const outcome = await saveSignedIn(s.team.id, 'Durable Google', pending);
  expect(outcome).toEqual({
    ok: true,
    subscription: { id: expect.any(String), label: 'Durable Google' },
  });
  if (!outcome.ok) return;
  const row = s.db
    .select()
    .from(antigravitySubscription)
    .all()
    .find((entry) => entry.id === outcome.subscription.id);
  expect(row?.expiresAt).toBeNull();
  expect(row?.tokenCipher).not.toContain(refreshToken);
  expect(
    JSON.parse(
      openAntigravitySubscription(
        { db: s.db, box: s.secretBox },
        s.team.id,
        'antigravity',
        outcome.subscription.id,
      ) ?? '{}',
    ),
  ).toMatchObject({
    kind: 'oauth-personal',
    refreshToken,
    authMethod: 'consumer',
    token: accessToken,
  });

  const legacyRefresh = `1//0gLegacyAcpImport_${'l'.repeat(32)}`;
  const legacyAccess = tokenFor('e');
  mockServerRefreshProbe(legacyAccess);
  mkdirSync(join(home, '.gemini', 'antigravity-acp'), { recursive: true });
  writeFileSync(
    join(home, '.gemini', 'antigravity-acp', 'acp_token.json'),
    JSON.stringify({ refresh_token: legacyRefresh }),
  );
  const imported = await actions.importAntigravity({
    teamId: s.team.id,
    label: 'Legacy Imported',
  });
  expect(imported).toEqual({
    ok: true,
    subscription: { id: expect.any(String), label: 'Legacy Imported' },
  });
  if (!imported.ok) return;
  expect(
    JSON.parse(
      openAntigravitySubscription(
        { db: s.db, box: s.secretBox },
        s.team.id,
        'antigravity',
        imported.subscription.id,
      ) ?? '{}',
    ),
  ).toMatchObject({
    kind: 'oauth-personal',
    refreshToken: legacyRefresh,
    authMethod: 'consumer',
    token: legacyAccess,
  });
});
