import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEB_BRAVE_KEY_SECRET,
  WEB_EXA_KEY_SECRET,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_BUDGET_EXHAUSTED,
  WEB_SEARCH_TOOL_NAME,
  type WebToolOutput,
} from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildWebTools,
  EXA_BASE_URL_ENV,
  EXA_DEFAULT_BASE_URL,
  prepareWebTools,
} from '../src/backend/web-search.js';
import { pushCredential, type StepCredentials } from '../src/credentials.js';
import { buildSecretTool } from '../src/secret-channel.js';

const EXA_KEY = 'exa-test-key-0000000000000000';
const BRAVE_KEY = 'brave-test-key-111111111111111';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const PUBLIC_IP = '93.184.216.34';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

type Responder = (call: Call) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>;
}

let home: string;
let calls: Call[];
let logs: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-web-search-'));
  calls = [];
  logs = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function fakeFetch(responder: Responder): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
}

function tools(
  keys: { exa?: string; brave?: string },
  responder: Responder,
  extra: { env?: Record<string, string | undefined>; now?: () => Date } = {},
) {
  const built = buildWebTools({
    keys,
    stepId: 'step-1',
    home,
    log: (line) => logs.push(line),
    fetch: fakeFetch(responder),
    now: extra.now ?? (() => NOW),
    env: extra.env ?? {},
    lookup: async () => [PUBLIC_IP],
  });
  const byName = new Map(built.map((t) => [t.name, t]));
  return {
    names: built.map((t) => t.name),
    search: (params: Record<string, unknown>) => byName.get(WEB_SEARCH_TOOL_NAME)?.execute(params),
    fetch: (params: Record<string, unknown>) => byName.get(WEB_FETCH_TOOL_NAME)?.execute(params),
  };
}

function ledgerPath(): string {
  return join(home, 'web-search-spend.json');
}

function exaSearchBody(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      { url: 'https://a.example/1', title: 'A', text: 'alpha body', publishedDate: '2026-10-01' },
      { url: 'https://b.example/2', title: 'B', text: 'beta body' },
    ],
    costDollars: { total: 0.007 },
    ...overrides,
  };
}

describe('Exa mapping', () => {
  test('search posts to /search with x-api-key and maps results', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    const out = JSON.parse((await t.search({ query: 'sharding vitest' })) ?? '') as WebToolOutput;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.exa.ai/search');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(headersOf(calls[0])['x-api-key']).toBe(EXA_KEY);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.query).toBe('sharding vitest');
    expect(body.contents.text.maxCharacters).toBeGreaterThan(0);
    expect(out.provider).toBe('exa');
    expect(out.results).toEqual([
      { url: 'https://a.example/1', title: 'A', text: 'alpha body', fetchedAt: NOW.toISOString() },
      { url: 'https://b.example/2', title: 'B', text: 'beta body', fetchedAt: NOW.toISOString() },
    ]);
  });

  test('reported costDollars.total is recorded in the ledger', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    await t.search({ query: 'q' });
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.007, 6);
  });

  test('missing costDollars uses the fixed estimate of 0.005', async () => {
    const t = tools({ exa: EXA_KEY }, () => json({ results: [] }));
    await t.search({ query: 'q' });
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.005, 6);
  });

  test('web_fetch with an Exa key posts to /contents with the url', async () => {
    const t = tools({ exa: EXA_KEY }, () =>
      json({
        results: [{ url: 'https://a.example/x', title: 'X', text: 'page text' }],
        costDollars: { total: 0.001 },
      }),
    );
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/x' })) ?? '') as WebToolOutput;
    expect(calls[0]?.url).toBe('https://api.exa.ai/contents');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.urls).toEqual(['https://a.example/x']);
    expect(body.text.maxCharacters).toBeGreaterThan(0);
    expect(out.provider).toBe('exa');
    expect(out.results[0]?.text).toBe('page text');
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.001, 6);
  });
});

describe('Exa base url', () => {
  test('the default is the real Exa host', () => {
    expect(EXA_DEFAULT_BASE_URL).toBe('https://api.exa.ai');
  });

  test('the env override redirects search and contents', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()), {
      env: { [EXA_BASE_URL_ENV]: 'http://127.0.0.1:9999' },
    });
    await t.search({ query: 'q' });
    await t.fetch({ url: 'https://a.example/x' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:9999/search',
      'http://127.0.0.1:9999/contents',
    ]);
  });
});

