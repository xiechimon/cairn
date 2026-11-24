import { DEFAULT_ANTIGRAVITY_MODELS, type MachineStreamEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  antigravitySubscription,
  build as buildTable,
  machine as machineTable,
  pairedDevice,
  routingRule,
  step as stepTable,
  team,
} from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { getModelSources } from '../src/services/providers.js';
import { bootServer, insertMachine, issueApiKey, postProject, req, seedRoute } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('antigravity subscriptions REST & model sources', () => {
  test('supports host-keyring subscriptions without token and optional token subscriptions', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const createdHost = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      {
        label: 'Mac Studio Keyring',
      },
    );
    expect(createdHost.status).toBe(201);
    const hostBody = (await createdHost.json()) as {
      id: string;
      kind: string;
      label: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(hostBody).toMatchObject({
      kind: 'antigravity-subscription',
      label: 'Mac Studio Keyring',
      hasToken: false,
      enabled: true,
    });

    const tokenSecret = `AIzaSyA${'x'.repeat(28)}`;
    const createdToken = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Fallback API Key', token: tokenSecret },
    );
    expect(createdToken.status).toBe(201);
    const tokenBody = (await createdToken.json()) as {
      id: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(tokenBody).toMatchObject({ hasToken: true, enabled: false });

    const listed = await req(s.app, 'GET', `/api/teams/${s.team.id}/antigravity-subscriptions`);
    expect(listed.status).toBe(200);
    const rawText = await listed.text();
    expect(rawText).not.toContain(tokenSecret);
    const rows = JSON.parse(rawText) as Array<{ id: string; hasToken: boolean }>;
    expect(rows).toHaveLength(2);

    const renamed = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${hostBody.id}`,
      { label: 'Workstation Keyring' },
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()) as { label: string }).toMatchObject({
      label: 'Workstation Keyring',
    });

    const badRename = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${tokenBody.id}`,
      { label: `bad-${tokenSecret}` },
    );
    expect(badRename.status).toBe(400);
  });

  test('verifies host-login connection from online Runner antigravity capabilities', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineId = insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          version: '1.5.10',
          authenticated: true,
          source: 'local',
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    expect(machineId).toBeDefined();

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' }],
    });

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Local Keyring',
    });
    const sub = (await created.json()) as { id: string };

    const okVerify = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(okVerify.status).toBe(200);
    expect(await okVerify.json()).toMatchObject({ ok: true });

    const createdSecond = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Second Host Keyring' },
    );
    const second = (await createdSecond.json()) as { id: string };

    const switched = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${second.id}/enable`,
    );
    expect(switched.status).toBe(200);
    const dbRows = s.db.select().from(antigravitySubscription).all();
    expect(dbRows.find((r) => r.id === sub.id)?.enabledAt).toBeNull();
    expect(dbRows.find((r) => r.id === second.id)?.enabledAt).not.toBeNull();
  });

  test('refuses disabling or deleting an account with running tasks and lists step history', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'agy-box',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
        },
      },
    });
    seedRoute(s, 'session', { provider: 'antigravity', modelId: 'gemini-4-carbon', machineId });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Token Key',
      token: `AIzaSyA${'z'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };

    const projectId = await postProject(s.app, 'ag-proj');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Task',
        spec: 'Spec',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b-ag',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 10,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's-ag',
        buildId: 'b-ag',
        kind: 'build',
        status: 'claimed',
        claimedAt: 11,
        antigravitySubscriptionId: sub.id,
        createdAt: 11,
      })
      .run();

    const conflictDisable = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(conflictDisable.status).toBe(409);

    const stepsRes = await req(
      s.app,
      'GET',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/steps`,
    );
    expect(stepsRes.status).toBe(200);
    expect(((await stepsRes.json()) as { steps: Array<{ stepId: string }> }).steps[0]?.stepId).toBe(
      's-ag',
    );

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: 20 })
      .where(eq(stepTable.id, 's-ag'))
      .run();
    const disabled = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(disabled.status).toBe(200);
    const removed = await req(
      s.app,
      'DELETE',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
    );
    expect(removed.status).toBe(204);
  });
});

describe('antigravity token verification via Google API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('verifies a token by calling the Google models endpoint with the key header', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const token = `AIzaSyA${'t'.repeat(28)}`;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'API Key',
      token,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(url).not.toContain(token);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(token);
  });

  test('maps Google failures to verify reasons', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Bad Key',
      token: `AIzaSyA${'u'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'auth' });
  });

  test('treats a network failure as unavailable', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Offline Key',
      token: `AIzaSyA${'v'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  test('a key that no longer decrypts reads as a failed check, not a server error', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Tampered Key',
      token: `AIzaSyA${'t'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    s.db
      .update(antigravitySubscription)
      .set({ tokenCipher: 'v1:tampered' })
      .where(eq(antigravitySubscription.id, sub.id))
      .run();
    const res = await req(s.app, 'POST', `${path}/${sub.id}/verify`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'failed' });
    const list = (await (await req(s.app, 'GET', path)).json()) as { lastCheck: unknown }[];
    expect(list[0]?.lastCheck).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('antigravity upstream models', () => {
  async function enrollProbeRunner(
    s: ReturnType<typeof bootServer>,
    name: string,
    authenticated = true,
  ) {
    const key = await issueApiKey(s);
    const enrolled = await s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: s.team.id,
        name,
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravitySubscriptionModels: true,
          antigravity: {
            installed: true,
            authenticated,
            models: [{ id: 'gemini-3.8-flash', name: 'Runner login' }],
          },
        },
      }),
    });
    expect(enrolled.status).toBe(200);
    const runner = (await enrolled.json()) as { machineId: string; token: string };
    s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, runner.machineId))
      .run();
    return runner;
  }

  function probeRequest(
    s: ReturnType<typeof bootServer>,
    requestId: string,
    machineToken: string,
    body: unknown,
  ) {
    return s.app.request(`/api/machine/antigravity/model-probes/${requestId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test.each([
    'expired',
    'ambiguous-default',
    'wrong-runner',
    'retired',
    'confinement',
    'capability',
  ] as const)(
    'returns fallback without dispatching to a %s runner or subscription',
    async (refusal) => {
      const s = bootServer({ githubFetch: async () => new Response('[]') });
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'refusal-runner');
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const created = await req(s.app, 'POST', path, {
        label: 'Refusal',
        token: `AIzaSyA${'r'.repeat(28)}`,
        ...(refusal === 'expired' ? { expiresAt: Date.now() - 1_000 } : {}),
      });
      const { id } = (await created.json()) as { id: string };
      const assigned =
        refusal === 'wrong-runner' ? await enrollProbeRunner(s, 'assigned-offline-stream') : runner;
      if (refusal === 'ambiguous-default') {
        await enrollProbeRunner(s, 'another-eligible-runner');
        s.db.update(team).set({ defaultMachineId: null }).where(eq(team.id, s.team.id)).run();
      } else {
        seedRoute(s, 'session', {
          provider: 'antigravity',
          modelId: 'gemini-4-carbon',
          machineId: assigned.machineId,
          ...(refusal === 'capability' ? { requiredCapabilities: { os: 'linux' } } : {}),
        });
      }
      if (refusal === 'retired') {
        s.db
          .update(machineTable)
          .set({ retiredAt: 1 })
          .where(eq(machineTable.id, runner.machineId))
          .run();
      }
      if (refusal === 'confinement') {
        const row = s.db
          .select()
          .from(machineTable)
          .where(eq(machineTable.id, runner.machineId))
          .get();
        s.db
          .update(machineTable)
          .set({
            capabilities: { ...row!.capabilities!, osPlatform: 'darwin', confinement: undefined },
          })
          .where(eq(machineTable.id, runner.machineId))
          .run();
      }
      const controller = new AbortController();
      const events: MachineStreamEvent[] = [];
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
          if (event.type === 'antigravity.models') {
            events.push(event);
            controller.abort();
          }
        }),
      );
      const response = await s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'fallback',
        models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
      });
      expect(events).toEqual([]);
    },
  );

  test('paired-device diagnostics return fallback without opening the subscription credential', async () => {
    const ownerToken = 'owner-test-0123456789abcdef';
    const s = bootServer({ authToken: ownerToken });
    disposables.push(() => s.dispose());
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await s.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Owner account', token: `AIzaSyA${'o'.repeat(28)}` }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    s.db
      .insert(pairedDevice)
      .values({
        id: 'catalog-phone',
        teamId: s.team.id,
        name: 'Phone',
        tokenHash: 'synthetic',
        masked: 'phone',
        createdAt: 1,
      })
      .run();
    const session = issueBrowserSession(s.db, 'device', 'catalog-phone');
    const open = vi.spyOn(s.secretBox, 'open');
    try {
      const response = await s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        headers: { cookie: `cairn_auth=${session.token}`, 'sec-fetch-site': 'same-origin' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'fallback' });
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  test.each(['pinned', 'no rule', 'unpinned'] as const)(
    'dispatches each account credential only to its assigned connection with %s routing',
    async (routing) => {
      const s = bootServer({ githubFetch: async () => new Response('[]') });
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'probe-runner');
      const otherRunner = await enrollProbeRunner(s, 'unassigned-runner');
      if (routing !== 'pinned') {
        s.db
          .update(team)
          .set({ defaultMachineId: runner.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      if (routing !== 'no rule') {
        seedRoute(s, 'session', {
          provider: 'antigravity',
          modelId: 'gemini-4-carbon',
          machineId: routing === 'pinned' ? runner.machineId : null,
        });
      }
      let event: ReturnType<
        typeof deferred<Extract<MachineStreamEvent, { type: 'antigravity.models' }>>
      >;
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') event.resolve(message);
        }),
      );
      const connectionId = s.machineHub.connectionId(runner.machineId);
      expect(connectionId).toBeDefined();
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      for (const [label, keyChar, model, expectedName] of [
        [
          'Paid A',
          'a',
          { id: 'claude-paid', name: 'Claude Paid' },
          'Claude Paid · Claude and GPT models',
        ],
        ['Paid B', 'b', { id: 'gpt-paid', name: 'GPT Paid' }, 'GPT Paid · Claude and GPT models'],
        ['Gemini', 'c', { id: 'gemini-paid', name: 'Gemini Paid' }, 'Gemini Paid · Gemini Models'],
        [
          'Already labelled',
          'e',
          { id: 'gpt-labelled', name: 'GPT · Claude and GPT models' },
          'GPT · Claude and GPT models',
        ],
        ['Other', 'f', { id: 'other-model', name: 'Other Model' }, 'Other Model'],
        [
          'Long name',
          'g',
          { id: 'gpt-long', name: 'X'.repeat(256) },
          `${'X'.repeat(232)} · Claude and GPT models`,
        ],
      ] as const) {
        event = deferred();
        const token = `AIzaSyA${keyChar.repeat(28)}`;
        const created = await req(s.app, 'POST', path, { label, token });
        expect(created.status).toBe(201);
        const { id, enabled } = (await created.json()) as { id: string; enabled: boolean };
        expect(enabled).toBe(keyChar === 'a');
        const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
        const dispatch = await Promise.race([event.promise, pending.then(() => null)]);
        expect(dispatch).not.toBeNull();
        if (dispatch === null) throw new Error('No probe dispatched');
        expect(Object.keys(dispatch).sort()).toEqual(['requestId', 'type']);
        const { requestId } = dispatch;
        const claim = { phase: 'claim', connectionId };
        const result = {
          phase: 'result',
          connectionId,
          result: { status: 'ok', models: [model, model, { id: 'echo', name: token }] },
        };
        expect((await probeRequest(s, requestId, otherRunner.token, claim)).status).toBe(404);
        const stale = await probeRequest(s, requestId, runner.token, {
          ...claim,
          connectionId: 'stale',
        });
        expect(stale.status).toBe(404);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(404);
        const credential = await probeRequest(s, requestId, runner.token, claim);
        expect(credential.status).toBe(200);
        expect(credential.headers.get('cache-control')).toBe('no-store');
        expect(await credential.json()).toEqual({ token });
        expect((await probeRequest(s, requestId, runner.token, claim)).status).toBe(404);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(200);
        expect((await probeRequest(s, requestId, runner.token, result)).status).toBe(404);
        const response = await pending;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          status: 'ok',
          models: [{ ...model, name: expectedName }],
        });
      }
    },
  );

  test.each(['signed-out host account', 'no active account'] as const)(
    'uses the selected API key with %s',
    async (active) => {
      const s = bootServer();
      const runner = await enrollProbeRunner(s, 'signed-out-runner', false);
      seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: runner.machineId,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const hostResponse = await req(s.app, 'POST', path, { label: 'Host account' });
      expect(hostResponse.status).toBe(201);
      const host = (await hostResponse.json()) as { id: string; enabled: boolean };
      const token = `AIzaSyA${'k'.repeat(28)}`;
      const selectedResponse = await req(s.app, 'POST', path, { label: 'Selected API key', token });
      expect(selectedResponse.status).toBe(201);
      const selected = (await selectedResponse.json()) as { id: string; enabled: boolean };
      expect(host.enabled).toBe(true);
      expect(selected.enabled).toBe(false);
      const disableHost = async () => {
        expect((await req(s.app, 'POST', `${path}/${host.id}/disable`)).status).toBe(200);
      };
      if (active === 'no active account') await disableHost();

      const dispatched = deferred<string>();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
          if (event.type === 'antigravity.models') dispatched.resolve(event.requestId);
        }),
      );
      const pending = req(s.app, 'POST', `${path}/${selected.id}/upstream-models`);
      const requestId = await Promise.race([dispatched.promise, pending.then(() => null)]);
      expect(
        requestId,
        'The selected API key should not need another account’s login',
      ).not.toBeNull();
      if (requestId === null) throw new Error('No probe dispatched');
      const connectionId = s.machineHub.connectionId(runner.machineId);
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId,
      });
      expect(claim.status).toBe(200);
      expect(await claim.json()).toEqual({ token });
      if (active === 'signed-out host account') await disableHost();
      const models = [{ id: 'fixture-model', name: 'Selected model' }];
      const result = await probeRequest(s, requestId, runner.token, {
        phase: 'result',
        connectionId,
        result: { status: 'ok', models },
      });
      expect(result.status).toBe(200);
      expect(await (await pending).json()).toEqual({ status: 'ok', models });
    },
  );

  test.each([1, 2])(
    'overlapping lookups return each account’s own catalog with %i Runner(s)',
    async (count) => {
      const s = bootServer();
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const createAccount = async (suffix: string) => {
        const token = `AIzaSyA${suffix.repeat(29)}`;
        const response = await req(s.app, 'POST', path, { label: `Account ${suffix}`, token });
        expect(response.status).toBe(201);
        const { id } = (await response.json()) as { id: string };
        return { id, token, models: [{ id: `fixture-${suffix}`, name: `Model ${suffix}` }] };
      };
      const first = await createAccount('a');
      const second = await createAccount('b');
      const runners = [await enrollProbeRunner(s, 'primary')];
      if (count === 2) runners.push(await enrollProbeRunner(s, 'backup'));
      runners.sort((a, b) => (a.machineId < b.machineId ? -1 : 1));
      const events = runners.map(() => [deferred<string>(), deferred<string>()] as const);
      for (const [index, runner] of runners.entries()) {
        seedRoute(s, index === 0 ? 'session' : 'review', {
          provider: 'antigravity',
          modelId: 'gemini-4-carbon',
          machineId: runner.machineId,
        });
        let eventIndex = 0;
        disposables.push(
          s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
            if (event.type === 'antigravity.models')
              events[index]?.[eventIndex++]?.resolve(event.requestId);
          }),
        );
      }
      const start = (account: typeof first) =>
        req(s.app, 'POST', `${path}/${account.id}/upstream-models`);
      const claim = async (
        runnerIndex: number,
        eventIndex: 0 | 1,
        pending: Promise<Response>,
        token: string,
      ) => {
        const runner = runners[runnerIndex]!;
        const requestId = await Promise.race([
          events[runnerIndex]![eventIndex].promise,
          pending.then(() => null),
        ]);
        expect(requestId, 'The lookup returned without dispatching its probe').not.toBeNull();
        if (requestId === null) throw new Error('No probe dispatched');
        const connectionId = s.machineHub.connectionId(runner.machineId);
        const response = await probeRequest(s, requestId, runner.token, {
          phase: 'claim',
          connectionId,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ token });
        return async (models: typeof first.models) => {
          const result = await probeRequest(s, requestId, runner.token, {
            phase: 'result',
            connectionId,
            result: { status: 'ok', models },
          });
          expect(result.status).toBe(200);
          expect(await (await pending).json()).toEqual({ status: 'ok', models });
        };
      };
      const finishFirst = await claim(0, 0, start(first), first.token);
      const pendingSecond = start(second);
      if (count === 2) {
        const finishSecond = await claim(1, 0, pendingSecond, second.token);
        await finishSecond(second.models);
        await finishFirst(first.models);
      } else {
        const beforeFirstFinished = await Promise.race([
          events[0]![1].promise.then(() => 'dispatched'),
          pendingSecond.then(() => 'returned'),
          new Promise<string>((resolve) => setImmediate(() => resolve('waiting'))),
        ]);
        expect(beforeFirstFinished).toBe('waiting');
        await finishFirst(first.models);
        const finishSecond = await claim(0, 1, pendingSecond, second.token);
        await finishSecond(second.models);
      }
    },
  );

  test.each(['deleted', 'route-changed', 'runner-retired', 'default-changed'] as const)(
    'rechecks %s authorization before releasing a pending probe credential',
    async (change) => {
      const s = bootServer();
      disposables.push(() => s.dispose());
      const runner = await enrollProbeRunner(s, 'changing-runner');
      const nextDefault =
        change === 'default-changed' ? await enrollProbeRunner(s, 'next-default') : null;
      if (nextDefault !== null) {
        s.db
          .update(team)
          .set({ defaultMachineId: runner.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      const ruleId = seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: nextDefault === null ? runner.machineId : null,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const created = await req(s.app, 'POST', path, {
        label: 'Changing',
        token: `AIzaSyA${'h'.repeat(28)}`,
      });
      const { id } = (await created.json()) as { id: string };
      const event = deferred<string>();
      const controller = new AbortController();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') event.resolve(message.requestId);
        }),
      );
      const pending = s.app.request(`${path}/${id}/upstream-models`, {
        method: 'POST',
        signal: controller.signal,
      });
      const requestId = await Promise.race([
        event.promise,
        Promise.resolve(pending).then(() => null),
      ]);
      if (requestId === null) throw new Error('No probe dispatched');
      if (change === 'deleted')
        expect((await req(s.app, 'DELETE', `${path}/${id}`)).status).toBe(204);
      if (change === 'route-changed')
        s.db.update(routingRule).set({ provider: 'devin' }).where(eq(routingRule.id, ruleId)).run();
      if (change === 'runner-retired')
        s.db
          .update(machineTable)
          .set({ retiredAt: 1 })
          .where(eq(machineTable.id, runner.machineId))
          .run();
      if (nextDefault !== null) {
        s.db
          .update(team)
          .set({ defaultMachineId: nextDefault.machineId })
          .where(eq(team.id, s.team.id))
          .run();
      }
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId: s.machineHub.connectionId(runner.machineId),
      });
      controller.abort();
      await pending;
      expect(claim.status).toBe(404);
    },
  );

  test.each(['ok', 'failed'] as const)(
    'rejects a Runner %s result if the routing rule changed after claim',
    async (status) => {
      const s = bootServer();
      const runner = await enrollProbeRunner(s, 'revoked-after-claim');
      const ruleId = seedRoute(s, 'session', {
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        machineId: runner.machineId,
      });
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const token = `AIzaSyA${'j'.repeat(28)}`;
      const created = await req(s.app, 'POST', path, { label: 'Probe account', token });
      const { id } = (await created.json()) as { id: string };
      const dispatched = deferred<string>();
      disposables.push(
        s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
          if (message.type === 'antigravity.models') dispatched.resolve(message.requestId);
        }),
      );
      const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
      const requestId = await Promise.race([dispatched.promise, pending.then(() => null)]);
      if (requestId === null) throw new Error('No probe dispatched');
      const connectionId = s.machineHub.connectionId(runner.machineId);
      const claim = await probeRequest(s, requestId, runner.token, {
        phase: 'claim',
        connectionId,
      });
      expect(await claim.json()).toEqual({ token });
      s.db
        .update(routingRule)
        .set(status === 'ok' ? { modelId: 'gemini-4-argon' } : { provider: 'devin' })
        .where(eq(routingRule.id, ruleId))
        .run();
      const responseBody = {
        phase: 'result',
        connectionId,
        result:
          status === 'ok'
            ? { status, models: [{ id: 'claimed-model', name: 'Claimed model' }] }
            : { status, failure: 'upstream' },
      };
      const result = await probeRequest(s, requestId, runner.token, responseBody);
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({ code: 'probe-authorization-changed' });
      expect((await probeRequest(s, requestId, runner.token, responseBody)).status).toBe(404);
      expect(await (await pending).json()).toMatchObject({ status: 'fallback', failure: 'auth' });
    },
  );

  test('disconnecting a probe returns the labelled fallback and invalidates the request', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    const runner = await enrollProbeRunner(s, 'disconnecting-runner');
    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: runner.machineId,
    });
    const request = deferred<string>();
    disposables.push(
      s.machineHub.subscribeMachine(s.team.id, runner.machineId, (message) => {
        if (message.type === 'antigravity.models') request.resolve(message.requestId);
      }),
    );
    const connectionId = s.machineHub.connectionId(runner.machineId);
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Disconnect',
      token: `AIzaSyA${'d'.repeat(28)}`,
    });
    const { id } = (await created.json()) as { id: string };
    const pending = req(s.app, 'POST', `${path}/${id}/upstream-models`);
    const requestId = await Promise.race([request.promise, pending.then(() => null)]);
    if (requestId === null) throw new Error('No probe dispatched');
    s.machineHub.releaseMachine(runner.machineId);
    const late = await probeRequest(s, requestId, runner.token, { phase: 'claim', connectionId });
    expect(late.status).toBe(404);
    expect(await (await pending).json()).toMatchObject({
      status: 'fallback',
      failure: 'not-found',
    });
  });
  test('falls back rather than returning the runner login single-model list for a token subscription', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-personal-login',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Paid subscription',
      token: `AIzaSyA${'p'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'fallback',
      failure: 'not-found',
      httpStatus: null,
      models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
    });

    const rateLimited = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(rateLimited.status).toBe(429);
  });

  test('labels the built-in list as fallback for no probe runner or no stored credential', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'plain-box',
      capabilities: { mcpServers: [], skills: [] },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Token without runner',
      token: `AIzaSyA${'q'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'fallback',
      failure: 'not-found',
      models: expect.arrayContaining([{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }]),
    });
    insertMachine(s, {
      name: 'agy-signed-out',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    const second = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Second',
    });
    const other = (await second.json()) as { id: string };
    const signedOut = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${other.id}/upstream-models`,
    );
    expect(await signedOut.json()).toMatchObject({ status: 'fallback', failure: 'auth' });
  });

  test('stores a curated model subset and offers it in model sources', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
          ],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Curated',
    });
    const sub = (await created.json()) as { id: string; enabled: boolean };
    expect(sub.enabled).toBe(true);

    const patched = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
      {
        models: [
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        ],
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      ],
    });

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId: 'machine-agy-mac',
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', slot: 'builtin' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon', slot: 'builtin' },
      ],
    });
  });

  test('an offline antigravity-capable Runner still contributes its model source', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'agy-asleep',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, machineId)).run();
    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-asleep',
      machineId,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' }],
    });
  });
});
