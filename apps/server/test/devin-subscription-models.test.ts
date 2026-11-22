import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { devinSubscription } from '../src/db/schema.js';
import { fetchDevinSubscriptionModels } from '../src/services/devin-subscription-models.js';
import { bootServer, req } from './helpers.js';

const TOKEN = `wsk-test-models-token-${'y'.repeat(64)}`;

const fixtureDirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const dir of fixtureDirs.splice(0)) releaseTestTempDir(dir);
});

const CATALOG = {
  families: [
    {
      family_label: 'SWE-2',
      family_uid: 'swe-2',
      slug: 'swe-2',
      aliases: ['swe'],
      variants: [
        {
          model_uid: 'swe-2-high',
          label: 'SWE-2 High',
          description: 'Flagship model',
          max_context_tokens: 262000,
          max_output_tokens: 128000,
          cost_tier: 'Free',
          is_new: false,
          is_beta: false,
        },
        {
          model_uid: 'swe-2-flash-medium',
          label: 'SWE-2 Flash',
          max_context_tokens: 262144,
          max_output_tokens: 128000,
          cost_tier: 'High cost',
          cost_summary: '$1 / 1M Input · $0.1 / 1M Cached input · $5 / 1M Output',
          is_new: true,
          is_beta: true,
        },
      ],
    },
  ],
};

const CONFIG_OPTIONS = [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'normal',
    options: [{ value: 'normal', name: 'Normal' }],
  },
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'swe-2-high',
    options: [
      { value: 'swe-2-high', name: 'SWE-2', _meta: { 'cognition.ai/supportsImages': true } },
      { value: 'swe-2-flash-medium', name: '', _meta: { 'cognition.ai/supportsImages': false } },
      {
        group: 'external',
        name: 'External',
        options: [{ value: 'claude-x', name: 'Claude X' }],
      },
    ],
  },
  {
    id: 'thought_level',
    name: 'Thought level',
    category: 'thought_level',
    type: 'select',
    currentValue: 'off',
    options: [{ value: 'off', name: 'Off' }],
  },
  { id: 'flag', name: 'Flag', category: 'model', type: 'boolean', currentValue: true },
];

const UPDATE_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'swe-2-high',
    options: [
      { value: 'swe-2-high', name: 'SWE-2 renamed' },
      { value: 'gpt-5.5', name: 'GPT-5.5', _meta: { 'cognition.ai/supportsImages': true } },
    ],
  },
];

type FakeOpts = {
  catalog?: 'ok' | 'fail' | 'garbage';
  acp?: 'ok' | 'auth-reject' | 'session-error' | 'no-update';
  authenticate?: 'ok' | 'absent';
};

function fakeDevinModels(opts: FakeOpts = {}): { dir: string; runs: string } {
  const dir = makeTestTempDir('devin-models-');
  fixtureDirs.push(dir);
  const runs = join(dir, 'runs');
  const binary = join(dir, 'devin');
  const catalog = opts.catalog ?? 'ok';
  const acp = opts.acp ?? 'ok';
  const authenticate = opts.authenticate ?? 'ok';
  const catalogBody =
    catalog === 'ok'
      ? `printf '%s' '${JSON.stringify(CATALOG)}'`
      : catalog === 'garbage'
        ? "printf 'not json'"
        : 'exit 2';
  const authMethods =
    authenticate === 'absent' ? '[]' : '[{"id":"devin-browser","name":"Devin browser"}]';
  const authReply =
    acp === 'auth-reject'
      ? '{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"401 invalid api key"}}'
      : '{"jsonrpc":"2.0","id":2,"result":null}';
  const sessionReply =
    acp === 'session-error'
      ? '{"jsonrpc":"2.0","id":3,"error":{"code":-32000,"message":"session blew up"}}'
      : `{"jsonrpc":"2.0","id":3,"result":{"sessionId":"s1","configOptions":${JSON.stringify(CONFIG_OPTIONS)}}}`;
  const sessionUpdate =
    acp === 'ok'
      ? JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: { sessionUpdate: 'config_option_update', configOptions: UPDATE_OPTIONS },
          },
        })
      : null;
  const sessionLines = sessionUpdate === null ? [sessionReply] : [sessionReply, sessionUpdate];
  const sessionWrite = `printf '${sessionLines.map(() => '%s\\n').join('')}' ${sessionLines
    .map((line) => `'${line}'`)
    .join(' ')}`;
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      '[ -f "$HOME/.local/share/devin/credentials.toml" ] || { echo missing >&2; exit 3; }',
      'find "$HOME/.local/share/devin" -name credentials.toml -perm 600 | grep -q . || { echo mode >&2; exit 4; }',
      `grep -q 'windsurf_api_key = "${TOKEN}"' "$HOME/.local/share/devin/credentials.toml" || { echo token >&2; exit 5; }`,
      `echo "$@" >> "${runs}"`,
      'if [ "$1" = "models" ]; then',
      `  ${catalogBody}`,
      '  exit 0',
      'fi',
      'while IFS= read -r line; do',
      '  case "$line" in',
      '    *initialize*)',
      `      printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{},"authMethods":${authMethods}}}' ;;`,
      '    *authenticate*)',
      `      printf '%s\\n' '${authReply}' ;;`,
      '    *session/new*)',
      `      ${sessionWrite} ;;`,
      '  esac',
      'done',
    ].join('\n'),
    { mode: 0o755 },
  );
  vi.stubEnv('DEVIN_BIN', binary);
  return { dir, runs };
}

