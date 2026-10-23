// #1404 S4a: the merge gate's GitHub transport in lib/github.ts. The functions send one request
// built from the caller's arguments and hand the response back unread; the gate (S4b) decides
// what a response means. Failure modes first: docs/verify/1404/s4a-failure-modes.txt (FM-1 to
// FM-20); the T numbers below are the ones that file names.
// Live shapes: apps/server/test/fixtures/github/gate-*.json, captured read-only with gh api on
// 2026-10-22 (docs/verify/1404/s4a-github-shapes.txt). The status POST runs against a stub only.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  type FetchLike,
  type GithubRawResult,
  githubBranchRaw,
  githubBranchRulesRaw,
  githubCheckRunsRaw,
  githubCombinedStatusRaw,
  githubCompareRaw,
  githubContentsRaw,
  githubCreateCommitStatus,
  githubPullRaw,
} from '../src/lib/github.js';

const TOKEN = 'gho_s4aTransportTestToken0123456789';
const O = 'xiechimon';
const R = 'cairn';
const API = `https://api.github.com/repos/${O}/${R}`;
const BASE = 'a6c0865edea6cc95d86b32eb33f6a265c0f20d21';
const HEAD = 'f9c4f852292592395e882e1d900ca215a1aafce5';
const SHA = '39a108e80bcd5d82e980599abf32d059b2fbad8c';
const MAIN = '93b9ce215b5ee101cf5e511ddd2cb8d212d04e71';
const T = 10_000;
/** Built from code points so no formatter turns them into raw invisible characters. */
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));

type Init = NonNullable<Parameters<FetchLike>[1]>;
interface Call {
  url: string;
  init: Init;
}

interface Reply {
  status: number;
  headers?: Record<string, string>;
  /** JSON-encoded unless it is a string, which is sent as is. */
  body?: unknown;
  /** json() / text() reject with this instead of returning. */
  bodyError?: unknown;
}

/** A Response stand-in whose body can be read once, like the real one. */
function reply(r: Reply): Awaited<ReturnType<FetchLike>> {
  const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const text =
    r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  let used = false;
  const read = () => {
    if (used) return Promise.reject(new TypeError('Body is unusable: Body has already been read'));
    used = true;
    return r.bodyError !== undefined ? Promise.reject(r.bodyError) : Promise.resolve(text);
  };
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: () => read().then((t) => JSON.parse(t) as unknown),
    text: read,
  };
}

/** A fetch that records every call and answers with `answer`. */
function stub(answer: Reply | ((call: Call) => Promise<Awaited<ReturnType<FetchLike>>>)) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return typeof answer === 'function' ? answer(call) : Promise.resolve(reply(answer));
  };
  return { fetch, calls };
}

const OK = { status: 200, body: { ok: true } };

/** Every transport function with valid arguments, so a table can run a case through all of them. */
const ALL: Array<[string, (f: FetchLike, token?: string) => Promise<GithubRawResult>]> = [
  ['pull', (f, t = TOKEN) => githubPullRaw(f, t, O, R, 1479, { etag: null, timeoutMs: T })],
  ['branch', (f, t = TOKEN) => githubBranchRaw(f, t, O, R, 'main', { etag: null, timeoutMs: T })],
  [
    'rules',
    (f, t = TOKEN) =>
      githubBranchRulesRaw(f, t, O, R, 'main', { etag: null, page: 1, perPage: 100, timeoutMs: T }),
  ],
  [
    'compare',
    (f, t = TOKEN) =>
      githubCompareRaw(f, t, O, R, BASE, HEAD, { page: 1, perPage: 100, timeoutMs: T }),
  ],
  [
    'check-runs',
    (f, t = TOKEN) =>
      githubCheckRunsRaw(f, t, O, R, SHA, {
        filter: 'latest',
        etag: null,
        page: 1,
        perPage: 100,
        timeoutMs: T,
      }),
  ],
  [
    'status',
    (f, t = TOKEN) =>
      githubCombinedStatusRaw(f, t, O, R, SHA, { etag: null, page: 1, perPage: 100, timeoutMs: T }),
  ],
  [
    'contents',
    (f, t = TOKEN) => githubContentsRaw(f, t, O, R, 'docs/verify/1490', MAIN, { timeoutMs: T }),
  ],
  [
    'create-status',
    (f, t = TOKEN) =>
      githubCreateCommitStatus(
        f,
        t,
        O,
        R,
        SHA,
        { state: 'pending', context: 'cairn/merge-gate', description: 'waiting' },
        { timeoutMs: T },
      ),
  ],
];

const invalid = (field: string): GithubRawResult => ({
  kind: 'failed',
  failure: { kind: 'invalid', field },
});

