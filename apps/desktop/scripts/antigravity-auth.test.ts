import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { OWNER_CHANNEL_HEADER } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { antigravitySubscription } from '../../server/src/db/schema.js';
import { bootServer } from '../../server/test/helpers.js';
import { desktopCredentialActions } from '../src/local-credential-actions.js';
import { scanLocalProviders } from '../src/local-providers.js';

const origin = 'http://localhost:3210';
const owner = 'synthetic-owner-token';
const channel = 'synthetic-owner-channel';
let actions: ReturnType<typeof desktopCredentialActions>;
const tokenFor = (value: string) => `ya29.${value.repeat(64)}`;
let home: string;

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

function offlineServer() {
  const s = bootServer({ authToken: owner, ownerChannel: { key: channel } });
  const toServer = vi.fn((url: string, init: RequestInit) => s.app.request(url, init));
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
  actions = desktopCredentialActions(origin, owner, channel, makeTestTempDir('agy-desktop-data-'));
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
    const pending = actions.loginAntigravity(
      { teamId: s.team.id, label: `Account ${account}` },
      () => {},
      new AbortController().signal,
    );
    const profile = completeLogin(child, tokenFor(account), expiresAt);
    const outcome = await pending;
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
    expect(row.tokenCipher.startsWith('oauth-personal:')).toBe(true);
    expect(s.secretBox.open(row.tokenCipher.slice('oauth-personal:'.length))).toBe(
      tokenFor(account),
    );
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
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    expect(String(url)).toMatch(/^http:\/\/localhost:3210\/api\/teams\//);
    expect(new Headers(init?.headers).get(OWNER_CHANNEL_HEADER)).toBe(channel);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${owner}`);
    expect(init?.redirect).toBe('error');
  }
});

test.each(['missing', 'expired', 'malformed'] as const)(
  'does not reuse a real-home fixture when the private profile has a %s credential',
  async (failure) => {
    const s = offlineServer();
    oauthFile(home, tokenFor('c'), Date.now() + 60_000);
    const child = mockLogin();
    const pending = actions.loginAntigravity(
      { teamId: s.team.id, label: 'Account' },
      () => {},
      new AbortController().signal,
    );
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