describe('fetchDevinSubscriptionModels', () => {
  test('joins the ACP select set with the catalog metadata, merging session/update options', async () => {
    const { runs } = fakeDevinModels();
    const result = await fetchDevinSubscriptionModels(TOKEN, { settleMs: 150 });
    expect(result).toEqual({
      ok: true,
      models: [
        {
          id: 'swe-2-high',
          name: 'SWE-2',
          family: 'SWE-2',
          costTier: 'Free',
          contextTokens: 262000,
          isNew: false,
          isBeta: false,
          supportsImages: true,
        },
        {
          id: 'swe-2-flash-medium',
          name: 'swe-2-flash-medium',
          family: 'SWE-2',
          costTier: 'High cost',
          costSummary: '$1 / 1M Input · $0.1 / 1M Cached input · $5 / 1M Output',
          contextTokens: 262144,
          isNew: true,
          isBeta: true,
          supportsImages: false,
        },
        { id: 'claude-x', name: 'Claude X' },
        { id: 'gpt-5.5', name: 'GPT-5.5', supportsImages: true },
      ],
    });
    const invocations = readFileSync(runs, 'utf8').trim().split('\n').sort();
    expect(invocations).toEqual(['acp', 'models list --format json --process-model in-process']);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('cairn-devin-models-'))).toEqual(
      [],
    );
  });

  test('a failed models list degrades to bare ACP options and a missing binary reports unavailable', async () => {
    const { dir } = fakeDevinModels({ catalog: 'fail', acp: 'no-update' });
    const degraded = await fetchDevinSubscriptionModels(TOKEN, { settleMs: 150 });
    expect(degraded).toEqual({
      ok: true,
      models: [
        { id: 'swe-2-high', name: 'SWE-2', supportsImages: true },
        { id: 'swe-2-flash-medium', name: 'swe-2-flash-medium', supportsImages: false },
        { id: 'claude-x', name: 'Claude X' },
      ],
    });
    vi.stubEnv('DEVIN_BIN', join(dir, 'missing'));
    expect(await fetchDevinSubscriptionModels(TOKEN, { settleMs: 50 })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  test('ACP auth and session failures classify instead of falling back to the bare catalog', async () => {
    fakeDevinModels({ acp: 'auth-reject' });
    expect(await fetchDevinSubscriptionModels(TOKEN, { settleMs: 50 })).toEqual({
      ok: false,
      reason: 'auth',
    });
    fakeDevinModels({ acp: 'session-error' });
    expect(await fetchDevinSubscriptionModels(TOKEN, { settleMs: 50 })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  test('session/new without authenticate works when no auth methods are advertised', async () => {
    fakeDevinModels({ authenticate: 'absent', acp: 'no-update' });
    const result = await fetchDevinSubscriptionModels(TOKEN, { settleMs: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.models).toHaveLength(3);
  });
});

describe('devin subscription upstream-models endpoint', () => {
  async function subscription(s: ReturnType<typeof bootServer>) {
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect(created.status).toBe(201);
    return { path, id: ((await created.json()) as { id: string }).id };
  }

  test('returns the harvested catalog in the UpstreamModelsResult envelope and never leaks the token', async () => {
    const s = bootServer();
    const { path, id } = await subscription(s);
    fakeDevinModels();
    const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      models: { id: string; name: string; family?: string; supportsImages?: boolean }[];
    };
    expect(body.status).toBe('ok');
    expect(body.models).toHaveLength(4);
    expect(body.models[0]).toMatchObject({
      id: 'swe-2-high',
      name: 'SWE-2',
      family: 'SWE-2',
      costTier: 'Free',
      supportsImages: true,
    });
    const list = await req(s.app, 'GET', path);
    expect(await list.text()).not.toContain(TOKEN);
  });

  test('missing binary and rejected token map onto the existing failure enum; a second call is throttled', async () => {
    const s = bootServer();
    const { path, id } = await subscription(s);
    vi.stubEnv('DEVIN_BIN', '/nonexistent/devin-binary');
    const unavailable = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(await unavailable.json()).toEqual({
      status: 'failed',
      failure: 'upstream',
      httpStatus: null,
    });
    expect((await req(s.app, 'POST', `${path}/${id}/upstream-models`)).status).toBe(429);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    fakeDevinModels({ acp: 'auth-reject' });
    const rejected = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(await rejected.json()).toEqual({
      status: 'failed',
      failure: 'auth',
      httpStatus: null,
    });
    clock.mockRestore();
  });

  test('expired subscription answers auth-failed without spawning and foreign ids 404', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Expired',
      token: TOKEN,
      expiresAt: Date.now() + 60_000,
    });
    const { id } = (await created.json()) as { id: string };
    s.db
      .update(devinSubscription)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(devinSubscription.id, id))
      .run();
    const { runs } = fakeDevinModels();
    const expired = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(await expired.json()).toEqual({
      status: 'failed',
      failure: 'auth',
      httpStatus: null,
    });
    expect(existsSync(runs)).toBe(false);
    expect(
      (await req(s.app, 'POST', `/api/teams/other/devin-subscriptions/${id}/upstream-models`))
        .status,
    ).toBe(404);
    expect(
      (
        await req(
          s.app,
          'POST',
          `/api/teams/${s.team.id}/devin-subscriptions/missing/upstream-models`,
        )
      ).status,
    ).toBe(404);
  });
});

