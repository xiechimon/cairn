import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { devinSubscription } from '../src/db/schema.js';
import * as devinModels from '../src/services/devin-subscription-models.js';
import { fetchDevinSubscriptionModels } from '../src/services/devin-subscription-models.js';
import * as devinVerification from '../src/services/devin-subscription-verification.js';
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

const PARTIAL_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'swe-2-high',
    options: [{ value: 'swe-2-high', name: 'SWE-2' }],
  },
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
  catalog?: 'ok' | 'fail' | 'garbage' | 'hang' | 'hang-before-record';
  acp?:
    | 'ok'
    | 'auth-reject'
    | 'session-error'
    | 'no-update'
    | 'update-only'
    | 'early-update'
    | 'partial-then-update';
  authenticate?: 'ok' | 'absent';
  extraModels?: number;
  partialUpdateDelaySeconds?: number;
  authErrorAt?: 'initialize' | 'authenticate' | 'session/new';
  catalogData?: unknown;
  configOptions?: unknown;
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
      ? `printf '%s' '${JSON.stringify(opts.catalogData ?? CATALOG)}'`
      : catalog === 'garbage'
        ? "printf 'not json'"
        : catalog === 'hang'
          ? `exec node -e 'require("node:fs").writeFileSync("${join(dir, 'metadata.pid')}", String(process.pid)); setInterval(() => {}, 1000)'`
          : 'exit 2';
  const authMethods =
    authenticate === 'absent' ? '[]' : '[{"id":"devin-browser","name":"Devin browser"}]';
  const structuredAuthError = (id: number) =>
    JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Sign-in required' } });
  const initializeReply =
    opts.authErrorAt === 'initialize'
      ? structuredAuthError(1)
      : `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{},"authMethods":${authMethods}}}`;
  const authReply =
    opts.authErrorAt === 'authenticate'
      ? structuredAuthError(2)
      : acp === 'auth-reject'
        ? '{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"401 invalid api key"}}'
        : '{"jsonrpc":"2.0","id":2,"result":null}';
  const sessionReply =
    opts.authErrorAt === 'session/new'
      ? structuredAuthError(3)
      : acp === 'session-error'
        ? '{"jsonrpc":"2.0","id":3,"error":{"code":-32603,"message":"session blew up"}}'
        : `{"jsonrpc":"2.0","id":3,"result":{"sessionId":"s1","configOptions":${JSON.stringify(acp === 'update-only' || acp === 'early-update' ? [] : acp === 'partial-then-update' ? PARTIAL_OPTIONS : (opts.configOptions ?? CONFIG_OPTIONS))}}}`;
  const modelUpdate = (configOptions: unknown) =>
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'config_option_update', configOptions } },
    });
  const sessionLines = [sessionReply];
  if (acp === 'ok') {
    sessionLines.push(
      modelUpdate(
        UPDATE_OPTIONS.map((option) => ({
          ...option,
          options: [
            ...option.options,
            ...Array.from({ length: opts.extraModels ?? 0 }, (_, i) => ({
              value: `fake-model-${i}`,
              name: `Fake model ${i}`,
            })),
          ],
        })),
      ),
    );
  }
  let sessionWrite = `printf '%s\\n' ${sessionLines.map((line) => `'${line}'`).join(' ')}`;
  if (acp === 'ok') sessionWrite += '; exit 0';
  if (acp === 'update-only') {
    sessionWrite += `; sleep 0.1; printf '%s\\n' '${modelUpdate(UPDATE_OPTIONS)}'`;
  }
  if (acp === 'partial-then-update') {
    sessionWrite += `; sleep ${opts.partialUpdateDelaySeconds ?? 0.1}; printf '%s\\n' '${modelUpdate(UPDATE_OPTIONS)}'`;
  }
  if (acp === 'early-update') {
    sessionWrite = `printf '%s\\n' '${modelUpdate(UPDATE_OPTIONS)}' '${sessionReply}'`;
  }
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      ...(catalog === 'hang-before-record'
        ? [
            `if [ "$1" = "models" ]; then exec '${process.execPath}' -e 'setInterval(() => {}, 1000)'; fi`,
          ]
        : []),
      'if [ -f "$HOME/.local/share/devin/credentials.toml" ]; then',
      '  find "$HOME/.local/share/devin" -name credentials.toml -perm 600 | grep -q . || { echo mode >&2; exit 4; }',
      `  grep -q 'windsurf_api_key = "${TOKEN}"' "$HOME/.local/share/devin/credentials.toml" || { echo token >&2; exit 5; }`,
      'else',
      `  [ "$WINDSURF_API_KEY" = "${TOKEN}" ] || { echo missing >&2; exit 3; }`,
      'fi',
      `echo "$@" >> "${runs}"`,
      'if [ "$1" = "models" ]; then',
      `  ${catalogBody}`,
      '  exit 0',
      'fi',
      'while IFS= read -r line; do',
      '  case "$line" in',
      '    *initialize*)',
      ...(catalog === 'hang'
        ? [`      while [ ! -f "${join(dir, 'metadata.pid')}" ]; do sleep 0.01; done`]
        : []),
      `      printf '%s\\n' '${initializeReply}' ;;`,
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
  test('returns all 169 ACP choices promptly when the listing process closes cleanly', async () => {
    fakeDevinModels({ extraModels: 165 });
    const start = performance.now();
    const result = await fetchDevinSubscriptionModels(TOKEN);
    const elapsed = performance.now() - start;
    expect(result.ok && result.models.length).toBe(169);
    expect(elapsed, `Fake ACP cold fetch: ${elapsed.toFixed(1)} ms`).toBeLessThan(1_500);
    console.info(`Fake ACP cold fetch: ${elapsed.toFixed(1)} ms`);
  });

  test.each([
    ['no-update', ['swe-2-high', 'swe-2-flash-medium', 'claude-x']],
    ['update-only', ['swe-2-high', 'gpt-5.5']],
    ['early-update', ['swe-2-high', 'gpt-5.5']],
  ] as const)(
    'collects the %s catalog within the configured bound even while the ACP session stays open',
    async (acp, ids) => {
      fakeDevinModels({ acp });
      const result = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 350 });
      expect(result.ok && result.models.map((model) => model.id)).toEqual(ids);
    },
  );

  test.each([0.1, 0.65])(
    'keeps collecting when a matching update completes a partial catalog %ss later',
    async (partialUpdateDelaySeconds) => {
      fakeDevinModels({ acp: 'partial-then-update', partialUpdateDelaySeconds });
      const result = await fetchDevinSubscriptionModels(TOKEN);
      expect(result.ok && result.models.map((model) => model.id)).toEqual([
        'swe-2-high',
        'gpt-5.5',
      ]);
    },
  );

  test('stops waiting for the optional models list shortly after ACP succeeds', async () => {
    const { dir } = fakeDevinModels({ catalog: 'hang' });
    const start = performance.now();
    const result = await fetchDevinSubscriptionModels(TOKEN, {
      timeoutMs: 5_000,
      catalogGraceMs: 200,
    });
    const elapsed = performance.now() - start;
    expect(result.ok && result.models.map((model) => model.id)).toEqual([
      'swe-2-high',
      'swe-2-flash-medium',
      'claude-x',
      'gpt-5.5',
    ]);
    if (result.ok)
      expect(result.models[0]).toEqual({ id: 'swe-2-high', name: 'SWE-2', supportsImages: true });
    expect(elapsed, `waited ${elapsed.toFixed(0)} ms`).toBeLessThan(1_500);
    const pid = Number(readFileSync(join(dir, 'metadata.pid'), 'utf8'));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });

  test('joins the ACP select set with the catalog metadata, merging session/update options', async () => {
    const { runs } = fakeDevinModels();
    const result = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 150 });
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
    expect(invocations).toEqual([
      'acp --process-model in-process',
      'models list --format json --process-model in-process',
    ]);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('cairn-devin-models-'))).toEqual(
      [],
    );
  });

  test('a failed models list degrades to bare ACP options and a missing binary reports unavailable', async () => {
    const { dir } = fakeDevinModels({ catalog: 'fail', acp: 'no-update' });
    const degraded = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 150 });
    expect(degraded).toEqual({
      ok: true,
      models: [
        { id: 'swe-2-high', name: 'SWE-2', supportsImages: true },
        { id: 'swe-2-flash-medium', name: 'swe-2-flash-medium', supportsImages: false },
        { id: 'claude-x', name: 'Claude X' },
      ],
    });
    vi.stubEnv('DEVIN_BIN', join(dir, 'missing'));
    expect(await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 50 })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  test('ACP auth and session failures classify instead of falling back to the bare catalog', async () => {
    fakeDevinModels({ acp: 'auth-reject' });
    expect(await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 50 })).toEqual({
      ok: false,
      reason: 'auth',
    });
    fakeDevinModels({ acp: 'session-error' });
    expect(await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 50 })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  test.each(['initialize', 'authenticate', 'session/new'] as const)(
    'classifies the structured auth-required code at %s without message heuristics',
    async (authErrorAt) => {
      fakeDevinModels({ authErrorAt });
      expect(await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 50 })).toEqual({
        ok: false,
        reason: 'auth',
      });
    },
  );

  test.each(['initialize', 'authenticate', 'session/new'] as const)(
    'returns an auth failure at %s immediately and cancels hanging metadata',
    async (authErrorAt) => {
      const { dir } = fakeDevinModels({ catalog: 'hang', authErrorAt });
      const result = await fetchDevinSubscriptionModels(TOKEN, { timeoutMs: 30_000 });
      expect(result).toEqual({ ok: false, reason: 'auth' });
      const pid = Number(readFileSync(join(dir, 'metadata.pid'), 'utf8'));
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    },
  );

  test('session/new without authenticate works when no auth methods are advertised', async () => {
    fakeDevinModels({ authenticate: 'absent', acp: 'no-update' });
    const result = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.models).toHaveLength(3);
  });
});