describe('#1404 S4a gate transport: what is refused before any request', () => {
  test.each(ALL)('T2 %s: a missing or header-unsafe token sends nothing', async (_n, call) => {
    // 123 and null: callers outside TypeScript's reach; '123' would pass the character check.
    const bads: unknown[] = [
      '',
      ' ',
      'gho_a b',
      'gho_a\r\nx-evil: 1',
      'gho_tök',
      'gho_\u0000',
      123,
      null,
    ];
    for (const bad of bads) {
      const { fetch, calls } = stub(OK);
      expect(await call(fetch, bad as string)).toEqual(invalid('token'));
      expect(calls).toEqual([]);
    }
  });

  const BAD_SHAS = [
    'A'.repeat(40),
    'abc1234',
    'a'.repeat(41),
    'g'.repeat(40),
    'main',
    `../${'a'.repeat(37)}`,
    ` ${'a'.repeat(39)}`,
    '',
  ];

  test.each([
    [
      'compare base',
      'base',
      (f: FetchLike, s: string) =>
        githubCompareRaw(f, TOKEN, O, R, s, HEAD, { page: 1, perPage: 100, timeoutMs: T }),
    ],
    [
      'compare head',
      'head',
      (f: FetchLike, s: string) =>
        githubCompareRaw(f, TOKEN, O, R, BASE, s, { page: 1, perPage: 100, timeoutMs: T }),
    ],
    [
      'check-runs',
      'sha',
      (f: FetchLike, s: string) =>
        githubCheckRunsRaw(f, TOKEN, O, R, s, {
          filter: 'latest',
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    [
      'combined status',
      'sha',
      (f: FetchLike, s: string) =>
        githubCombinedStatusRaw(f, TOKEN, O, R, s, {
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    [
      'contents ref',
      'ref',
      (f: FetchLike, s: string) =>
        githubContentsRaw(f, TOKEN, O, R, 'docs/verify/1490', s, { timeoutMs: T }),
    ],
    [
      'status write',
      'sha',
      (f: FetchLike, s: string) =>
        githubCreateCommitStatus(
          f,
          TOKEN,
          O,
          R,
          s,
          { state: 'success', context: 'cairn/merge-gate', description: 'ready' },
          { timeoutMs: T },
        ),
    ],
  ])(
    'T3 %s: only a 40-character lowercase hex SHA goes into the request',
    async (_n, field, call) => {
      for (const bad of BAD_SHAS) {
        const { fetch, calls } = stub(OK);
        expect(await call(fetch, bad)).toEqual(invalid(field));
        expect(calls).toEqual([]);
      }
    },
  );

  const BAD_PATHS = [
    '',
    '/main',
    'main/',
    'a//b',
    '.',
    '..',
    'a/../b',
    'a/./b',
    'ma\u0000in',
    'ma\nin',
    'tab\there',
    'a?b',
    'a#b',
    'x\u007f',
    'lone\ud800',
    undefined as unknown as string,
    7 as unknown as string,
  ];
  const branchCalls: Array<
    [string, string, (f: FetchLike, b: string) => Promise<GithubRawResult>]
  > = [
    [
      'branch',
      'branch',
      (f, b) => githubBranchRaw(f, TOKEN, O, R, b, { etag: null, timeoutMs: T }),
    ],
    [
      'rules',
      'branch',
      (f, b) =>
        githubBranchRulesRaw(f, TOKEN, O, R, b, {
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    ['contents', 'path', (f, p) => githubContentsRaw(f, TOKEN, O, R, p, MAIN, { timeoutMs: T })],
  ];

  test.each(branchCalls)('T4 %s: unsafe path segments send nothing', async (_n, field, call) => {
    for (const bad of BAD_PATHS) {
      const { fetch, calls } = stub(OK);
      expect(await call(fetch, bad), JSON.stringify(bad)).toEqual(invalid(field));
      expect(calls).toEqual([]);
    }
  });

  test('T4 segments are percent-encoded one by one, "/" kept between them', async () => {
    const cases: Array<[string, string]> = [
      ['main', 'main'],
      ['release/1.0', 'release/1.0'],
      ['feature/x y', 'feature/x%20y'],
      ['fix%41', 'fix%2541'],
      ['a+b', 'a%2Bb'],
      ['中文/分支', '%E4%B8%AD%E6%96%87/%E5%88%86%E6%94%AF'],
      [`a${RLO}b`, 'a%E2%80%AEb'],
    ];
    for (const [name, encoded] of cases) {
      const b = stub(OK);
      await githubBranchRaw(b.fetch, TOKEN, O, R, name, { etag: null, timeoutMs: T });
      expect(b.calls.map((c) => c.url)).toEqual([`${API}/branches/${encoded}`]);
      const r = stub(OK);
      await githubBranchRulesRaw(r.fetch, TOKEN, O, R, name, {
        etag: null,
        page: 2,
        perPage: 50,
        timeoutMs: T,
      });
      expect(r.calls.map((c) => c.url)).toEqual([
        `${API}/rules/branches/${encoded}?per_page=50&page=2`,
      ]);
      const c = stub(OK);
      await githubContentsRaw(c.fetch, TOKEN, O, R, name, MAIN, { timeoutMs: T });
      expect(c.calls.map((x) => x.url)).toEqual([`${API}/contents/${encoded}?ref=${MAIN}`]);
    }
  });

  test('T5 owner and repo must be GitHub names, not "." or ".."', async () => {
    for (const [owner, repo, field] of [
      ['', R, 'owner'],
      ['.', R, 'owner'],
      ['..', R, 'owner'],
      ['a/b', R, 'owner'],
      ['a b', R, 'owner'],
      ['ö', R, 'owner'],
      [O, '', 'repo'],
      [O, '..', 'repo'],
      [O, 'x?y', 'repo'],
      [O, 'x#y', 'repo'],
      [O, 'x%2e', 'repo'],
      [null as unknown as string, R, 'owner'],
      [O, ['cairn'] as unknown as string, 'repo'],
    ] as const) {
      const { fetch, calls } = stub(OK);
      expect(
        await githubPullRaw(fetch, TOKEN, owner, repo, 1, { etag: null, timeoutMs: T }),
      ).toEqual(invalid(field));
      expect(calls).toEqual([]);
    }
    const { fetch, calls } = stub(OK);
    await githubPullRaw(fetch, TOKEN, 'Some-Org', 'my.repo_1-x', 7, { etag: null, timeoutMs: T });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/Some-Org/my.repo_1-x/pulls/7',
    ]);
  });

  test('T6 numbers, enums, etags and the status payload are checked before sending', async () => {
    const cases: Array<[string, (f: FetchLike) => Promise<GithubRawResult>]> = [];
    for (const n of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      cases.push([
        'prNumber',
        (f) => githubPullRaw(f, TOKEN, O, R, n, { etag: null, timeoutMs: T }),
      ]);
    }
    // Every paged read checks page and per_page itself.
    const paged: Array<(f: FetchLike, page: number, perPage: number) => Promise<GithubRawResult>> =
      [
        (f, page, perPage) =>
          githubBranchRulesRaw(f, TOKEN, O, R, 'main', { etag: null, page, perPage, timeoutMs: T }),
        (f, page, perPage) =>
          githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page, perPage, timeoutMs: T }),
        (f, page, perPage) =>
          githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
            filter: 'latest',
            etag: null,
            page,
            perPage,
            timeoutMs: T,
          }),
        (f, page, perPage) =>
          githubCombinedStatusRaw(f, TOKEN, O, R, SHA, { etag: null, page, perPage, timeoutMs: T }),
      ];
    for (const read of paged) {
      for (const page of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        cases.push(['page', (f) => read(f, page, 100)]);
      }
      for (const perPage of [0, 101, 2.5, -1]) {
        cases.push(['perPage', (f) => read(f, 1, perPage)]);
      }
    }
    cases.push([
      'filter',
      (f) =>
        githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
          filter: 'any' as 'latest',
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ]);
    // 2 ** 31 and 2 ** 33: beyond the timer limit, AbortSignal.timeout would throw (code review, finding 1).
    for (const timeoutMs of [0, -5, Number.NaN, 1.5, Number.POSITIVE_INFINITY, 2 ** 31, 2 ** 33]) {
      cases.push([
        'timeoutMs',
        (f) => githubContentsRaw(f, TOKEN, O, R, 'docs', MAIN, { timeoutMs }),
      ]);
    }
    for (const etag of ['', 'W/"a\nb"', '"é"', ' "a"']) {
      cases.push(['etag', (f) => githubBranchRaw(f, TOKEN, O, R, 'main', { etag, timeoutMs: T })]);
    }
    const write =
      (status: { state: string; context: string; description: unknown }) => (f: FetchLike) =>
        githubCreateCommitStatus(f, TOKEN, O, R, SHA, status as never, { timeoutMs: T });
    cases.push(['state', write({ state: 'ok', context: 'c', description: 'd' })]);
    cases.push(['state', write({ state: 'SUCCESS', context: 'c', description: 'd' })]);
    cases.push(['context', write({ state: 'success', context: '', description: 'd' })]);
    cases.push(['context', write({ state: 'success', context: 7 as never, description: 'd' })]);
    cases.push(['description', write({ state: 'success', context: 'c', description: null })]);
    cases.push(['description', write({ state: 'success', context: 'c', description: 3 })]);
    for (const [field, call] of cases) {
      const { fetch, calls } = stub(OK);
      expect(await call(fetch)).toEqual(invalid(field));
      expect(calls).toEqual([]);
    }
  });
});

describe('#1404 S4a gate transport: what is sent', () => {
  test.each(ALL)(
    'T1/T7 %s: the token goes only into the Authorization header',
    async (_n, call) => {
      const { fetch, calls } = stub(OK);
      const result = await call(fetch);
      expect(calls).toHaveLength(1);
      const [c] = calls;
      expect(c?.url).not.toContain(TOKEN);
      expect(c?.init.body ?? '').not.toContain(TOKEN);
      expect(c?.init.headers).toMatchObject({
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'cairn-server',
        authorization: `Bearer ${TOKEN}`,
      });
      const otherValues = Object.entries(c?.init.headers ?? {}).filter(
        ([k]) => k !== 'authorization',
      );
      expect(JSON.stringify(otherValues)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    },
  );

  test.each(ALL)(
    'T1 %s: a failed request does not carry the token or the URL',
    async (_n, call) => {
      for (const answer of [
        () => Promise.reject(new TypeError(`fetch failed for ${API} with ${TOKEN}`)),
        () => Promise.resolve(reply({ status: 500, body: { message: 'Server Error' } })),
      ]) {
        const { fetch } = stub(answer);
        const text = JSON.stringify(await call(fetch));
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain('api.github.com');
      }
    },
  );

  test('T7 GET sends exactly the API headers, plus If-None-Match only with an etag; POST adds content-type', async () => {
    const base = ['accept', 'authorization', 'user-agent', 'x-github-api-version'];
    const keys = (c: Call | undefined) => Object.keys(c?.init.headers ?? {}).sort();
    for (const [name, call] of ALL) {
      const { fetch, calls } = stub(OK);
      await call(fetch);
      expect(keys(calls[0]), name).toEqual(
        name === 'create-status' ? [...base.slice(0, 2), 'content-type', ...base.slice(2)] : base,
      );
    }
    const { fetch, calls } = stub(OK);
    await githubPullRaw(fetch, TOKEN, O, R, 1, { etag: '"e"', timeoutMs: T });
    expect(keys(calls[0])).toEqual([
      ...base.slice(0, 1),
      'authorization',
      'if-none-match',
      ...base.slice(2),
    ]);
  });

  test('T8 each read is the documented URL with exactly the caller values', async () => {
    const urls: Array<[string, (f: FetchLike) => Promise<GithubRawResult>]> = [
      [
        `${API}/pulls/1479`,
        (f) => githubPullRaw(f, TOKEN, O, R, 1479, { etag: null, timeoutMs: T }),
      ],
      [
        `${API}/branches/main`,
        (f) => githubBranchRaw(f, TOKEN, O, R, 'main', { etag: null, timeoutMs: T }),
      ],
      [
        `${API}/rules/branches/main?per_page=100&page=3`,
        (f) =>
          githubBranchRulesRaw(f, TOKEN, O, R, 'main', {
            etag: null,
            page: 3,
            perPage: 100,
            timeoutMs: T,
          }),
      ],
      [
        `${API}/compare/${BASE}...${HEAD}?per_page=100&page=1`,
        (f) =>
          githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page: 1, perPage: 100, timeoutMs: T }),
      ],
      [
        `${API}/compare/${BASE}...${HEAD}?per_page=2&page=7`,
        (f) => githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page: 7, perPage: 2, timeoutMs: T }),
      ],
      [
        `${API}/commits/${SHA}/check-runs?filter=latest&per_page=100&page=1`,
        (f) =>
          githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
            filter: 'latest',
            etag: null,
            page: 1,
            perPage: 100,
            timeoutMs: T,
          }),
      ],
      [
        `${API}/commits/${SHA}/check-runs?filter=all&per_page=5&page=2`,
        (f) =>
          githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
            filter: 'all',
            etag: null,
            page: 2,
            perPage: 5,
            timeoutMs: T,
          }),
      ],
      [
        `${API}/commits/${SHA}/status?per_page=100&page=4`,
        (f) =>
          githubCombinedStatusRaw(f, TOKEN, O, R, SHA, {
            etag: null,
            page: 4,
            perPage: 100,
            timeoutMs: T,
          }),
      ],
      [
        `${API}/contents/docs/verify/1490?ref=${MAIN}`,
        (f) => githubContentsRaw(f, TOKEN, O, R, 'docs/verify/1490', MAIN, { timeoutMs: T }),
      ],
    ];
    for (const [url, call] of urls) {
      const { fetch, calls } = stub(OK);
      await call(fetch);
      expect(calls.map((c) => [c.url, c.init.method ?? 'GET'])).toEqual([[url, 'GET']]);
      expect(calls[0]?.init.body).toBeUndefined();
    }
  });

  test('T9 If-None-Match is sent exactly when the caller gives an etag', async () => {
    const etag = 'W/"3656c01e96c9ccc8070ecbc75c4a3f878a00685268a822a7ad2bdf99c97c9017"';
    const conditional: Array<(f: FetchLike, e: string | null) => Promise<GithubRawResult>> = [
      (f, e) => githubPullRaw(f, TOKEN, O, R, 1479, { etag: e, timeoutMs: T }),
      (f, e) => githubBranchRaw(f, TOKEN, O, R, 'main', { etag: e, timeoutMs: T }),
      (f, e) =>
        githubBranchRulesRaw(f, TOKEN, O, R, 'main', {
          etag: e,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
      (f, e) =>
        githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
          filter: 'latest',
          etag: e,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
      (f, e) =>
        githubCombinedStatusRaw(f, TOKEN, O, R, SHA, {
          etag: e,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ];
    for (const call of conditional) {
      const withTag = stub({ status: 304 });
      expect(await call(withTag.fetch, etag)).toEqual({ kind: 'not-modified' });
      expect(withTag.calls[0]?.init.headers?.['if-none-match']).toBe(etag);

      // No etag sent: a 304 is not "unchanged since what you have", it is a status.
      const without = stub({ status: 304 });
      expect(await call(without.fetch, null)).toEqual({
        kind: 'failed',
        failure: { kind: 'status', status: 304, message: null },
      });
      expect(Object.keys(without.calls[0]?.init.headers ?? {})).not.toContain('if-none-match');
    }
  });

  test('T9 compare, contents and the status write never send If-None-Match', async () => {
    for (const [name, call] of ALL.filter(([n]) =>
      ['compare', 'contents', 'create-status'].includes(n),
    )) {
      const { fetch, calls } = stub({ status: 304 });
      expect(await call(fetch), name).toEqual({
        kind: 'failed',
        failure: { kind: 'status', status: 304, message: null },
      });
      expect(Object.keys(calls[0]?.init.headers ?? {})).not.toContain('if-none-match');
    }
  });

  test.each(ALL)('T10 %s: fetch gets a live AbortSignal', async (_n, call) => {
    const seen = stub(OK);
    await call(seen.fetch);
    expect(seen.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(seen.calls[0]?.init.signal?.aborted).toBe(false);
  });

  test('T10 each function applies its own timeoutMs', async () => {
    const calls: Array<(f: FetchLike) => Promise<GithubRawResult>> = [
      (f) => githubPullRaw(f, TOKEN, O, R, 1, { etag: null, timeoutMs: 20 }),
      (f) => githubBranchRaw(f, TOKEN, O, R, 'main', { etag: null, timeoutMs: 20 }),
      (f) =>
        githubBranchRulesRaw(f, TOKEN, O, R, 'main', {
          etag: null,
          page: 1,
          perPage: 1,
          timeoutMs: 20,
        }),
      (f) => githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page: 1, perPage: 1, timeoutMs: 20 }),
      (f) =>
        githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
          filter: 'all',
          etag: null,
          page: 1,
          perPage: 1,
          timeoutMs: 20,
        }),
      (f) =>
        githubCombinedStatusRaw(f, TOKEN, O, R, SHA, {
          etag: null,
          page: 1,
          perPage: 1,
          timeoutMs: 20,
        }),
      (f) => githubContentsRaw(f, TOKEN, O, R, 'docs', MAIN, { timeoutMs: 20 }),
      (f) =>
        githubCreateCommitStatus(
          f,
          TOKEN,
          O,
          R,
          SHA,
          { state: 'error', context: 'c', description: '' },
          { timeoutMs: 20 },
        ),
    ];
    for (const call of calls) {
      const hang = stub(
        ({ init }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      );
      const started = Date.now();
      expect(await call(hang.fetch)).toEqual({ kind: 'failed', failure: { kind: 'timeout' } });
      expect(Date.now() - started).toBeLessThan(5_000);
    }
  });

  test('T11 the status write is POST statuses/{sha} with exactly state, context and description', async () => {
    const created = {
      id: 1,
      state: 'failure',
      context: 'cairn/merge-gate',
      description: '项目策略为人工合并 (policy-human)',
    };
    const { fetch, calls } = stub({ status: 201, headers: { etag: '"s1"' }, body: created });
    const result = await githubCreateCommitStatus(
      fetch,
      TOKEN,
      O,
      R,
      SHA,
      {
        state: 'failure',
        context: 'cairn/merge-gate',
        description: '项目策略为人工合并 (policy-human)',
      },
      { timeoutMs: T },
    );
    expect(result).toEqual({ kind: 'ok', status: 201, etag: '"s1"', link: null, body: created });
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c?.url).toBe(`${API}/statuses/${SHA}`);
    expect(c?.init.method).toBe('POST');
    expect(c?.init.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(c?.init.body ?? 'null')).toEqual({
      state: 'failure',
      context: 'cairn/merge-gate',
      description: '项目策略为人工合并 (policy-human)',
    });
    expect(Object.keys(JSON.parse(c?.init.body ?? '{}')).sort()).toEqual([
      'context',
      'description',
      'state',
    ]);
  });

  test('T11 the status payload is sent as given, extra keys dropped', async () => {
    for (const state of ['error', 'failure', 'pending', 'success'] as const) {
      const { fetch, calls } = stub({ status: 201, body: {} });
      const status = {
        state,
        context: 'Cairn/Merge-Gate',
        description: '',
        target_url: 'https://evil.example',
      };
      await githubCreateCommitStatus(fetch, TOKEN, O, R, SHA, status, { timeoutMs: T });
      expect(JSON.parse(calls[0]?.init.body ?? 'null')).toEqual({
        state,
        context: 'Cairn/Merge-Gate',
        description: '',
      });
    }
  });
});

