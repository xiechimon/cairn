import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { build, chiefThread, doubaoSubscription, provider, step } from '../src/db/schema.js';
import {
  bootServer,
  insertDevinSubscription,
  ownBuildConversation,
  req,
  type TestServer,
} from './helpers.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 28, 4);
const ACCESS = 'fixture-access-not-a-secret';
const RESET = NOW + HOUR;
const endpoint = (s: TestServer, kind: string, id: string) =>
  `/api/teams/${s.team.id}/subscription-quota/${kind}/${id}`;

function chatgpt(s: TestServer, expires = NOW + 7 * HOUR) {
  s.db
    .insert(provider)
    .values({
      id: 'chatgpt',
      teamId: s.team.id,
      providerId: 'openai-codex',
      label: 'ChatGPT',
      baseUrl: 'https://invalid.invalid',
      api: 'openai-responses',
      compat: {},
      apiKeyCipher: s.secretBox.seal(
        JSON.stringify({
          kind: 'codex-oauth',
          access: ACCESS,
          refresh: 'fixture-refresh',
          expires,
          accountId: 'fixture-account',
        }),
      ),
      createdBy: s.user.id,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

const weekly = {
  used_percent: 39,
  limit_window_seconds: 604800,
  reset_after_seconds: 3600,
  reset_at: RESET / 1000,
};
const empty = {
  fiveHour: { runs: 0, limited: 0 },
  sevenDay: { runs: 0, limited: 0 },
  resetsAt: null,
};

test.each([null, { ...weekly, used_percent: 100, limit_window_seconds: 18000 }])(
  'ChatGPT recorded response uses the selected login and real window durations (secondary %j)',
  async (secondary) => {
    const fetch = vi.fn(async () =>
      Response.json({
        rate_limit: { primary_window: weekly, secondary_window: secondary },
      }),
    );
    const s = bootServer({ oauthFetch: fetch });
    chatgpt(s, Date.now() + HOUR);
    const res = await req(s.app, 'GET', endpoint(s, 'codex', 'chatgpt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        redirect: 'error',
        headers: { authorization: `Bearer ${ACCESS}`, 'chatgpt-account-id': 'fixture-account' },
      }),
    );
    const data = await res.json();
    expect(data).toEqual({
      activity: empty,
      windows: [
        { name: 'seven_day', utilization: 0.39, resetsAt: RESET, observedAt: expect.any(Number) },
        ...(secondary === null
          ? []
          : [
              {
                name: 'five_hour',
                utilization: 1,
                resetsAt: RESET,
                observedAt: expect.any(Number),
              },
            ]),
      ],
    });
    expect(JSON.stringify(data)).not.toMatch(/fixture-(access|account|refresh)/);
  },
);

test.each(['devin', 'doubao'] as const)(
  '%s recorded activity is scoped and uses rolling claim times',
  async (kind) => {
    const fetch = vi.fn();
    const s = bootServer({ oauthFetch: fetch });
    const id = kind === 'devin' ? insertDevinSubscription(s) : 'doubao';
    if (kind === 'doubao')
      s.db
        .insert(doubaoSubscription)
        .values({ id, teamId: s.team.id, label: 'Doubao', createdAt: NOW })
        .run();
    const now = Date.now();
    const claimed = (key: string, hours: number, account = id) => ({
      id: key,
      buildId: key,
      kind: 'build' as const,
      createdAt: 1,
      claimedAt: now - hours * HOUR,
      ...(kind === 'devin' ? { devinSubscriptionId: account } : { doubaoSubscriptionId: account }),
    });
    s.db
      .insert(step)
      .values([
        {
          ...claimed('recent', 1),
          status: 'failed',
          failureCode: 'rate_limit',
          finishedAt: now - HOUR / 2,
        },
        { ...claimed('yesterday', 24), status: 'done' },
        { ...claimed('old', 170), status: 'done' },
        { ...claimed('other', 1, 'other'), status: 'done' },
        { ...claimed('future', -1), status: 'done' },
        { ...claimed('unclaimed', 1), status: 'pending', claimedAt: null },
      ])
      .run();
    const res = await req(s.app, 'GET', endpoint(s, kind, id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      windows: [],
      activity: {
        fiveHour: { runs: 1, limited: 1 },
        sevenDay: { runs: 2, limited: 1 },
        resetsAt: null,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

test('recorded activity shows an explicit reset from the attributable Devin failure', async () => {
  const s = bootServer();
  const id = insertDevinSubscription(s);
  ownBuildConversation(s, 'quota-build');
  const now = Date.now();
  s.db
    .update(build)
    .set({
      errorMessage: 'HTTP 429; retry in 60 seconds',
      failureCode: 'rate_limit',
    })
    .where(eq(build.id, 'quota-build'))
    .run();
  s.db
    .insert(step)
    .values({
      id: 'quota-step',
      buildId: 'quota-build',
      kind: 'build',
      status: 'failed',
      createdAt: now - 2000,
      claimedAt: now - 1500,
      finishedAt: now - 1000,
      failureCode: 'rate_limit',
      devinSubscriptionId: id,
    })
    .run();
  const res = await req(s.app, 'GET', endpoint(s, 'devin', id));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ activity: { resetsAt: now + 59_000 } });
});

test('ChatGPT counts both tasks and Coordinator turns from the selected team', async () => {
  const s = bootServer();
  chatgpt(s, 1);
  ownBuildConversation(s, 'quota-task');
  const now = Date.now();
  for (const [id, teamId] of [
    ['local-chief', s.team.id],
    ['foreign-chief', 'foreign-team'],
  ] as const) {
    s.db
      .insert(chiefThread)
      .values({
        id,
        teamId,
        chiefId: id,
        userId: s.user.id,
        title: id,
        createdAt: now,
        updatedAt: now,
        sessionId: id,
        sessionOpenedAt: now,
      })
      .run();
  }
  for (const buildId of ['quota-task', 'local-chief', 'foreign-chief']) {
    s.db
      .insert(step)
      .values({
        id: buildId,
        buildId,
        kind: buildId === 'quota-task' ? 'build' : 'chief',
        status: 'done',
        claimedAt: now,
        createdAt: now,
        ranModel: { provider: 'openai-codex', modelId: 'fixture' },
      })
      .run();
  }
  const res = await req(s.app, 'GET', endpoint(s, 'codex', 'chatgpt'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    windows: [],
    activity: {
      fiveHour: { runs: 2, limited: 0 },
      sevenDay: { runs: 2, limited: 0 },
      resetsAt: null,
    },
  });
});

test('usage deadline preserves confirmed local activity', async () => {
  const deadline = vi.spyOn(AbortSignal, 'timeout');
  try {
    const s = bootServer({
      oauthFetch: async (_url, options) => {
        const signal = options?.signal;
        if (!signal) throw new Error('Missing timeout signal');
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    chatgpt(s, Date.now() + HOUR);
    const res = await req(s.app, 'GET', endpoint(s, 'codex', 'chatgpt'));
    expect(res.status).toBe(200);
    expect(deadline).toHaveBeenCalledWith(6000);
    expect(await res.json()).toEqual({ windows: [], activity: empty });
  } finally {
    deadline.mockRestore();
  }
}, 12_000);

test('scoped read refuses an unknown team, record, or kind and does not touch upstream', async () => {
  const fetch = vi.fn();
  const s = bootServer({ oauthFetch: fetch });
  chatgpt(s);
  for (const path of [
    endpoint(s, 'codex', 'foreign'),
    endpoint(s, 'custom', 'chatgpt'),
    endpoint(s, 'codex', 'chatgpt').replace(s.team.id, 'unknown-team'),
  ]) {
    expect((await req(s.app, 'GET', path)).status).toBe(404);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('confirmed empty: an expired login keeps local counts without sending a credential', async () => {
  const fetch = vi.fn();
  const s = bootServer({ oauthFetch: fetch });
  chatgpt(s, 1);
  const res = await req(s.app, 'GET', endpoint(s, 'codex', 'chatgpt'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ windows: [], activity: empty });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([401, 429, 502, 200])(
  'upstream failures: status %s or bad body still returns local activity',
  async (status) => {
    const s = bootServer({ oauthFetch: async () => new Response('bad body', { status }) });
    chatgpt(s, Date.now() + HOUR);
    const res = await req(s.app, 'GET', endpoint(s, 'codex', 'chatgpt'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ windows: [], activity: empty });
  },
);