describe('fetchDevinSubscriptionModels credential echo defense', () => {
  const modelSelect = (options: unknown[]) => [
    { id: 'model', name: 'Model', category: 'model', type: 'select', options },
  ];

  test('drops ACP models whose id or name echo the token or exceed the schema length', async () => {
    fakeDevinModels({
      acp: 'no-update',
      catalog: 'fail',
      configOptions: modelSelect([
        { value: 'safe-a', name: 'Safe A' },
        { value: `leak-${TOKEN}`, name: 'Leaky id' },
        { value: 'leak-name', name: `Name ${TOKEN} echoed` },
        { value: 'x'.repeat(257), name: 'Long id' },
        { value: 'long-name', name: 'n'.repeat(257) },
        { group: 'g', name: 'G', options: [{ value: `grp-${TOKEN}`, name: 'Grouped leak' }] },
        { value: 'safe-b', name: '' },
        { value: 'edge-256', name: 'e'.repeat(256) },
      ]),
    });
    const result = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 150 });
    expect(result).toEqual({
      ok: true,
      models: [
        { id: 'safe-a', name: 'Safe A' },
        { id: 'safe-b', name: 'safe-b' },
        { id: 'edge-256', name: 'e'.repeat(256) },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test('drops only the catalog metadata fields that echo the token and keeps safe metadata', async () => {
    fakeDevinModels({
      acp: 'no-update',
      configOptions: modelSelect([
        { value: 'tainted', name: 'Tainted' },
        { value: 'clean', name: 'Clean' },
      ]),
      catalogData: {
        families: [
          {
            family_label: `Family ${TOKEN}`,
            variants: [
              {
                model_uid: 'tainted',
                cost_tier: `Tier ${TOKEN}`,
                cost_summary: `$1 ${TOKEN}`,
                max_context_tokens: 1000,
                is_new: true,
              },
              { model_uid: `uid-${TOKEN}`, cost_tier: 'Free' },
            ],
          },
          {
            family_label: 'Clean family',
            variants: [
              {
                model_uid: 'clean',
                cost_tier: 'Free',
                cost_summary: '$1 / 1M Input',
                is_beta: true,
              },
            ],
          },
        ],
      },
    });
    const result = await fetchDevinSubscriptionModels(TOKEN, { updateWaitMs: 150 });
    expect(result).toEqual({
      ok: true,
      models: [
        { id: 'tainted', name: 'Tainted', contextTokens: 1000, isNew: true },
        {
          id: 'clean',
          name: 'Clean',
          family: 'Clean family',
          costTier: 'Free',
          costSummary: '$1 / 1M Input',
          isBeta: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test('a token echoed through the upstream-models endpoint never reaches the response or cache', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    const { id } = (await created.json()) as { id: string };
    fakeDevinModels({
      acp: 'no-update',
      configOptions: modelSelect([
        { value: `leak-${TOKEN}`, name: 'Leaky' },
        { value: 'safe', name: 'Safe' },
      ]),
    });
    const url = `${path}/${id}/upstream-models`;
    const first = await (await req(s.app, 'POST', url)).text();
    const second = await (await req(s.app, 'POST', url)).text();
    expect(first).not.toContain(TOKEN);
    expect(second).not.toContain(TOKEN);
    expect(JSON.parse(first)).toMatchObject({
      status: 'ok',
      models: [{ id: 'safe', name: 'Safe' }],
    });
    s.dispose();
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

  test('serves a warm catalog from the same subscription without spawning more CLI processes', async () => {
    const s = bootServer();
    const { path, id } = await subscription(s);
    const { runs } = fakeDevinModels({ extraModels: 165 });
    const url = `${path}/${id}/upstream-models`;
    const first = await req(s.app, 'POST', url);
    expect(first.status).toBe(200);
    const body = await first.json();
    const start = performance.now();
    const second = await req(s.app, 'POST', url);
    const elapsed = performance.now() - start;
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(body);
    expect(readFileSync(runs, 'utf8').trim().split('\n')).toHaveLength(2);
    console.info(`Fake ACP warm fetch: ${elapsed.toFixed(1)} ms`);
  });

  test('serves a stale catalog during one refresh and keeps subscriptions separate', async () => {
    const s = bootServer();
    const { path, id } = await subscription(s);
    fakeDevinModels();
    const url = `${path}/${id}/upstream-models`;
    const first = await req(s.app, 'POST', url);
    const original = await first.json();
    expect(original).toMatchObject({ status: 'ok', models: expect.any(Array) });

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    const { runs } = fakeDevinModels({ extraModels: 1 });
    const poll = async () => (await req(s.app, 'POST', url)).json();
    expect(await poll()).toEqual(original);
    await Promise.all([poll(), poll(), poll()]);
    await vi.waitFor(async () => {
      expect(await poll()).toMatchObject({
        status: 'ok',
        models: expect.arrayContaining([{ id: 'fake-model-0', name: 'Fake model 0' }]),
      });
    });
    expect(readFileSync(runs, 'utf8').trim().split('\n')).toHaveLength(2);

    const other = await subscription(s);
    const otherResponse = await req(s.app, 'POST', `${other.path}/${other.id}/upstream-models`);
    expect(otherResponse.status).toBe(200);
    expect(readFileSync(runs, 'utf8').trim().split('\n')).toHaveLength(4);
  });

  test.each([
    ['verify', 'auth-reject'],
    ['verify', 'session-error'],
    ['enable', 'auth-reject'],
    ['enable', 'session-error'],
  ] as const)(
    'an explicit %s failure (%s) evicts a warm catalog before the next lookup',
    async (action, acp) => {
      const s = bootServer();
      const { path, id } = await subscription(s);
      fakeDevinModels();
      const url = `${path}/${id}/upstream-models`;
      expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({ status: 'ok' });
      const other = await subscription(s);
      const otherUrl = `${path}/${other.id}/upstream-models`;
      expect(await (await req(s.app, 'POST', otherUrl)).json()).toMatchObject({ status: 'ok' });
      if (action === 'enable') {
        expect((await req(s.app, 'POST', `${path}/${id}/disable`)).status).toBe(200);
      }
      const { runs } = fakeDevinModels({
        acp,
        ...(acp === 'session-error'
          ? { authenticate: 'absent', catalog: 'hang-before-record' }
          : {}),
      });
      const checked = await req(s.app, 'POST', `${path}/${id}/${action}`);
      expect(checked.status).toBe(action === 'verify' ? 200 : 409);
      if (action === 'verify') {
        expect(await checked.json()).toMatchObject({
          ok: false,
          reason: acp === 'auth-reject' ? 'auth' : 'failed',
        });
      }
      expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({
        status: 'failed',
        failure: acp === 'auth-reject' ? 'auth' : 'upstream',
      });
      expect(await (await req(s.app, 'POST', otherUrl)).json()).toMatchObject({ status: 'ok' });
      const acpInvocations = readFileSync(runs, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('acp'));
      expect(acpInvocations).toEqual(['acp', 'acp --process-model in-process']);
      s.dispose();
    },
  );

  test('an auth failure during refresh invalidates the previously successful catalog', async () => {
    const s = bootServer();
    const { path, id } = await subscription(s);
    fakeDevinModels();
    const url = `${path}/${id}/upstream-models`;
    expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({ status: 'ok' });
    const staleTime = Date.now() + 60_001;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(staleTime);
    fakeDevinModels({ authErrorAt: 'session/new', catalog: 'hang' });
    expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({ status: 'ok' });
    await vi.waitFor(async () => expect((await req(s.app, 'POST', url)).status).toBe(429), {
      timeout: 10_000,
    });
    clock.mockReturnValue(staleTime + 10_000);
    expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({
      status: 'failed',
      failure: 'auth',
    });
  });

  test.each([
    ['verify', false],
    ['verify', true],
    ['enable', false],
    ['enable', true],
  ] as const)(
    '%s invalidation during a pending harvest (stale=%s) rejects old results and keeps one refresh',
    async (action, stale) => {
      const s = bootServer();
      const { path, id } = await subscription(s);
      const url = `${path}/${id}/upstream-models`;
      const success = {
        ok: true,
        models: [{ id: 'fixture-model', name: 'Fixture Model' }],
      } as const;
      const harvest = vi.spyOn(devinModels, 'fetchDevinSubscriptionModels');
      harvest.mockResolvedValue({ ...success, models: [...success.models] });
      let now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      if (stale) {
        expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({ status: 'ok' });
        now += 60_001;
      }
      if (action === 'enable') {
        expect((await req(s.app, 'POST', `${path}/${id}/disable`)).status).toBe(200);
      }
      let resolve!: (result: devinModels.DevinSubscriptionModelsResult) => void;
      harvest
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValue({ ...success, models: [...success.models] });
      const first = req(s.app, 'POST', url);
      const expectedCalls = stale ? 2 : 1;
      await vi.waitFor(() => expect(harvest).toHaveBeenCalledTimes(expectedCalls));
      if (stale) expect(await (await first).json()).toMatchObject({ status: 'ok' });
      vi.spyOn(devinVerification, 'verifyDevinSubscription').mockResolvedValue({
        ok: false,
        reason: 'auth',
      });
      const checked = await req(s.app, 'POST', `${path}/${id}/${action}`);
      expect(checked.status).toBe(action === 'verify' ? 200 : 409);
      const second = req(s.app, 'POST', url);
      const secondResult = second.then((response) => response.json());
      await vi.waitFor(() => expect(harvest).toHaveBeenCalledTimes(expectedCalls));
      resolve({ ...success, models: [...success.models] });
      expect(await secondResult).toMatchObject({ status: 'failed', failure: 'auth' });
      if (!stale)
        expect(await (await first).json()).toMatchObject({ status: 'failed', failure: 'auth' });
      expect(harvest).toHaveBeenCalledTimes(expectedCalls);
      expect((await req(s.app, 'POST', url)).status).toBe(429);
      now += 10_000;
      harvest.mockResolvedValue({ ...success, models: [...success.models] });
      expect(await (await req(s.app, 'POST', url)).json()).toMatchObject({ status: 'ok' });
      expect(harvest).toHaveBeenCalledTimes(expectedCalls + 1);
      s.dispose();
    },
  );

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