describe('Brave mapping and fallback', () => {
  const braveBody = {
    web: {
      results: [
        { url: 'https://c.example/3', title: 'C', description: 'gamma snippet' },
        { url: 'https://d.example/4', title: 'D', description: 'delta snippet' },
      ],
    },
  };

  test('Brave-only key uses GET with X-Subscription-Token', async () => {
    const t = tools({ brave: BRAVE_KEY }, () => json(braveBody));
    const out = JSON.parse((await t.search({ query: 'a b' })) ?? '') as WebToolOutput;
    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(url.searchParams.get('q')).toBe('a b');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
    expect(headersOf(calls[0])['X-Subscription-Token']).toBe(BRAVE_KEY);
    expect(out.provider).toBe('brave');
    expect(out.results[0]).toEqual({
      url: 'https://c.example/3',
      title: 'C',
      text: 'gamma snippet',
      fetchedAt: NOW.toISOString(),
    });
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.005, 6);
  });

  test('Exa 5xx falls back to Brave once', async () => {
    const t = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, (c) =>
      c.url.startsWith('https://api.exa.ai') ? json({ error: 'boom' }, 503) : json(braveBody),
    );
    const out = JSON.parse((await t.search({ query: 'q' })) ?? '') as WebToolOutput;
    expect(out.provider).toBe('brave');
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['api.exa.ai', 'api.search.brave.com']);
  });

  test('Exa network error falls back to Brave', async () => {
    const t = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, (c) => {
      if (c.url.startsWith('https://api.exa.ai')) throw new Error('socket hang up');
      return json(braveBody);
    });
    const out = JSON.parse((await t.search({ query: 'q' })) ?? '') as WebToolOutput;
    expect(out.provider).toBe('brave');
  });

  test('Exa 4xx does not fall back and returns a clear error', async () => {
    const t = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, () => json({ error: 'bad' }, 401));
    const out = await t.search({ query: 'q' });
    expect(out).toContain('web_search failed');
    expect(out).toContain('401');
    expect(calls).toHaveLength(1);
  });

  test('both providers failing returns an error after exactly two calls', async () => {
    const t = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, () => json({}, 500));
    const out = await t.search({ query: 'q' });
    expect(out).toContain('web_search failed');
    expect(calls).toHaveLength(2);
  });
});

describe('tool availability', () => {
  test('no key: web_search absent, web_fetch present', () => {
    expect(tools({}, () => json({})).names).toEqual([WEB_FETCH_TOOL_NAME]);
  });

  test('any key: both tools present', () => {
    expect(tools({ brave: BRAVE_KEY }, () => json({})).names).toEqual([
      WEB_SEARCH_TOOL_NAME,
      WEB_FETCH_TOOL_NAME,
    ]);
  });

  function creds(): StepCredentials {
    return pushCredential(
      {
        provider: null,
        git: null,
        secrets: { [WEB_EXA_KEY_SECRET]: EXA_KEY, OTHER: 'other-value' },
      },
      null,
    );
  }

  function prepared(enabled: boolean, metered = true) {
    return prepareWebTools({
      enabled,
      metered,
      creds: creds(),
      stepId: 'step-1',
      home,
      log: (line) => logs.push(line),
    });
  }

  test('enabled (unlocked pi step) gives both tools when a key is granted', () => {
    expect(prepared(true).tools.map((t) => t.name)).toEqual([
      WEB_SEARCH_TOOL_NAME,
      WEB_FETCH_TOOL_NAME,
    ]);
  });

  test('not enabled (locked, remoteToolsOnly or non-pi) gives no tools', () => {
    expect(prepared(false).tools).toEqual([]);
  });

  test('unmetered (Orb) steps get only web_fetch and the key stays hidden', () => {
    const result = prepared(true, false);
    expect(result.tools.map((t) => t.name)).toEqual([WEB_FETCH_TOOL_NAME]);
    expect(result.secretCreds.secrets.names).not.toContain(WEB_EXA_KEY_SECRET);
    expect(result.secretCreds.secrets.take(WEB_EXA_KEY_SECRET)).toBeNull();
  });

  test('not enabled leaves the vault untouched', async () => {
    const result = prepared(false);
    expect(result.secretCreds.secrets.names).toContain(WEB_EXA_KEY_SECRET);
  });
});