describe('patching devin subscription models', () => {
  test('models replace wholesale, dedupe by id first-wins, and the label is untouched when absent', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    const { id } = (await created.json()) as { id: string };
    const models = [
      { id: 'swe-2-high', name: 'SWE-2', costTier: 'Free', supportsImages: true },
      { id: 'swe-2-high', name: 'SWE-2 duplicate' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ];
    const patched = await req(s.app, 'PATCH', `${path}/${id}`, { models });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id,
      label: 'Personal',
      models: [
        { id: 'swe-2-high', name: 'SWE-2', costTier: 'Free', supportsImages: true },
        { id: 'gpt-5.5', name: 'GPT-5.5' },
      ],
    });
    const listed = await req(s.app, 'GET', path);
    const row = ((await listed.json()) as { id: string; models: { id: string }[] }[]).find(
      (entry) => entry.id === id,
    );
    expect(row?.models.map((model) => model.id)).toEqual(['swe-2-high', 'gpt-5.5']);
    const shrunk = await req(s.app, 'PATCH', `${path}/${id}`, {
      models: [{ id: 'swe-2-high', name: 'SWE-2' }],
    });
    expect(await shrunk.json()).toMatchObject({
      models: [{ id: 'swe-2-high', name: 'SWE-2' }],
    });
    const renamed = await req(s.app, 'PATCH', `${path}/${id}`, { label: 'Work' });
    expect(await renamed.json()).toMatchObject({
      label: 'Work',
      models: [{ id: 'swe-2-high', name: 'SWE-2' }],
    });
    const cleared = await req(s.app, 'PATCH', `${path}/${id}`, { models: [] });
    expect(await cleared.json()).toMatchObject({ label: 'Work', models: [] });
  });

  test('rejects empty patches, malformed entries, and oversized model lists', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    const { id } = (await created.json()) as { id: string };
    expect((await req(s.app, 'PATCH', `${path}/${id}`, {})).status).toBe(400);
    expect(
      (await req(s.app, 'PATCH', `${path}/${id}`, { models: [{ name: 'no id' }] })).status,
    ).toBe(400);
    expect(
      (
        await req(s.app, 'PATCH', `${path}/${id}`, {
          models: Array.from({ length: 2001 }, (_, index) => ({
            id: `m${index}`,
            name: `m${index}`,
          })),
        })
      ).status,
    ).toBe(400);
    const stored = await req(s.app, 'GET', path);
    expect(((await stored.json()) as { models: { id: string }[] }[])[0]?.models ?? []).toHaveLength(
      0,
    );
  });
});
