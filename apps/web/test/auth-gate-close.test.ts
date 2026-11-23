import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

const SESSION = '/api/auth/session';
const ACCESS = '/api/auth/access';
const DESCRIPTOR = '/api/remote/descriptor';
const PAIR = '/api/remote/pair';
const PROJECTS = '/api/projects';
const TEAMS = '/api/teams';
const POLL = '/api/machine/enroll/poll';

let auth: typeof import('../src/api/auth.js');
let client: typeof import('../src/api/client.js');
let gate: typeof import('../src/overlay/token-gate.js');
let i18n: typeof import('../src/i18n/provider.js');

beforeEach(async () => {
  vi.resetModules();
  auth = await import('../src/api/auth.js');
  client = await import('../src/api/client.js');
  gate = await import('../src/overlay/token-gate.js');
  i18n = await import('../src/i18n/provider.js');
  browser();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function browser(fragment = '', origin = 'http://localhost') {
  const history = { replaceState: vi.fn() };
  vi.stubGlobal('window', { location: new URL(`${origin}/app?tab=projects${fragment}`), history });
  vi.stubGlobal('navigator', {});
  return history;
}

function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function authenticated() {
  return new Response(null, { status: 204 });
}

function redirected(response: Response) {
  Object.defineProperty(response, 'redirected', { value: true });
  return response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function transport(routes: Record<string, () => Response | Promise<Response>>) {
  const fetch = vi.fn(async (path: string, _init?: RequestInit) => {
    const route = routes[path];
    if (route === undefined) throw new Error(`Unexpected request: ${path}`);
    return route();
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, calls: () => fetch.mock.calls.map(([path]) => path) };
}

function descriptor() {
  return Response.json({ environmentId: 'test-env' });
}

function request(path: string) {
  return client.api.get(path).catch((error: unknown) => error);
}

function turn() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function form() {
  return renderToStaticMarkup(
    createElement(i18n.I18nProvider, { initialLocale: 'en', children: createElement(gate.TokenGate) }),
  );
}

describe('the sign-in gate', () => {
  it('consumes a pairing link and closes only after the fresh session probe', async () => {
    const history = browser('#pair=link-code&env=test-env');
    const redemption = deferred<Response>();
    const probe = deferred<Response>();
    const { fetch, calls } = transport({
      [DESCRIPTOR]: descriptor,
      [PAIR]: () => redemption.promise,
      [PROJECTS]: () => Response.json([]),
      [SESSION]: () => probe.promise,
    });
    const pairing = auth.consumePairFragment();
    await vi.waitFor(() => expect(calls()).toContain(PAIR), { timeout: 250 });
    const duplicate = auth.redeemPairingCode('manual-code');

    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/app?tab=projects');
    expect(duplicate).toBe(pairing);
    expect(form()).toContain('Pairing…');
    expect(form()).not.toMatch(/<input[^>]* readonly=""/i);
    await expect(request(PROJECTS)).resolves.toEqual([]);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: true });

    redemption.resolve(descriptor());
    await vi.waitFor(() => expect(calls()).toContain(SESSION), { timeout: 250 });
    expect(fetch).toHaveBeenCalledWith(SESSION, {
      cache: 'no-store',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      headers: { 'x-cairn-browser-auth': '1' },
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenCalledWith(
      PAIR,
      expect.objectContaining({
        headers: { 'content-type': 'application/json', 'x-cairn-browser-auth': '1' },
        body: JSON.stringify({ code: 'link-code', name: 'Browser', environmentId: 'test-env' }),
      }),
    );
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false, retrying: true });
    expect(form()).toContain('Connecting…');
    probe.resolve(authenticated());
    await expect(pairing).resolves.toBe(true);
    expect(calls().filter((path) => path === PAIR)).toHaveLength(1);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: false, rejected: false, pairing: false });
    expect(form()).toBe('');
  });

  it('shows the gate for an expired cookie, fails the request, and can pair again', async () => {
    let hasCookie = true;
    const { fetch, calls } = transport({
      [PROJECTS]: () => (hasCookie ? Response.json([]) : unauthorized()),
      [SESSION]: () => (hasCookie ? authenticated() : unauthorized()),
      [PAIR]: () => {
        hasCookie = true;
        return descriptor();
      },
    });
    await expect(request(PROJECTS)).resolves.toEqual([]);
    expect(calls()).toEqual([PROJECTS]);

    hasCookie = false;
    const expired = request(PROJECTS);
    await vi.waitFor(() => expect(calls()).toContain(SESSION), { timeout: 250 });
    await expect(expired).resolves.toMatchObject({ status: 401 });
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, rejected: false });
    expect(calls()).toEqual([PROJECTS, PROJECTS, SESSION]);
    expect(fetch).toHaveBeenCalledWith(PROJECTS, expect.objectContaining({ cache: 'no-cache' }));

    await expect(auth.redeemPairingCode('manual-code')).resolves.toBe(true);
    expect(auth.authSnapshot().gateOpen).toBe(false);
    await expect(request(PROJECTS)).resolves.toEqual([]);
    expect(calls()).toEqual([PROJECTS, PROJECTS, SESSION, PAIR, SESSION, PROJECTS]);
  });

  it('refetches an active page query that failed before the user paired', async () => {
    const { refreshQueriesOnGateClose } = await import('../src/api/invalidate.js');
    const key = ['projects'];
    let hasCookie = false;
    transport({
      [PROJECTS]: () => (hasCookie ? Response.json([]) : unauthorized()),
      [SESSION]: () => (hasCookie ? authenticated() : unauthorized()),
      [PAIR]: () => {
        hasCookie = true;
        return descriptor();
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stopWatching = refreshQueriesOnGateClose(queryClient);
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => client.api.get(PROJECTS),
    });
    const stopObserving = observer.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(queryClient.getQueryState(key)?.error).toMatchObject({ status: 401 }));
      await expect(auth.redeemPairingCode('test-code')).resolves.toBe(true);
      await vi.waitFor(() => expect(queryClient.getQueryData(key)).toEqual([]));
    } finally {
      stopObserving();
      stopWatching();
    }
  });

  it('makes concurrent 401s wait for one probe and retry once each', async () => {
    const probe = deferred<Response>();
    let projectCalls = 0;
    let teamCalls = 0;
    const { calls } = transport({
      [PROJECTS]: () => (projectCalls++ === 0 ? unauthorized() : Response.json({ path: PROJECTS })),
      [TEAMS]: () => (teamCalls++ === 0 ? unauthorized() : Response.json({ path: TEAMS })),
      [SESSION]: () => probe.promise,
    });
    const projects = request(PROJECTS);
    const teams = request(TEAMS);
    await turn();
    expect(calls()).toEqual([PROJECTS, TEAMS, SESSION]);
    probe.resolve(authenticated());
    await expect(projects).resolves.toEqual({ path: PROJECTS });
    await expect(teams).resolves.toEqual({ path: TEAMS });
    expect(calls()).toEqual([PROJECTS, TEAMS, SESSION, PROJECTS, TEAMS]);
  });

  it.each(['before', 'after'] as const)(
    'does not use an older 200 that arrives %s a newer 401 to decide the gate',
    async (arrival) => {
      const older = deferred<Response>();
      const newer = deferred<Response>();
      const probe = deferred<Response>();
      const { calls } = transport({
        [PROJECTS]: () => older.promise,
        [TEAMS]: () => newer.promise,
        [SESSION]: () => probe.promise,
      });
      const startup = request(PROJECTS);
      const rejected = request(TEAMS);
      if (arrival === 'before') {
        older.resolve(Response.json([]));
        await expect(startup).resolves.toEqual([]);
      }
      newer.resolve(unauthorized());
      await turn();
      expect(calls()).toEqual([PROJECTS, TEAMS, SESSION]);
      expect(auth.authSnapshot().gateOpen).toBe(false);

      probe.resolve(unauthorized());
      await expect(rejected).resolves.toMatchObject({ status: 401 });
      expect(auth.authSnapshot().gateOpen).toBe(true);
      if (arrival === 'after') {
        older.resolve(Response.json([]));
        await expect(startup).resolves.toEqual([]);
      }
      expect(auth.authSnapshot().gateOpen).toBe(true);
      expect(calls()).toEqual([PROJECTS, TEAMS, SESSION]);
    },
  );

  it.each([
    { label: 'existing cookie is valid', verdict: authenticated, gateOpen: false },
    { label: 'no usable cookie remains', verdict: unauthorized, gateOpen: true },
  ])('probes after redemption fails when $label and unblocks pending callers', async ({ verdict, gateOpen }) => {
    browser('#pair=expired-code&env=test-env');
    const redemption = deferred<Response>();
    const probe = deferred<Response>();
    let projectCalls = 0;
    const { calls } = transport({
      [DESCRIPTOR]: descriptor,
      [PAIR]: () => redemption.promise,
      [PROJECTS]: () => (projectCalls++ === 0 ? unauthorized() : Response.json([])),
      [SESSION]: () => probe.promise,
    });
    const pending = request(PROJECTS);
    await vi.waitFor(() => expect(calls()).toContain(PAIR), { timeout: 250 });
    expect(calls()).not.toContain(SESSION);
    const pairing = auth.redeemPairingCode('duplicate');

    redemption.resolve(unauthorized());
    await vi.waitFor(() => expect(calls()).toContain(SESSION), { timeout: 250 });
    expect(projectCalls).toBe(1);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false });
    probe.resolve(verdict());
    await expect(pairing).resolves.toBe(!gateOpen);
    if (gateOpen) await expect(pending).resolves.toMatchObject({ status: 401 });
    else await expect(pending).resolves.toEqual([]);
    expect(projectCalls).toBe(gateOpen ? 1 : 2);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen, pairing: false, rejected: gateOpen });
  });

  it('keeps the gate open when a successful redemption does not leave a usable cookie', async () => {
    const { calls } = transport({ [PAIR]: descriptor, [SESSION]: unauthorized });
    await expect(auth.redeemPairingCode('test-code')).resolves.toBe(false);
    expect(calls()).toEqual([PAIR, SESSION]);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, rejected: true, pairing: false });
  });

  it.each([
    ['unavailable', () => Response.error()],
    ['for a different environment', descriptor],
  ] as const)('probes without redeeming a link when its descriptor is %s', async (_label, getDescriptor) => {
    browser('#pair=link-code&env=expected-env');
    const { calls } = transport({ [DESCRIPTOR]: getDescriptor, [SESSION]: authenticated });
    await expect(auth.consumePairFragment()).resolves.toBe(true);
    expect(calls()).toEqual([DESCRIPTOR, SESSION]);
    expect(auth.authSnapshot().gateOpen).toBe(false);
  });

  it.each(['response', 'body'] as const)(
    'shares one five-second deadline with the descriptor %s',
    async (step) => {
      vi.useFakeTimers();
      browser('#pair=link-code&env=test-env');
      const headers = deferred<Response>();
      const body = deferred<{ environmentId: string }>();
      const response = descriptor();
      const read = vi.spyOn(response, 'json').mockReturnValue(body.promise);
      const { calls, fetch } = transport({
        [DESCRIPTOR]: () => headers.promise,
        [PAIR]: descriptor,
        [PROJECTS]: unauthorized,
        [SESSION]: unauthorized,
      });
      const pending = request(PROJECTS);
      await vi.advanceTimersByTimeAsync(4_000);
      if (step === 'body') {
        headers.resolve(response);
        await vi.advanceTimersByTimeAsync(0);
        expect(read).toHaveBeenCalledOnce();
      }
      const signal = fetch.mock.calls.find(([path]) => path === DESCRIPTOR)?.[1]?.signal;
      await vi.advanceTimersByTimeAsync(999);
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR]);
      expect(signal?.aborted).not.toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect.soft(signal?.aborted).toBe(true);
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR, SESSION]);
      await expect(pending).resolves.toMatchObject({ status: 401 });
      expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false, retrying: false });

      headers.resolve(response);
      body.resolve({ environmentId: 'test-env' });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR, SESSION]);
    },
  );

  it.each(['response', 'body'] as const)(
    'lets manual entry abort a stalled descriptor %s and hands off ordinary 401s',
    async (step) => {
      browser('#pair=link-code&env=test-env');
      const headers = deferred<Response>();
      const body = deferred<{ environmentId: string }>();
      const response = descriptor();
      const read = vi.spyOn(response, 'json').mockReturnValue(body.promise);
      const probe = deferred<Response>();
      let paired = false;
      const { calls, fetch } = transport({
        [DESCRIPTOR]: () => (step === 'response' ? headers.promise : response),
        [PROJECTS]: () => (paired ? Response.json([]) : unauthorized()),
        [TEAMS]: () => (paired ? Response.json([]) : unauthorized()),
        [PAIR]: descriptor,
        [SESSION]: () => probe.promise,
      });
      const waiting = request(PROJECTS);
      await turn();
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR]);
      expect(read).toHaveBeenCalledTimes(step === 'body' ? 1 : 0);
      const signal = fetch.mock.calls.at(-1)?.[1]?.signal;
      expect.soft(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false });
      expect.soft(form()).not.toContain('Pairing…');

      const manual = auth.redeemPairingCode('manual-code');
      await turn();
      expect.soft(signal?.aborted).toBe(true);
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR, PAIR, SESSION]);
      expect(fetch).toHaveBeenCalledWith(
        PAIR,
        expect.objectContaining({ body: JSON.stringify({ code: 'manual-code', name: 'Browser' }) }),
      );
      const joining = request(TEAMS);
      await turn();
      expect(calls()).toEqual([PROJECTS, DESCRIPTOR, PAIR, SESSION, TEAMS]);
      paired = true;
      probe.resolve(authenticated());
      await expect(Promise.all([manual, waiting, joining])).resolves.toEqual([true, [], []]);
      const completedCalls = calls();
      expect(completedCalls.slice(-2).sort()).toEqual([PROJECTS, TEAMS]);
      const confirmed = auth.authSnapshot();
      expect(confirmed.gateOpen).toBe(false);

      headers.resolve(response);
      body.resolve({ environmentId: 'test-env' });
      await turn();
      expect(calls()).toEqual(completedCalls);
      expect(auth.authSnapshot()).toBe(confirmed);
    },
  );

  it.each(['probe', 'Access exchange', 'Access confirmation'])(
    'redeems immediately during a stalled %s and ignores its late response',
    async (step) => {
      browser('', 'https://app.example.com');
      const stale = deferred<Response>();
      const freshProbe = deferred<Response>();
      let probes = 0;
      let requests = 0;
      const { calls, fetch } = transport({
        [PROJECTS]: () => (requests++ === 0 ? unauthorized() : Response.json([])),
        [SESSION]: () => {
          ++probes;
          if (step === 'probe' && probes === 1) return stale.promise;
          if (probes === 1) return unauthorized();
          if (step === 'Access confirmation' && probes === 2) return stale.promise;
          return freshProbe.promise;
        },
        [ACCESS]: () => (step === 'Access exchange' ? stale.promise : Response.json({ ok: true })),
        [PAIR]: descriptor,
      });
      const pending = request(PROJECTS);
      await turn();
      const backgroundCalls = [PROJECTS, SESSION];
      if (step !== 'probe') backgroundCalls.push(ACCESS);
      if (step === 'Access confirmation') backgroundCalls.push(SESSION);
      expect(calls()).toEqual(backgroundCalls);
      const signal = fetch.mock.calls.at(-1)?.[1]?.signal;

      const pairing = auth.redeemPairingCode('test-code');
      await turn();
      const pairingCalls = [...backgroundCalls, PAIR, SESSION];
      expect(calls()).toEqual(pairingCalls);
      expect(signal?.aborted).toBe(true);
      expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false });

      freshProbe.resolve(authenticated());
      await expect(pairing).resolves.toBe(true);
      await expect(pending).resolves.toEqual([]);
      const confirmed = auth.authSnapshot();
      expect(confirmed).toMatchObject({ gateOpen: false, pairing: false });

      stale.resolve(step === 'Access exchange' ? Response.json({ ok: true }) : unauthorized());
      await turn();
      expect(calls()).toEqual([...pairingCalls, PROJECTS]);
      expect(auth.authSnapshot()).toBe(confirmed);
    },
  );

  it.each([SESSION, ACCESS])('aborts a stalled %s at its deadline', async (endpoint) => {
    vi.useFakeTimers();
    browser('', endpoint === SESSION ? 'http://localhost' : 'https://app.example.com');
    const stalled = deferred<Response>();
    let probes = 0;
    const { fetch } = transport({
      [PROJECTS]: unauthorized,
      [SESSION]: () => (endpoint === SESSION && ++probes === 1 ? stalled.promise : unauthorized()),
      [ACCESS]: () => stalled.promise,
    });
    const pending = request(PROJECTS);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(endpoint);
    const signal = fetch.mock.calls.at(-1)?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).not.toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    if (endpoint === SESSION) {
      expect(form()).toContain('Connecting…');
      stalled.resolve(authenticated());
      await vi.advanceTimersByTimeAsync(250);
      expect(probes).toBe(2);
    }
    await expect(pending).resolves.toMatchObject({ status: 401 });
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, retrying: false });
  });

  it('awaits the probe on a retry 401 but never sends a third request', async () => {
    const retryProbe = deferred<Response>();
    let probes = 0;
    const { calls } = transport({
      [PROJECTS]: unauthorized,
      [SESSION]: () => (probes++ === 0 ? authenticated() : retryProbe.promise),
    });
    let settled = false;
    const pending = request(PROJECTS).then((result) => {
      settled = true;
      return result;
    });
    await turn();
    expect(calls()).toEqual([PROJECTS, SESSION, PROJECTS, SESSION]);
    expect(settled).toBe(false);
    expect(auth.authSnapshot().gateOpen).toBe(false);
    retryProbe.resolve(unauthorized());
    await expect(pending).resolves.toMatchObject({ status: 401 });
    expect(calls()).toEqual([PROJECTS, SESSION, PROJECTS, SESSION]);
    expect(auth.authSnapshot().gateOpen).toBe(true);
  });

  it('returns a redirected 401 without probing or affecting genuine session confirmation', async () => {
    const probe = deferred<Response>();
    const { calls } = transport({
      [PROJECTS]: unauthorized,
      [TEAMS]: () => redirected(unauthorized()),
      [SESSION]: () => probe.promise,
    });
    const redirectedRequest = request(TEAMS);
    await turn();
    expect(calls()).toEqual([TEAMS]);
    await expect(redirectedRequest).resolves.toMatchObject({ status: 401 });
    const pending = request(PROJECTS);
    await turn();
    await expect(request(TEAMS)).resolves.toMatchObject({ status: 401 });
    expect(calls()).toEqual([TEAMS, PROJECTS, SESSION, TEAMS]);
    probe.resolve(unauthorized());
    await expect(pending).resolves.toMatchObject({ status: 401 });
    expect(auth.authSnapshot().gateOpen).toBe(true);
  });

  it.each([204, 401])('retries a redirected probe returning %s without accepting its verdict', async (status) => {
    vi.useFakeTimers();
    let requests = 0;
    let probes = 0;
    const { calls } = transport({
      [PROJECTS]: () => (requests++ === 0 ? unauthorized() : Response.json([])),
      [SESSION]: () => (++probes === 1 ? redirected(new Response(null, { status })) : authenticated()),
    });
    const pending = request(PROJECTS);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toEqual([PROJECTS, SESSION]);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, retrying: true, rejected: false });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual([]);
    expect(calls()).toEqual([PROJECTS, SESSION, SESSION, PROJECTS]);
    expect(form()).toBe('');
  });

  it.each([204, 401])('backs off network errors until a definite %s', async (status) => {
    vi.useFakeTimers();
    let probes = 0;
    let projects = 0;
    let teams = 0;
    const { calls } = transport({
      [PROJECTS]: () => (++projects === 1 ? unauthorized() : Response.json([])),
      [TEAMS]: () => (++teams === 1 ? unauthorized() : Response.json([])),
      [SESSION]: () => {
        if (++probes === 7) return new Response(null, { status });
        if (probes === 2) return new Response(null, { status: 503 });
        throw new TypeError('Network unavailable');
      },
    });
    const pending = request(PROJECTS);
    const alsoPending = request(TEAMS);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toEqual([PROJECTS, TEAMS, SESSION]);
    expect(form()).toMatch(/role="status"[^>]*>Connecting…/);
    expect(form()).not.toMatch(/<input[^>]* readonly=""/i);
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false, rejected: false });

    for (const delay of [250, 500, 1_000, 2_000, 4_000, 4_000]) {
      const before = probes;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(probes).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(probes).toBe(before + 1);
    }
    if (status === 204) await expect(Promise.all([pending, alsoPending])).resolves.toEqual([[], []]);
    else {
      await expect(pending).resolves.toMatchObject({ status: 401 });
      await expect(alsoPending).resolves.toMatchObject({ status: 401 });
    }
    expect(auth.authSnapshot()).toMatchObject({
      gateOpen: status === 401,
      retrying: false,
      rejected: false,
    });
    expect(form()).not.toContain('Connecting…');
  });

  it('lets pairing cancel a scheduled retry and recover after its own probe loses the network', async () => {
    vi.useFakeTimers();
    let probes = 0;
    let projects = 0;
    const { calls } = transport({
      [PROJECTS]: () => (++projects === 1 ? unauthorized() : Response.json([])),
      [SESSION]: () => {
        if (++probes === 3) return authenticated();
        throw new TypeError('Network unavailable');
      },
      [PAIR]: unauthorized,
    });
    const pending = request(PROJECTS);
    await vi.advanceTimersByTimeAsync(100);
    expect(form()).toContain('Connecting…');
    const pairing = auth.redeemPairingCode('test-code');
    await vi.advanceTimersByTimeAsync(0);
    const pairingCalls = [PROJECTS, SESSION, PAIR, SESSION];
    expect(calls()).toEqual(pairingCalls);
    expect(form()).toContain('Connecting…');
    expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false, rejected: false });
    await vi.advanceTimersByTimeAsync(249);
    expect(calls()).toEqual(pairingCalls);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pairing).resolves.toBe(true);
    await expect(pending).resolves.toEqual([]);
    expect(calls()).toEqual([...pairingCalls, SESSION, PROJECTS]);
    expect(form()).toBe('');
  });

  it.each(['pending probe', 'retry delay'] as const)(
    'keeps the form editable and lets a new code supersede a %s',
    async (phase) => {
      vi.useFakeTimers();
      const stale = deferred<Response>();
      const fresh = deferred<Response>();
      let probes = 0;
      let projects = 0;
      let teams = 0;
      const { calls, fetch } = transport({
        [PAIR]: descriptor,
        [PROJECTS]: () => (++projects === 1 ? unauthorized() : Response.json([])),
        [TEAMS]: () => (++teams === 1 ? unauthorized() : Response.json([])),
        [SESSION]: () => {
          if (++probes > 1) return fresh.promise;
          return phase === 'pending probe' ? stale.promise : Response.error();
        },
      });
      const first = auth.redeemPairingCode('first-code');
      await vi.advanceTimersByTimeAsync(0);
      const oldSignal = fetch.mock.calls.at(-1)?.[1]?.signal;
      expect.soft(form()).toMatch(/role="status"[^>]*>Connecting…/);
      expect.soft(form()).not.toMatch(/<input[^>]* readonly=""/i);
      expect.soft(auth.authSnapshot()).toMatchObject({ gateOpen: true, pairing: false });

      const pending = request(PROJECTS);
      await vi.advanceTimersByTimeAsync(0);
      expect(probes).toBe(1);
      const second = auth.redeemPairingCode('replacement-code');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch.mock.calls.filter(([path]) => path === PAIR).map(([, init]) => init?.body)).toEqual([
        JSON.stringify({ code: 'first-code', name: 'Browser' }),
        JSON.stringify({ code: 'replacement-code', name: 'Browser' }),
      ]);
      expect(oldSignal?.aborted).toBe(phase === 'pending probe');
      expect(probes).toBe(2);
      const alsoPending = request(TEAMS);
      stale.resolve(unauthorized());
      await vi.advanceTimersByTimeAsync(250);
      expect(probes).toBe(2);
      expect(auth.authSnapshot()).toMatchObject({ gateOpen: true, retrying: true, rejected: false });
      expect(calls().filter((path) => path === PROJECTS || path === TEAMS)).toEqual([PROJECTS, TEAMS]);

      fresh.resolve(authenticated());
      await expect(Promise.all([first, second, pending, alsoPending])).resolves.toEqual([
        true,
        true,
        [],
        [],
      ]);
      expect(form()).toBe('');
    },
  );

  it('redeems a manually entered code without waiting for a descriptor', async () => {
    const stalled = deferred<Response>();
    const { calls } = transport({
      [DESCRIPTOR]: () => stalled.promise,
      [PAIR]: descriptor,
      [SESSION]: authenticated,
    });
    const pending = auth.redeemPairingCode('manual-code');
    await turn();
    expect(calls()).toEqual([PAIR, SESSION]);
    await expect(pending).resolves.toBe(true);
  });

  it('does not probe or wait for auth-exempt enrollment and cross-origin responses', async () => {
    const probe = deferred<Response>();
    const other = 'https://other.test/api/teams';
    const { calls } = transport({
      [PROJECTS]: unauthorized,
      [SESSION]: () => probe.promise,
      [POLL]: () => Response.json({ status: 'pending' }),
      [`${POLL}?failed=1`]: unauthorized,
      [other]: unauthorized,
    });
    const pending = request(PROJECTS);
    await turn();
    await expect(client.api.post(POLL)).resolves.toEqual({ status: 'pending' });
    await expect(client.api.post(`${POLL}?failed=1`)).rejects.toMatchObject({ status: 401 });
    await expect(request(other)).resolves.toMatchObject({ status: 401 });
    expect(calls()).toEqual([PROJECTS, SESSION, POLL, `${POLL}?failed=1`, other]);
    probe.resolve(unauthorized());
    await expect(pending).resolves.toMatchObject({ status: 401 });
  });
});