describe('#1404 S4a gate transport: what comes back', () => {
  const live: Array<
    [string, string, Record<string, string>, (f: FetchLike) => Promise<GithubRawResult>]
  > = [
    [
      'gate-pull-1479.json',
      `${API}/pulls/1479`,
      { etag: '"30c25f67a3a39aae53a6877d7c7f7a2de5c8f9cef211a9e1fb150b7d32db7372"' },
      (f) => githubPullRaw(f, TOKEN, O, R, 1479, { etag: null, timeoutMs: T }),
    ],
    [
      'gate-branch-main.json',
      `${API}/branches/main`,
      { etag: 'W/"769d6e1639736f14e3e671819081b9bf067c611cd09fd7ea22bec6ec97a3eace"' },
      (f) => githubBranchRaw(f, TOKEN, O, R, 'main', { etag: null, timeoutMs: T }),
    ],
    [
      'gate-rules-main.json',
      `${API}/rules/branches/main?per_page=100&page=1`,
      { etag: '"82b4537a197d92fd0108f1172dcf6ca8f21c3d95fd500d36edb863a1f86e9b82"' },
      (f) =>
        githubBranchRulesRaw(f, TOKEN, O, R, 'main', {
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    [
      'gate-compare-1439-page1.json',
      `${API}/compare/${BASE}...${HEAD}?per_page=2&page=1`,
      {
        etag: 'W/"2a78863742d2dd751e5cb6a4c0dc9aa1cd58472a688a9d45a70ab3a521acda58"',
        link: `<https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=2>; rel="last", <https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=2>; rel="next", <https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=1>; rel="first"`,
      },
      (f) => githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page: 1, perPage: 2, timeoutMs: T }),
    ],
    [
      'gate-compare-1439-page2.json',
      `${API}/compare/${BASE}...${HEAD}?per_page=2&page=2`,
      {
        etag: 'W/"08761c3d304ffe39c1fcc5977ec6859450f4e97308966ac7fcd9b99d51d70f96"',
        link: `<https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=2>; rel="last", <https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=1>; rel="first", <https://api.github.com/repositories/1361226985/compare/${BASE}...${HEAD}?per_page=2&page=1>; rel="prev"`,
      },
      (f) => githubCompareRaw(f, TOKEN, O, R, BASE, HEAD, { page: 2, perPage: 2, timeoutMs: T }),
    ],
    [
      'gate-check-runs-39a108e.json',
      `${API}/commits/${SHA}/check-runs?filter=latest&per_page=100&page=1`,
      { etag: 'W/"3656c01e96c9ccc8070ecbc75c4a3f878a00685268a822a7ad2bdf99c97c9017"' },
      (f) =>
        githubCheckRunsRaw(f, TOKEN, O, R, SHA, {
          filter: 'latest',
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    [
      'gate-status-39a108e.json',
      `${API}/commits/${SHA}/status?per_page=100&page=1`,
      { etag: 'W/"ee101784f2b5ce9b04969705edc84e75c64e8b927adc787bc79f383693858ba6"' },
      (f) =>
        githubCombinedStatusRaw(f, TOKEN, O, R, SHA, {
          etag: null,
          page: 1,
          perPage: 100,
          timeoutMs: T,
        }),
    ],
    [
      'gate-contents-1490.json',
      `${API}/contents/docs/verify/1490?ref=${MAIN}`,
      { etag: '"222cb186b9067ec0c1c7c6f6286ba3aa01e25a84"' },
      (f) => githubContentsRaw(f, TOKEN, O, R, 'docs/verify/1490', MAIN, { timeoutMs: T }),
    ],
  ];

  test.each(live)(
    'T12 %s comes back unread, with its etag and Link',
    async (file, url, headers, call) => {
      const body = fixture(file);
      const { fetch, calls } = stub({ status: 200, headers, body });
      expect(await call(fetch)).toEqual({
        kind: 'ok',
        status: 200,
        etag: headers.etag ?? null,
        link: headers.link ?? null,
        body,
      });
      expect(calls.map((c) => c.url)).toEqual([url]);
    },
  );

  test('T12 nothing in a body is projected, filtered or defaulted', async () => {
    // A check-runs page with a malformed row and unknown fields: githubCommitCheckRuns skips such
    // rows; the gate transport must not.
    const body = {
      total_count: 3,
      check_runs: [{ name: 'check', head_sha: SHA }, null, 'x', { extra: { nested: [1, 2] } }],
      surprise: true,
    };
    const { fetch } = stub({ status: 200, body });
    const r = await githubCheckRunsRaw(fetch, TOKEN, O, R, SHA, {
      filter: 'latest',
      etag: null,
      page: 1,
      perPage: 100,
      timeoutMs: T,
    });
    expect(r).toEqual({ kind: 'ok', status: 200, etag: null, link: null, body });
    for (const odd of [null, 0, 'text', [], false]) {
      // JSON-encoded here: the stub sends a string body verbatim.
      const s = stub({ status: 200, body: JSON.stringify(odd) });
      expect(await githubPullRaw(s.fetch, TOKEN, O, R, 1, { etag: null, timeoutMs: T })).toEqual({
        kind: 'ok',
        status: 200,
        etag: null,
        link: null,
        body: odd,
      });
    }
  });

  test('T13 a Link to a next page is returned, not followed', async () => {
    const link = '<https://api.github.com/repositories/1/commits/x/check-runs?page=2>; rel="next"';
    for (const [, call] of ALL) {
      const { fetch, calls } = stub({ status: 200, headers: { link }, body: [] });
      const r = await call(fetch);
      expect(r.kind === 'ok' && r.link).toBe(link);
      expect(calls).toHaveLength(1);
    }
  });

  test.each(ALL)(
    'T14 %s: a 2xx body that is not JSON is not-json; a body read timeout is timeout',
    async (_n, call) => {
      expect(await call(stub({ status: 200, body: '<html>oops</html>' }).fetch)).toEqual({
        kind: 'failed',
        failure: { kind: 'not-json' },
      });
      expect(await call(stub({ status: 200, body: '' }).fetch)).toEqual({
        kind: 'failed',
        failure: { kind: 'not-json' },
      });
      const slow = stub({
        status: 200,
        bodyError: new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      });
      expect(await call(slow.fetch)).toEqual({ kind: 'failed', failure: { kind: 'timeout' } });
    },
  );

  test('T15 rate limiting is told apart from other refusals', async () => {
    const cases: Array<[Reply, GithubRawResult]> = [
      [
        { status: 429 },
        {
          kind: 'failed',
          failure: { kind: 'rate-limited', status: 429, resetAt: null, retryAfterSeconds: null },
        },
      ],
      [
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792670358' },
          body: { message: 'API rate limit exceeded for user ID 1.' },
        },
        {
          kind: 'failed',
          failure: {
            kind: 'rate-limited',
            status: 403,
            resetAt: 1_792_670_358_000,
            retryAfterSeconds: null,
          },
        },
      ],
      [
        { status: 403, headers: { 'retry-after': ' 60 ' } },
        {
          kind: 'failed',
          failure: { kind: 'rate-limited', status: 403, resetAt: null, retryAfterSeconds: 60 },
        },
      ],
      [
        {
          status: 403,
          body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
        },
        {
          kind: 'failed',
          failure: { kind: 'rate-limited', status: 403, resetAt: null, retryAfterSeconds: null },
        },
      ],
      [
        {
          status: 429,
          headers: { 'retry-after': '', 'x-ratelimit-reset': 'soon' },
        },
        {
          kind: 'failed',
          failure: { kind: 'rate-limited', status: 429, resetAt: null, retryAfterSeconds: null },
        },
      ],
      [
        {
          status: 429,
          headers: { 'retry-after': '-1', 'x-ratelimit-reset': '1.5' },
        },
        {
          kind: 'failed',
          failure: { kind: 'rate-limited', status: 429, resetAt: null, retryAfterSeconds: null },
        },
      ],
      [
        {
          status: 429,
          headers: { 'retry-after': '0', 'x-ratelimit-reset': '1792670358' },
        },
        {
          kind: 'failed',
          failure: {
            kind: 'rate-limited',
            status: 429,
            resetAt: 1_792_670_358_000,
            retryAfterSeconds: 0,
          },
        },
      ],
      [
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '4999' },
          body: { message: 'Resource not accessible by integration' },
        },
        {
          kind: 'failed',
          failure: {
            kind: 'status',
            status: 403,
            message: 'Resource not accessible by integration',
          },
        },
      ],
      [
        { status: 404, body: fixture('gate-pull-not-found.json') },
        { kind: 'failed', failure: { kind: 'status', status: 404, message: 'Not Found' } },
      ],
      [
        { status: 409, body: { message: 'Git Repository is empty.' } },
        {
          kind: 'failed',
          failure: { kind: 'status', status: 409, message: 'Git Repository is empty.' },
        },
      ],
      [
        { status: 422, body: { message: 'Validation Failed', errors: [{ code: 'custom' }] } },
        { kind: 'failed', failure: { kind: 'status', status: 422, message: 'Validation Failed' } },
      ],
      [
        { status: 422, body: { message: 'rate limit field is invalid' } },
        {
          kind: 'failed',
          failure: { kind: 'status', status: 422, message: 'rate limit field is invalid' },
        },
      ],
      [
        { status: 500, body: 'upstream connect error' },
        { kind: 'failed', failure: { kind: 'status', status: 500, message: null } },
      ],
    ];
    for (const [answer, expected] of cases) {
      for (const [name, call] of ALL) {
        expect(await call(stub(answer).fetch), `${name} ${JSON.stringify(answer)}`).toEqual(
          expected,
        );
      }
    }
  });

  test('T16 GitHub error messages are cleaned and capped', async () => {
    const cases: Array<[unknown, string | null]> = [
      [{ message: `Bad\nthing${RLO}here${ZWSP}` }, 'Bad thing here'],
      [{ message: '\u0000' }, null],
      [{ message: '' }, null],
      [{ message: 'x'.repeat(500) }, 'x'.repeat(200)],
      [{ message: '中'.repeat(300) }, '中'.repeat(200)],
      [
        { message: String.fromCodePoint(0x20000).repeat(300) },
        String.fromCodePoint(0x20000).repeat(200),
      ],
      [{ message: 7 }, null],
      [{ errors: [] }, null],
      [['Not Found'], null],
      ['plain text Not Found', null],
      [null, null],
    ];
    for (const [body, message] of cases) {
      const { fetch } = stub({ status: 404, body: body === null ? 'null' : body });
      expect(await githubPullRaw(fetch, TOKEN, O, R, 1, { etag: null, timeoutMs: T })).toEqual({
        kind: 'failed',
        failure: { kind: 'status', status: 404, message },
      });
    }
    // An error body whose read times out is a timeout, unless the headers already say rate-limited
    // (code review, finding 3: a header-less secondary-limit 403 must not turn into a plain status).
    const slow403 = stub({ status: 403, bodyError: new DOMException('timed out', 'TimeoutError') });
    expect(
      await githubPullRaw(slow403.fetch, TOKEN, O, R, 1, { etag: null, timeoutMs: T }),
    ).toEqual({
      kind: 'failed',
      failure: { kind: 'timeout' },
    });
    const slow429 = stub({
      status: 429,
      headers: { 'retry-after': '30' },
      bodyError: new DOMException('timed out', 'TimeoutError'),
    });
    expect(
      await githubPullRaw(slow429.fetch, TOKEN, O, R, 1, { etag: null, timeoutMs: T }),
    ).toEqual({
      kind: 'failed',
      failure: { kind: 'rate-limited', status: 429, resetAt: null, retryAfterSeconds: 30 },
    });
    // An error body that cannot be read for another reason still gives a status.
    const broken = stub({ status: 502, bodyError: new TypeError('terminated') });
    expect(await githubPullRaw(broken.fetch, TOKEN, O, R, 1, { etag: null, timeoutMs: T })).toEqual(
      {
        kind: 'failed',
        failure: { kind: 'status', status: 502, message: null },
      },
    );
  });

  test.each(ALL)(
    'T17 %s: a rejected fetch is timeout or network, never a throw',
    async (_n, call) => {
      const cases: Array<[unknown, 'timeout' | 'network']> = [
        [new DOMException('timed out', 'TimeoutError'), 'timeout'],
        [new DOMException('aborted', 'AbortError'), 'timeout'],
        [new TypeError('fetch failed'), 'network'],
        [new Error('boom'), 'network'],
        ['a string', 'network'],
        [undefined, 'network'],
      ];
      for (const [err, kind] of cases) {
        const { fetch } = stub(() => Promise.reject(err));
        expect(await call(fetch)).toEqual({ kind: 'failed', failure: { kind } });
      }
      const thrower: FetchLike = () => {
        throw new TypeError('sync throw');
      };
      expect(await call(thrower)).toEqual({ kind: 'failed', failure: { kind: 'network' } });
    },
  );

  test('T18 a refused status write comes back classified after one request', async () => {
    const cases: Array<[Reply, GithubRawResult]> = [
      [
        {
          status: 422,
          body: {
            message: 'Validation Failed',
            errors: [
              { message: 'This SHA and context has reached the maximum number of statuses.' },
            ],
          },
        },
        { kind: 'failed', failure: { kind: 'status', status: 422, message: 'Validation Failed' } },
      ],
      [
        { status: 404, body: { message: 'Not Found' } },
        { kind: 'failed', failure: { kind: 'status', status: 404, message: 'Not Found' } },
      ],
      [
        { status: 403, body: { message: 'Must have push access to repository' } },
        {
          kind: 'failed',
          failure: { kind: 'status', status: 403, message: 'Must have push access to repository' },
        },
      ],
      [
        { status: 503, body: { message: 'Service Unavailable' } },
        {
          kind: 'failed',
          failure: { kind: 'status', status: 503, message: 'Service Unavailable' },
        },
      ],
    ];
    for (const [answer, expected] of cases) {
      const { fetch, calls } = stub(answer);
      expect(
        await githubCreateCommitStatus(
          fetch,
          TOKEN,
          O,
          R,
          SHA,
          { state: 'success', context: 'cairn/merge-gate', description: 'ready' },
          { timeoutMs: T },
        ),
      ).toEqual(expected);
      expect(calls).toHaveLength(1);
    }
  });
});