describe('the key never reaches the agent', () => {
  test('get_secret through the filtered vault cannot read provider keys or list them', async () => {
    const credentials = pushCredential(
      {
        provider: null,
        git: null,
        secrets: {
          [WEB_EXA_KEY_SECRET]: EXA_KEY,
          [WEB_BRAVE_KEY_SECRET]: BRAVE_KEY,
          OTHER: 'other-value',
        },
      },
      null,
    );
    const { secretCreds } = prepareWebTools({
      enabled: true,
      metered: true,
      creds: credentials,
      stepId: 'step-1',
      home,
      log: () => undefined,
    });
    const getSecret = buildSecretTool({
      creds: secretCreds,
      stepId: 'step-1',
      agentId: null,
      onAudit: () => undefined,
    });
    for (const name of [WEB_EXA_KEY_SECRET, WEB_BRAVE_KEY_SECRET]) {
      const out = await getSecret.execute({ name });
      expect(out).not.toContain(EXA_KEY);
      expect(out).not.toContain(BRAVE_KEY);
      expect(out).toContain('granted: OTHER.');
    }
    expect(await getSecret.execute({ name: 'OTHER' })).toBe('other-value');
    expect(secretCreds.secrets.names).toEqual(['OTHER']);
  });

  test('the filtered view follows later credential clearing', async () => {
    const credentials = pushCredential(
      { provider: null, git: null, secrets: { OTHER: 'other-value' } },
      null,
    );
    const { secretCreds } = prepareWebTools({
      enabled: true,
      metered: true,
      creds: credentials,
      stepId: 'step-1',
      home,
      log: () => undefined,
    });
    credentials.secrets = { names: [], take: () => null };
    expect(secretCreds.secrets.take('OTHER')).toBeNull();
  });

  test('keys do not appear in outputs, errors or logs', async () => {
    const outputs: string[] = [];
    const ok = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, () => json(exaSearchBody()));
    outputs.push((await ok.search({ query: 'q' })) ?? '');
    const failing = tools({ exa: EXA_KEY, brave: BRAVE_KEY }, (c) => {
      throw new Error(`connect failed with header ${EXA_KEY} ${BRAVE_KEY} to ${c.url}`);
    });
    outputs.push((await failing.search({ query: 'q' })) ?? '');
    const echo = tools({ exa: EXA_KEY }, () => json({ error: `invalid key ${EXA_KEY}` }, 403));
    outputs.push((await echo.search({ query: 'q' })) ?? '');
    const all = [...outputs, ...logs].join('\n');
    expect(all).not.toContain(EXA_KEY);
    expect(all).not.toContain(BRAVE_KEY);
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('logging', () => {
  test('one line per call with step, tool, provider, count and cost; query clipped to 120', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    await t.search({ query: 'x'.repeat(300) });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('step=step-1');
    expect(logs[0]).toContain('tool=web_search');
    expect(logs[0]).toContain('provider=exa');
    expect(logs[0]).toContain('results=2');
    expect(logs[0]).toContain('cost=0.007');
    expect(logs[0]).toContain('x'.repeat(120));
    expect(logs[0]).not.toContain('x'.repeat(121));
  });
});

describe('monthly budget', () => {
  test('past the cap returns the exhausted message with spend and makes no call', async () => {
    writeFileSync(ledgerPath(), JSON.stringify({ '2026-11': 20 }));
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    const out = (await t.search({ query: 'q' })) ?? '';
    expect(out.startsWith(WEB_SEARCH_BUDGET_EXHAUSTED)).toBe(true);
    expect(out).toContain('20');
    expect(calls).toHaveLength(0);
  });

  test('CAIRN_WEB_SEARCH_MONTHLY_CAP_USD overrides the cap', async () => {
    writeFileSync(ledgerPath(), JSON.stringify({ '2026-11': 1 }));
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()), {
      env: { CAIRN_WEB_SEARCH_MONTHLY_CAP_USD: '1' },
    });
    expect(((await t.search({ query: 'q' })) ?? '').startsWith(WEB_SEARCH_BUDGET_EXHAUSTED)).toBe(
      true,
    );
    expect(calls).toHaveLength(0);
  });

  test('spend accumulates across calls', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    await t.search({ query: 'a' });
    await t.search({ query: 'b' });
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.014, 6);
  });

  test('a corrupt ledger counts as zero and is rewritten', async () => {
    writeFileSync(ledgerPath(), '{not json');
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    const out = (await t.search({ query: 'q' })) ?? '';
    expect(out).not.toContain(WEB_SEARCH_BUDGET_EXHAUSTED);
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBeCloseTo(0.007, 6);
  });

  test('a missing ledger counts as zero', async () => {
    expect(existsSync(ledgerPath())).toBe(false);
    const t = tools({ brave: BRAVE_KEY }, () => json({ web: { results: [] } }));
    await t.search({ query: 'q' });
    expect(existsSync(ledgerPath())).toBe(true);
  });

  test('a new UTC month starts at zero', async () => {
    writeFileSync(ledgerPath(), JSON.stringify({ '2026-10': 20 }));
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    const out = (await t.search({ query: 'q' })) ?? '';
    expect(out).not.toContain(WEB_SEARCH_BUDGET_EXHAUSTED);
    expect(calls).toHaveLength(1);
  });

  test('ledger writes leave no temp files behind', async () => {
    const t = tools({ exa: EXA_KEY }, () => json(exaSearchBody()));
    await t.search({ query: 'q' });
    expect(readdirSync(home)).toEqual(['web-search-spend.json']);
  });

  test('plain web_fetch is free and ignores the budget', async () => {
    writeFileSync(ledgerPath(), JSON.stringify({ '2026-11': 99 }));
    const t = tools({}, () => html('<p>hello</p>'));
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/' })) ?? '') as WebToolOutput;
    expect(out.provider).toBe('plain');
    expect(JSON.parse(readFileSync(ledgerPath(), 'utf8'))['2026-11']).toBe(99);
  });

  test('web_fetch with an exhausted budget falls back to the plain GET', async () => {
    writeFileSync(ledgerPath(), JSON.stringify({ '2026-11': 20 }));
    const t = tools({ exa: EXA_KEY }, () => html('<p>hello</p>'));
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/' })) ?? '') as WebToolOutput;
    expect(out.provider).toBe('plain');
    expect(calls.every((c) => !c.url.includes('exa.ai'))).toBe(true);
  });
});

describe('clipping', () => {
  test('total characters per call are bounded and flagged', async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({
      url: `https://e.example/${i}`,
      title: `T${i}`,
      text: 'z'.repeat(50_000),
    }));
    const t = tools({ exa: EXA_KEY }, () => json({ results: big }));
    const out = JSON.parse((await t.search({ query: 'q' })) ?? '') as WebToolOutput;
    const total = out.results.reduce((n, r) => n + r.text.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
    expect(out.truncated).toBe(true);
  });
});

describe('plain web_fetch', () => {
  test('strips html to text and drops scripts and styles', async () => {
    const t = tools({}, () =>
      html(
        '<html><head><title>My Page</title><style>p{color:red}</style></head><body><script>var secret=1</script><h1>Head</h1><p>Hello &amp; welcome</p></body></html>',
      ),
    );
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/' })) ?? '') as WebToolOutput;
    expect(out.results[0]?.title).toBe('My Page');
    expect(out.results[0]?.text).toContain('Hello & welcome');
    expect(out.results[0]?.text).not.toContain('secret');
    expect(out.results[0]?.text).not.toContain('color:red');
    expect(out.results[0]?.fetchedAt).toBe(NOW.toISOString());
  });

  test('with an Exa key, private and non-http targets are refused before reaching Exa', async () => {
    const built = buildWebTools({
      keys: { exa: EXA_KEY },
      stepId: 's',
      home,
      log: () => undefined,
      fetch: fakeFetch(() => json({ results: [{ url: 'x', title: 't', text: 'leak' }] })),
      now: () => NOW,
      env: {},
      lookup: async () => ['127.0.0.1'],
    });
    const fetchTool = built.find((t) => t.name === WEB_FETCH_TOOL_NAME);
    for (const url of [
      'http://127.0.0.1/private',
      'https://internal.example/',
      'file:///etc/passwd',
    ]) {
      expect(await fetchTool?.execute({ url })).toContain('web_fetch refused');
    }
    expect(calls).toHaveLength(0);
  });

  test('rejects non-http(s) schemes', async () => {
    const t = tools({}, () => html('x'));
    for (const url of ['file:///etc/passwd', 'ftp://a.example/x', 'javascript:alert(1)']) {
      expect(await t.fetch({ url })).toContain('web_fetch refused');
    }
    expect(calls).toHaveLength(0);
  });

  test.each([
    ['127.0.0.1'],
    ['10.0.0.5'],
    ['172.16.3.4'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['0.0.0.0'],
    ['::1'],
    ['fe80::1'],
    ['fc00::1'],
    ['::ffff:127.0.0.1'],
  ])('refuses a host that resolves to %s', async (ip) => {
    const built = buildWebTools({
      keys: {},
      stepId: 's',
      home,
      log: () => undefined,
      fetch: fakeFetch(() => html('x')),
      now: () => NOW,
      env: {},
      lookup: async () => [ip],
    });
    const fetchTool = built.find((t) => t.name === WEB_FETCH_TOOL_NAME);
    const out = await fetchTool?.execute({ url: 'https://rebind.example/' });
    expect(out).toContain('web_fetch refused');
    expect(calls).toHaveLength(0);
  });

  test('refuses when any resolved address is private', async () => {
    const built = buildWebTools({
      keys: {},
      stepId: 's',
      home,
      log: () => undefined,
      fetch: fakeFetch(() => html('x')),
      now: () => NOW,
      env: {},
      lookup: async () => [PUBLIC_IP, '10.0.0.1'],
    });
    const out = await built[0]?.execute({ url: 'https://mixed.example/' });
    expect(out).toContain('web_fetch refused');
  });

  test('refuses literal private IP urls', async () => {
    const t = tools({}, () => html('x'));
    expect(await t.fetch({ url: 'http://169.254.169.254/latest/meta-data' })).toContain(
      'web_fetch refused',
    );
    expect(await t.fetch({ url: 'http://[::1]/' })).toContain('web_fetch refused');
    expect(calls).toHaveLength(0);
  });

  test('follows redirects and re-checks every hop', async () => {
    const hosts: Record<string, string> = { 'a.example': PUBLIC_IP, 'evil.example': '127.0.0.1' };
    const built = buildWebTools({
      keys: {},
      stepId: 's',
      home,
      log: () => undefined,
      fetch: fakeFetch((c) => {
        if (c.url === 'https://a.example/') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/x' },
          });
        }
        return html('x');
      }),
      now: () => NOW,
      env: {},
      lookup: async (host) => [hosts[host] ?? PUBLIC_IP],
    });
    const out = await built[0]?.execute({ url: 'https://a.example/' });
    expect(out).toContain('web_fetch refused');
    expect(calls.map((c) => c.url)).toEqual(['https://a.example/']);
  });

  test('follows a public redirect', async () => {
    const t = tools({}, (c) =>
      c.url === 'https://a.example/'
        ? new Response(null, { status: 301, headers: { location: '/final' } })
        : html('<p>final page</p>'),
    );
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/' })) ?? '') as WebToolOutput;
    expect(out.results[0]?.text).toContain('final page');
    expect(out.results[0]?.url).toBe('https://a.example/final');
  });

  test('stops after 5 redirects', async () => {
    const t = tools({}, (c) => {
      const n = Number(new URL(c.url).searchParams.get('n') ?? '0');
      return new Response(null, {
        status: 302,
        headers: { location: `https://a.example/?n=${n + 1}` },
      });
    });
    const out = await t.fetch({ url: 'https://a.example/?n=0' });
    expect(out).toContain('too many redirects');
    expect(calls).toHaveLength(6);
  });

  test('caps the response size', async () => {
    const t = tools({}, () => html(`<p>${'q'.repeat(5_000_000)}</p>`));
    const out = JSON.parse((await t.fetch({ url: 'https://a.example/' })) ?? '') as WebToolOutput;
    expect(out.truncated).toBe(true);
    expect(out.results[0]?.text.length).toBeLessThanOrEqual(20_000);
  });

  test('times out after 15 seconds via an abort signal', async () => {
    const t = tools({}, (c) => {
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
      return html('ok');
    });
    await t.fetch({ url: 'https://a.example/' });
    expect(calls[0]?.init?.redirect).toBe('manual');
  });

  test('a non-2xx response is a clear error', async () => {
    const t = tools({}, () => html('nope', 404));
    expect(await t.fetch({ url: 'https://a.example/' })).toContain('404');
  });

  test('missing url or query gives a usage message', async () => {
    const t = tools({ exa: EXA_KEY }, () => json({}));
    expect(await t.fetch({})).toContain('needs a non-empty "url"');
    expect(await t.search({})).toContain('needs a non-empty "query"');
    expect(calls).toHaveLength(0);
  });
});
