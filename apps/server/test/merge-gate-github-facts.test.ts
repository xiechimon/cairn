// #1404 S4b: readGateGithubFacts, the gate's GitHub shell (merge-gate/github-facts.ts). It turns the raw
// responses of the injected port into the GitHub half of GateInputs under #1479's contract (the comments at
// GateInputs in readiness.ts). Failure modes first: docs/verify/1404/s4b-failure-modes.txt, B-1 to B-45; the
// F numbers below are the ones that file names. The port here is a fake GitHub that serves GitHub-shaped
// bodies, pages them by the requested page and per_page, and logs every call.

import { type CompareFile, MERGE_GATE_STATUS_CONTEXT } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { compareFilesFromResponse } from '../src/services/merge-gate/digest.js';
import {
  type GateGithubFacts,
  type GateReadCache,
  newGateReadCache,
  readCompareAt,
  readGateGithubFacts,
} from '../src/services/merge-gate/github-facts.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import { mergeReadiness } from '../src/services/merge-gate/readiness.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const EARLIER = 'e'.repeat(40);
const MAIN = 'f'.repeat(40);
const OTHER = '9'.repeat(40);
const APP = 15368;
const REQ = { owner: 'xiechimon', repo: 'cairn', prNumber: 7, ticketRef: '1404', now: 1_000_000 };
const SHOT = 'docs/verify/1404/shot.png';
const link = (sha: string, path = SHOT) =>
  `https://raw.githubusercontent.com/xiechimon/cairn/${sha}/${path}`;

const ok = (body: unknown, etag: string | null = null): GateRaw => ({
  kind: 'ok',
  status: 200,
  etag,
  link: null,
  body,
});
const fail = (failure: Extract<GateRaw, { kind: 'failed' }>['failure']): GateRaw => ({
  kind: 'failed',
  failure,
});
const NOT_FOUND = fail({ kind: 'status', status: 404, message: 'Not Found' });

function prBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    mergeable_state: 'clean',
    changed_files: 3,
    body: `evidence: ${link(HEAD)}`,
    head: { sha: HEAD, ref: 'claude/conv-x', repo: { full_name: 'xiechimon/cairn' } },
    base: { ref: 'main', repo: { full_name: 'xiechimon/cairn', default_branch: 'main' } },
    ...over,
  };
}

function branchBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'main',
    commit: { sha: BASE },
    protected: true,
    protection: {
      enabled: true,
      required_status_checks: {
        enforcement_level: 'non_admins',
        contexts: ['check', 'pr-evidence'],
        checks: [
          { context: 'check', app_id: APP },
          { context: 'pr-evidence', app_id: APP },
        ],
      },
    },
    ...over,
  };
}

const ghFile = (filename: string, over: Record<string, unknown> = {}) => ({
  sha: '1'.repeat(40),
  filename,
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1 +1 @@\n-a\n+b',
  ...over,
});
const FILES = [
  ghFile('apps/server/src/x.ts'),
  ghFile('apps/server/test/x.test.ts'),
  ghFile(SHOT, { status: 'added', additions: 0, deletions: 0, changes: 0, patch: undefined }),
];
/** A linear chain of commits on top of BASE. */
const chain = (...shas: string[]) =>
  shas.map((sha, k) => ({ sha, parents: [{ sha: k === 0 ? BASE : (shas[k - 1] as string) }] }));

const run = (name: string, over: Record<string, unknown> = {}) => ({
  id: 100,
  name,
  head_sha: HEAD,
  status: 'completed',
  conclusion: 'success',
  app: { id: APP, slug: 'github-actions' },
  ...over,
});
const status = (context: string, state: string, over: Record<string, unknown> = {}) => ({
  context,
  state,
  description: `${context} ${state}`,
  updated_at: '2026-10-22T10:00:00Z',
  ...over,
});

interface Fake {
  pull: (n: number, o: { etag: string | null }) => GateRaw;
  branch: (name: string, o: { etag: string | null }) => GateRaw;
  rules: (name: string, o: { page: number; perPage: number; etag: string | null }) => GateRaw;
  compare: (base: string, head: string, o: { page: number; perPage: number }) => GateRaw;
  checkRuns: (sha: string, o: { page: number; perPage: number; etag: string | null }) => GateRaw;
  combinedStatus: (
    sha: string,
    o: { page: number; perPage: number; etag: string | null },
  ) => GateRaw;
  contents: (path: string, ref: string) => GateRaw;
}

const slice = <T>(list: T[], o: { page: number; perPage: number }) =>
  list.slice((o.page - 1) * o.perPage, o.page * o.perPage);

/** A compare that pages `commits` (files on page 1 only), as GitHub does. */
const comparePages =
  (commits: unknown[], files: unknown[] = FILES, extra: Record<string, unknown> = {}) =>
  (_b: string, _h: string, o: { page: number; perPage: number }): GateRaw =>
    ok({
      status: 'ahead',
      ahead_by: commits.length,
      behind_by: 0,
      total_commits: commits.length,
      commits: slice(commits, o),
      ...(o.page === 1 ? { files } : {}),
      ...extra,
    });
const runPages =
  (runs: unknown[], total = runs.length) =>
  (_s: string, o: { page: number; perPage: number }): GateRaw =>
    ok({ total_count: total, check_runs: slice(runs, o) });
const statusPages =
  (statuses: unknown[], sha = HEAD, total = statuses.length) =>
  (_s: string, o: { page: number; perPage: number }): GateRaw =>
    ok({ sha, state: 'pending', total_count: total, statuses: slice(statuses, o) });
const listing = (...names: Array<string | { name: string; type: string }>) =>
  ok(
    names.map((n) => {
      const e = typeof n === 'string' ? { name: n, type: 'file' } : n;
      return { ...e, path: `docs/verify/1404/${e.name}`, sha: '2'.repeat(40), size: 10 };
    }),
  );

function fakeGithub(over: Partial<Fake> = {}) {
  const f: Fake = {
    pull: () => ok(prBody(), '"pr1"'),
    branch: () => ok(branchBody(), '"br1"'),
    rules: () => ok([], '"ru1"'),
    compare: comparePages(chain(EARLIER, HEAD)),
    checkRuns: runPages([run('check', { id: 1 }), run('pr-evidence', { id: 2 })]),
    combinedStatus: statusPages([]),
    contents: (path, ref) =>
      path === 'docs/verify/1404' && ref === HEAD ? listing('shot.png') : NOT_FOUND,
    ...over,
  };
  const log: Array<[string, ...unknown[]]> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const call = async (name: string, args: unknown[], answer: () => GateRaw): Promise<GateRaw> => {
    log.push([name, ...args]);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 0));
      return answer();
    } finally {
      inFlight -= 1;
    }
  };
  const port: GateGithubPort = {
    pull: (n, o) => call('pull', [n, o], () => f.pull(n, o)),
    branch: (name, o) => call('branch', [name, o], () => f.branch(name, o)),
    branchRules: (name, o) => call('rules', [name, o], () => f.rules(name, o)),
    compare: (b, h, o) => call('compare', [b, h, o], () => f.compare(b, h, o)),
    checkRuns: (sha, o) => call('checkRuns', [sha, o], () => f.checkRuns(sha, o)),
    combinedStatus: (sha, o) => call('combinedStatus', [sha, o], () => f.combinedStatus(sha, o)),
    contents: (path, ref) => call('contents', [path, ref], () => f.contents(path, ref)),
    createStatus: () => Promise.reject(new Error('the shell never writes')),
  };
  return { port, log, maxInFlight: () => maxInFlight };
}

const read = (
  over: Partial<Fake> = {},
  cache: GateReadCache = newGateReadCache(),
  req = REQ,
): Promise<GateGithubFacts & { log: Array<[string, ...unknown[]]>; maxInFlight: number }> => {
  const g = fakeGithub(over);
  return readGateGithubFacts(g.port, req, cache).then((facts) => ({
    ...facts,
    log: g.log,
    maxInFlight: g.maxInFlight(),
  }));
};
const names = (log: Array<[string, ...unknown[]]>) => log.map(([n]) => n);

const GREEN_PR = {
  state: 'open',
  merged: false,
  draft: false,
  mergeableState: 'clean',
  headSha: HEAD,
  baseRef: 'main',
  baseRepoFullName: 'xiechimon/cairn',
  headRepoFullName: 'xiechimon/cairn',
  body: `evidence: ${link(HEAD)}`,
  changedFiles: 3,
  baseBehindBy: 0,
};

describe('readGateGithubFacts: the honest read', () => {
  test('every input read at the PR head, in order, one request at a time', async () => {
    const f = await read();
    expect(f.pr).toEqual(GREEN_PR);
    expect(f.defaultBranch).toBe('main');
    expect(f.compare).toEqual({
      headSha: HEAD,
      files: compareFilesFromResponse({ files: FILES }) as CompareFile[],
      commits: [
        { sha: EARLIER, parents: [BASE] },
        { sha: HEAD, parents: [EARLIER] },
      ],
      totalCommits: 2,
    });
    expect(f.checks).toEqual({
      headSha: HEAD,
      statusSha: HEAD,
      required: ['check', 'pr-evidence'],
      runs: [
        { name: 'check', headSha: HEAD, status: 'completed', conclusion: 'success' },
        { name: 'pr-evidence', headSha: HEAD, status: 'completed', conclusion: 'success' },
      ],
      statuses: [],
      complete: true,
    });
    expect(f.evidence).toEqual([{ sha: HEAD, path: SHOT, present: true }]);
    expect(f.baseBehindBy).toBe(0);
    expect(f.ownStatus).toBeNull();
    expect(f.rateLimited).toBeNull();
    expect(f.log).toEqual([
      ['pull', 7, { etag: null }],
      ['branch', 'main', { etag: null }],
      ['rules', 'main', { page: 1, perPage: 100, etag: null }],
      ['compare', BASE, HEAD, { page: 1, perPage: 100 }],
      ['checkRuns', HEAD, { filter: 'latest', page: 1, perPage: 100, etag: null }],
      ['combinedStatus', HEAD, { page: 1, perPage: 100, etag: null }],
      ['contents', 'docs/verify/1404', HEAD],
    ]);
    expect(f.maxInFlight).toBe(1);
  });
});

describe('readGateGithubFacts: the PR (F1 to F5)', () => {
  test('F1 a response for another PR or another base repository is not used', async () => {
    for (const body of [
      prBody({ number: 8 }),
      prBody({
        base: { ref: 'main', repo: { full_name: 'other/cairn', default_branch: 'main' } },
      }),
      prBody({
        base: { ref: 'main', repo: { full_name: 'xiechimon/cairn2', default_branch: 'main' } },
      }),
    ]) {
      const f = await read({ pull: () => ok(body) });
      expect(f.pr).toBeNull();
      expect(f.compare).toBe('unreadable');
      expect(f.checks).toBeNull();
      expect(f.evidence).toEqual([]);
      expect(names(f.log)).toEqual(['pull']);
      expect(f.notes.join(' ')).toMatch(/pull request/);
    }
    // The repository name is compared without case (GitHub names are case-insensitive).
    const f = await read({
      pull: () =>
        ok(
          prBody({
            base: { ref: 'main', repo: { full_name: 'XieChimon/Cairn', default_branch: 'main' } },
          }),
        ),
    });
    expect(f.pr?.baseRepoFullName).toBe('XieChimon/Cairn');
  });

  test('F2 a missing or wrongly typed field makes the PR unreadable, never a default', async () => {
    const without = (key: string) => {
      const b = prBody();
      delete b[key];
      return b;
    };
    const bodies: unknown[] = [
      null,
      [],
      'text',
      without('state'),
      prBody({ state: 'merged' }),
      without('merged'),
      prBody({ merged: 'false' }),
      without('draft'),
      prBody({ draft: null }),
      without('changed_files'),
      prBody({ changed_files: -1 }),
      prBody({ changed_files: 1.5 }),
      prBody({ head: null }),
      prBody({ head: { ref: 'x', repo: { full_name: 'xiechimon/cairn' } } }),
      prBody({ head: { sha: HEAD, repo: { full_name: 'xiechimon/cairn' } } }),
      prBody({ head: { sha: HEAD, ref: 'x', repo: { full_name: 7 } } }),
      prBody({ base: { repo: { full_name: 'xiechimon/cairn' } } }),
      prBody({ base: { ref: 'main', repo: null } }),
      prBody({ base: { ref: 'main', repo: {} } }),
      prBody({ body: 7 }),
      without('number'),
    ];
    for (const body of bodies) {
      const f = await read({ pull: () => ok(body) });
      expect(f.pr, JSON.stringify(body)).toBeNull();
      expect(names(f.log)).toEqual(['pull']);
    }
  });

  test('F3 null body is empty text; a deleted head repository is null; mergeable_state and default branch may be absent', async () => {
    const f = await read({
      pull: () =>
        ok(
          prBody({
            body: null,
            head: { sha: HEAD, ref: 'x', repo: null },
            mergeable_state: undefined,
            base: { ref: 'main', repo: { full_name: 'xiechimon/cairn' } },
          }),
        ),
    });
    expect(f.pr).toMatchObject({ body: '', headRepoFullName: null, mergeableState: null });
    expect(f.defaultBranch).toBeNull();
    for (const ms of [7, null, '']) {
      const g = await read({ pull: () => ok(prBody({ mergeable_state: ms })) });
      expect(g.pr?.mergeableState, String(ms)).toBe(ms === '' ? '' : null);
    }
  });

  test('F4 the PR read is conditional on the cached etag and a 304 re-projects the cached body', async () => {
    const cache = newGateReadCache();
    const first = fakeGithub();
    await readGateGithubFacts(first.port, REQ, cache);
    expect(first.log[0]).toEqual(['pull', 7, { etag: null }]);
    // Change the cached raw body: a 304 must show the change (the projection is not cached).
    const key = [...cache.bodies.keys()].find((k) => k.startsWith('pull:')) as string;
    const entry = cache.bodies.get(key) as { etag: string; body: Record<string, unknown> };
    cache.bodies.set(key, { etag: entry.etag, body: { ...entry.body, draft: true } });
    const second = fakeGithub({ pull: () => ({ kind: 'not-modified' }) });
    const f = await readGateGithubFacts(second.port, REQ, cache);
    expect(second.log[0]).toEqual(['pull', 7, { etag: '"pr1"' }]);
    expect(f.pr?.draft).toBe(true);
    // A response without an etag leaves nothing to send next time.
    const c2 = newGateReadCache();
    await read({ pull: () => ok(prBody(), null) }, c2);
    const third = fakeGithub();
    await readGateGithubFacts(third.port, REQ, c2);
    expect(third.log[0]).toEqual(['pull', 7, { etag: null }]);
    // A response without an etag clears the entry an earlier response left.
    const c3 = newGateReadCache();
    await read({}, c3);
    await read({ pull: () => ok(prBody(), null) }, c3);
    const fourth = fakeGithub();
    await readGateGithubFacts(fourth.port, REQ, c3);
    expect(fourth.log[0]).toEqual(['pull', 7, { etag: null }]);
    // A cached runs page that was not the whole list is not reused: no etag is sent, and a
    // not-modified answer (which the transport only gives when an etag was sent) is not trusted.
    const runs = Array.from({ length: 150 }, (_, k) => run(`job ${k}`, { id: k + 1 }));
    const c4 = newGateReadCache();
    await read({ checkRuns: runPages(runs) }, c4);
    const partial = await read({ checkRuns: () => ({ kind: 'not-modified' }) }, c4);
    expect(partial.log.find(([n]) => n === 'checkRuns')).toEqual([
      'checkRuns',
      HEAD,
      { filter: 'latest', page: 1, perPage: 100, etag: null },
    ]);
    expect(partial.checks).toBeNull();
    // A not-modified with nothing cached is not used.
    const g = await read({ pull: () => ({ kind: 'not-modified' }) });
    expect(g.pr).toBeNull();
  });

  test('F5 a malformed head SHA reads nothing at the head', async () => {
    for (const sha of ['A'.repeat(40), 'abc1234', 'main', '']) {
      const f = await read({
        pull: () => ok(prBody({ head: { sha, ref: 'x', repo: { full_name: 'xiechimon/cairn' } } })),
      });
      expect(f.pr?.headSha).toBe(sha);
      expect(names(f.log)).toEqual(['pull']);
      expect(f.compare).toBe('unreadable');
      expect(f.checks).toBeNull();
      expect(f.ownStatus).toBe('unreadable');
    }
    const g = await read({ pull: () => NOT_FOUND });
    expect(g.pr).toBeNull();
    expect(names(g.log)).toEqual(['pull']);
  });
});

describe('readGateGithubFacts: conditional reads across a push (F19, pr-gate run 1 on #1525)', () => {
  test('F19 the check-runs and status ETags of the old head are never sent for the new head', async () => {
    const NEWER = 'd'.repeat(40);
    const cache = newGateReadCache();
    // First evaluation at HEAD: single, complete pages with ETags, so a later read at HEAD may be conditional.
    await read(
      {
        checkRuns: (_s, o) =>
          ({ ...runPages([run('check', { id: 1 })])(_s, o), etag: '"runs-head"' }) as GateRaw,
        combinedStatus: (_s, o) =>
          ({ ...statusPages([])(_s, o), etag: '"status-head"' }) as GateRaw,
      },
      cache,
    );
    // The author pushes NEWER: the PR now names it as its head.
    const pushed = (sha: string) =>
      read(
        {
          pull: () =>
            ok(
              prBody({
                head: { sha, ref: 'claude/conv-x', repo: { full_name: 'xiechimon/cairn' } },
              }),
            ),
          compare: comparePages(chain(EARLIER, sha)),
          checkRuns: runPages([run('check', { id: 2, head_sha: sha })]),
          combinedStatus: statusPages([], sha),
        },
        cache,
      );
    const after = await pushed(NEWER);
    expect(after.log.filter(([n]) => n === 'checkRuns' || n === 'combinedStatus')).toEqual([
      ['checkRuns', NEWER, { filter: 'latest', page: 1, perPage: 100, etag: null }],
      ['combinedStatus', NEWER, { page: 1, perPage: 100, etag: null }],
    ]);
    // Back at HEAD (the same URLs as the first evaluation): its own ETags are still the ones sent.
    const back = await pushed(HEAD);
    expect(back.log.filter(([n]) => n === 'checkRuns' || n === 'combinedStatus')).toEqual([
      ['checkRuns', HEAD, { filter: 'latest', page: 1, perPage: 100, etag: '"runs-head"' }],
      ['combinedStatus', HEAD, { page: 1, perPage: 100, etag: '"status-head"' }],
    ]);
  });
});

describe('readGateGithubFacts: base branch, compare and required checks (F6 to F11)', () => {
  test('F6 no readable base tip: compare unreadable, never requested by branch name', async () => {
    for (const branch of [
      () => NOT_FOUND,
      () => ok(branchBody({ commit: { sha: 'main' } })),
      () => ok(branchBody({ commit: null })),
      () => ok('not an object'),
    ]) {
      const f = await read({ branch });
      expect(f.compare).toBe('unreadable');
      expect(names(f.log)).not.toContain('compare');
      expect(f.notes).toContain('base branch tip unreadable; compare not read');
      expect(f.checks?.headSha).toBe(HEAD);
    }
  });

  test('F7 every compare page by the same two SHAs; files from page 1 only; readCompareAt reads at the SHAs given', async () => {
    const commits = chain(
      ...Array.from({ length: 150 }, (_, k) =>
        k === 149 ? HEAD : k.toString(16).padStart(40, '0'),
      ),
    );
    const f = await read({ compare: comparePages(commits) });
    expect(f.log.filter(([n]) => n === 'compare')).toEqual([
      ['compare', BASE, HEAD, { page: 1, perPage: 100 }],
      ['compare', BASE, HEAD, { page: 2, perPage: 100 }],
    ]);
    const c = f.compare as Exclude<GateGithubFacts['compare'], string>;
    expect(c.files).toHaveLength(3);
    expect(c.commits).toHaveLength(150);
    expect(c.totalCommits).toBe(150);
    // files repeated on a later page are not added.
    const g = await read({
      compare: (b, h, o) =>
        ok({ ...(comparePages(commits)(b, h, o) as { body: object }).body, files: FILES }),
    });
    expect((g.compare as { files: unknown[] }).files).toHaveLength(3);
    // readCompareAt: S5a reads the compare at a verdict's own head.
    const p = fakeGithub();
    const r = await readCompareAt(p.port, BASE, OTHER);
    expect(p.log).toEqual([['compare', BASE, OTHER, { page: 1, perPage: 100 }]]);
    expect(r.compare).toMatchObject({ headSha: OTHER, totalCommits: 2 });
    expect(r.behindBy).toBe(0);
    expect(r.failure).toBeNull();
    const failed = await readCompareAt(fakeGithub({ compare: () => NOT_FOUND }).port, BASE, OTHER);
    expect(failed).toEqual({
      compare: 'unreadable',
      behindBy: null,
      failure: { kind: 'status', status: 404, message: 'Not Found' },
    });
  });

  test('F8 total_commits, commits, files and behind_by: malformed values never pass', async () => {
    const page1 = (extra: Record<string, unknown>) =>
      comparePages(chain(EARLIER, HEAD), FILES, extra);
    for (const total of [1.5, -1, '2', null, Number.NaN]) {
      const f = await read({ compare: page1({ total_commits: total }) });
      expect(f.compare, String(total)).toBe('malformed');
    }
    const f1 = await read({
      compare: (b, h, o) => {
        const r = page1({})(b, h, o) as { body: Record<string, unknown> };
        return ok({ ...r.body, total_commits: undefined });
      },
    });
    expect(f1.compare).toBe('malformed');
    for (const commits of [
      [{ sha: HEAD }],
      [{ sha: HEAD, parents: [BASE] }],
      [{ parents: [{ sha: BASE }] }],
      [{ sha: 7, parents: [] }],
      [{ sha: HEAD, parents: [{}] }],
      [{ sha: HEAD, parents: [{ sha: 7 }] }],
      'x',
    ]) {
      const f = await read({
        compare: () => ok({ total_commits: 1, behind_by: 0, commits, files: FILES }),
      });
      expect(f.compare, JSON.stringify(commits)).toBe('malformed');
    }
    const badFile = await read({
      compare: comparePages(chain(EARLIER, HEAD), [ghFile('x', { status: 'weird' })]),
    });
    expect(badFile.compare).toBe('malformed');
    expect((await read({ compare: page1({ behind_by: 3 }) })).baseBehindBy).toBe(3);
    for (const behind of [1.5, -1, '3', undefined]) {
      expect(
        (await read({ compare: page1({ behind_by: behind }) })).baseBehindBy,
        String(behind),
      ).toBeNull();
    }
    // A later page that disagrees with page 1 on total_commits: the pages are not one read.
    const commits = chain(
      ...Array.from({ length: 120 }, (_, k) => k.toString(16).padStart(40, '0')),
    );
    const drift = await read({
      compare: (b, h, o) => {
        const r = comparePages(commits)(b, h, o) as { body: Record<string, unknown> };
        return ok({ ...r.body, total_commits: o.page === 1 ? 120 : 121 });
      },
    });
    expect(drift.compare).toBe('unreadable');
  });

  test('F9 paging: all pages, as read; stop at an empty page or the 10-page cap; one failed page is unreadable', async () => {
    const many = (n: number) =>
      chain(...Array.from({ length: n }, (_, k) => k.toString(16).padStart(40, '0')));
    // Duplicates and order are passed as read (readiness judges them).
    const dup = [...many(100), ...many(100).slice(0, 20)];
    const d = await read({
      compare: (_b, _h, o) =>
        ok({
          total_commits: 120,
          behind_by: 0,
          commits: slice(dup, o),
          ...(o.page === 1 ? { files: FILES } : {}),
        }),
    });
    expect((d.compare as { commits: unknown[] }).commits).toHaveLength(120);
    // An empty page before total_commits is reached: stop, pass the short list.
    const short = await read({
      compare: (_b, _h, o) =>
        ok({
          total_commits: 150,
          behind_by: 0,
          commits: o.page === 1 ? slice(many(150), o) : [],
          ...(o.page === 1 ? { files: FILES } : {}),
        }),
    });
    expect((short.compare as { commits: unknown[]; totalCommits: number }).commits).toHaveLength(
      100,
    );
    expect(short.log.filter(([n]) => n === 'compare')).toHaveLength(2);
    // Cap: at most 10 pages.
    const big = await read({ compare: comparePages(many(2000)) });
    expect(big.log.filter(([n]) => n === 'compare')).toHaveLength(10);
    expect((big.compare as { commits: unknown[] }).commits).toHaveLength(1000);
    // A failed page: nothing partial.
    for (const failure of [NOT_FOUND, fail({ kind: 'timeout' }), fail({ kind: 'not-json' })]) {
      const f = await read({
        compare: (b, h, o) => (o.page === 2 ? failure : comparePages(many(150))(b, h, o)),
      });
      expect(f.compare).toBe('unreadable');
    }
    expect((await read({ compare: () => NOT_FOUND })).compare).toBe('unreadable');
  });

  test('F10 a push between page reads is passed as read', async () => {
    const first = chain(...Array.from({ length: 100 }, (_, k) => k.toString(16).padStart(40, '0')));
    const other = chain(OTHER, HEAD);
    const f = await read({
      compare: (_b, _h, o) =>
        ok({
          total_commits: 102,
          behind_by: 0,
          commits: o.page === 1 ? first : other,
          ...(o.page === 1 ? { files: FILES } : {}),
        }),
    });
    const c = f.compare as { commits: Array<{ sha: string }> };
    expect(c.commits.map((x) => x.sha)).toEqual([...first.map((x) => x.sha), OTHER, HEAD]);
  });

  test('F11 the required list: branch protection plus rulesets, null when either cannot be read', async () => {
    const required = async (over: Partial<Fake>) => (await read(over)).checks?.required;
    expect(await required({})).toEqual(['check', 'pr-evidence']);
    expect(await required({ branch: () => NOT_FOUND })).toBeNull();
    expect(
      await required({ branch: () => ok(branchBody({ protected: false, protection: undefined })) }),
    ).toEqual([]);
    expect(await required({ branch: () => ok(branchBody({ protection: undefined })) })).toBeNull();
    expect(await required({ branch: () => ok(branchBody({ protected: 'yes' })) })).toBeNull();
    expect(
      await required({ branch: () => ok(branchBody({ protection: { enabled: true } })) }),
    ).toEqual([]);
    // enforcement_level off: GitHub does not require them (code review, finding 7).
    expect(
      await required({
        branch: () =>
          ok(
            branchBody({
              protection: {
                required_status_checks: { enforcement_level: 'off', contexts: ['ci'] },
              },
            }),
          ),
      }),
    ).toEqual([]);
    expect(
      await required({
        branch: () =>
          ok(
            branchBody({
              protection: {
                required_status_checks: { enforcement_level: 'everyone', contexts: ['ci'] },
              },
            }),
          ),
      }),
    ).toEqual(['ci']);
    expect(
      await required({
        branch: () =>
          ok(branchBody({ protection: { required_status_checks: { contexts: ['ci'] } } })),
      }),
    ).toEqual(['ci']);
    expect(
      await required({
        branch: () =>
          ok(branchBody({ protection: { required_status_checks: { checks: [{ context: 7 }] } } })),
      }),
    ).toBeNull();
    const rules = [
      { type: 'deletion' },
      { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'check' }, { context: 'lint', integration_id: APP }],
        },
      },
    ];
    expect(await required({ rules: () => ok(rules) })).toEqual(['check', 'pr-evidence', 'lint']);
    for (const bad of [
      [null],
      [{ parameters: {} }],
      [{ type: 'required_status_checks' }],
      [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: '' }] },
        },
      ],
      [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'x', integration_id: 'a' }] },
        },
      ],
      { not: 'a list' },
    ]) {
      expect(await required({ rules: () => ok(bad) }), JSON.stringify(bad)).toBeNull();
    }
    expect(await required({ rules: () => NOT_FOUND })).toBeNull();
    // Paging: a full page asks for the next; five full pages is the cap (null, not a partial list).
    const full = Array.from({ length: 100 }, () => ({ type: 'deletion' }));
    const two = await read({ rules: (_n, o) => ok(o.page === 1 ? full : [rules[2]]) });
    expect(two.checks?.required).toEqual(['check', 'pr-evidence', 'lint']);
    expect(two.log.filter(([n]) => n === 'rules')).toHaveLength(2);
    const capped = await read({ rules: () => ok(full) });
    expect(capped.checks?.required).toBeNull();
    expect(capped.log.filter(([n]) => n === 'rules')).toHaveLength(5);
  });
});

describe('readGateGithubFacts: checks at the head (F12 to F15)', () => {
  test('F12 runs and the combined status by the head SHA; their SHAs come from the responses', async () => {
    const f = await read({
      checkRuns: runPages([run('check', { id: 1, head_sha: OTHER })]),
      combinedStatus: statusPages([], OTHER),
    });
    expect(f.log.filter(([n]) => n === 'checkRuns' || n === 'combinedStatus')).toEqual([
      ['checkRuns', HEAD, { filter: 'latest', page: 1, perPage: 100, etag: null }],
      ['combinedStatus', HEAD, { page: 1, perPage: 100, etag: null }],
    ]);
    expect(f.checks?.headSha).toBe(HEAD);
    expect(f.checks?.runs[0]?.headSha).toBe(OTHER);
    expect(f.checks?.statusSha).toBe(OTHER);
  });

  test('F13 paging runs and statuses; complete only when every page agrees and the count is reached', async () => {
    const runs = Array.from({ length: 150 }, (_, k) => run(`job ${k}`, { id: k + 1 }));
    const statuses = Array.from({ length: 150 }, (_, k) => status(`ctx/${k}`, 'success'));
    const f = await read({ checkRuns: runPages(runs), combinedStatus: statusPages(statuses) });
    expect(f.checks?.runs).toHaveLength(150);
    expect(f.checks?.statuses).toHaveLength(150);
    expect(f.checks?.complete).toBe(true);
    expect(f.log.filter(([n]) => n === 'checkRuns')).toHaveLength(2);
    expect(f.log.filter(([n]) => n === 'combinedStatus')).toHaveLength(2);
    // Short count (an empty page before total_count).
    expect((await read({ checkRuns: runPages(runs.slice(0, 100), 150) })).checks?.complete).toBe(
      false,
    );
    expect(
      (await read({ combinedStatus: statusPages(statuses.slice(0, 100), HEAD, 150) })).checks
        ?.complete,
    ).toBe(false);
    // A page whose total_count differs.
    const drift = (_s: string, o: { page: number; perPage: number }) =>
      ok({ total_count: o.page === 1 ? 150 : 151, check_runs: slice(runs, o) });
    expect((await read({ checkRuns: drift })).checks?.complete).toBe(false);
    // The cap: 10 pages of runs, 5 pages of statuses.
    const lots = Array.from({ length: 1200 }, (_, k) => run(`job ${k}`, { id: k + 1 }));
    const capped = await read({ checkRuns: runPages(lots) });
    expect(capped.checks?.complete).toBe(false);
    expect(capped.log.filter(([n]) => n === 'checkRuns')).toHaveLength(10);
    const lotsS = Array.from({ length: 600 }, (_, k) => status(`ctx/${k}`, 'success'));
    const cappedS = await read({ combinedStatus: statusPages(lotsS) });
    expect(cappedS.checks?.complete).toBe(false);
    expect(cappedS.log.filter(([n]) => n === 'combinedStatus')).toHaveLength(5);
    // A combined-status page at another commit: not one read.
    const shaDrift = (_s: string, o: { page: number; perPage: number }) =>
      ok({
        sha: o.page === 1 ? HEAD : OTHER,
        state: 'pending',
        total_count: 150,
        statuses: slice(statuses, o),
      });
    expect((await read({ combinedStatus: shaDrift })).checks).toBeNull();
  });

  test('F14 runs deduped per (app, name), newest id kept; a required check bound to an app is listed first', async () => {
    const f = await read({
      checkRuns: runPages([
        run('pr-evidence', { id: 9, conclusion: 'success' }),
        run('pr-evidence', { id: 5, conclusion: 'failure' }),
        run('check', { id: 3, app: { id: 1, slug: 'other' }, conclusion: 'success' }),
        run('check', { id: 4, conclusion: 'failure' }),
        run('lint', { id: 6, app: null }),
        run('lint', { id: 7, app: null, conclusion: 'failure' }),
      ]),
    });
    expect(f.checks?.runs.map((r) => [r.name, r.conclusion])).toEqual([
      ['pr-evidence', 'success'],
      ['check', 'failure'],
      ['check', 'success'],
      ['lint', 'failure'],
    ]);
    // Older first in the list, newer later: the newer still wins.
    const g = await read({
      checkRuns: runPages([
        run('pr-evidence', { id: 5, conclusion: 'failure' }),
        run('pr-evidence', { id: 9 }),
      ]),
    });
    expect(g.checks?.runs.map((r) => r.conclusion)).toEqual(['success']);
    // A ruleset binding (integration_id) orders the same way.
    const h = await read({
      rules: () =>
        ok([
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'lint', integration_id: 2 }] },
          },
        ]),
      checkRuns: runPages([
        run('lint', { id: 1, app: { id: 1 } }),
        run('lint', { id: 2, app: { id: 2 }, conclusion: 'failure' }),
      ]),
    });
    expect(h.checks?.runs.map((r) => r.conclusion)).toEqual(['failure', 'success']);
  });

  test('F15 malformed entries, case-insensitive contexts, the own status', async () => {
    for (const bad of [
      run('x', { head_sha: undefined }),
      run('x', { id: 'one' }),
      run('x', { name: 7 }),
      run('x', { status: null }),
      run('x', { conclusion: 7 }),
      run('x', { app: { id: 'a' } }),
      null,
    ]) {
      const f = await read({ checkRuns: runPages([bad]) });
      expect(f.checks, JSON.stringify(bad)).toBeNull();
    }
    expect((await read({ checkRuns: () => ok({ check_runs: [] }) })).checks).toBeNull();
    for (const bad of [
      status('x', 'success', { updated_at: undefined }),
      status('x', 'success', { updated_at: 'yesterday' }),
      status('x', 7 as unknown as string),
      { state: 'success', updated_at: '2026-10-22T10:00:00Z' },
    ]) {
      const f = await read({ combinedStatus: statusPages([bad]) });
      expect(f.checks, JSON.stringify(bad)).toBeNull();
      expect(f.ownStatus).toBe('unreadable');
    }
    const f = await read({
      combinedStatus: statusPages([
        status('CI/Build', 'failure', { updated_at: '2026-10-22T09:00:00Z' }),
        status('ci/build', 'success', { updated_at: '2026-10-22T10:00:00Z' }),
        status('tie', 'success'),
        status('TIE', 'pending'),
        status('Cairn/Merge-Gate', 'pending', { description: 'waiting' }),
      ]),
    });
    expect(f.checks?.statuses).toEqual([
      { context: 'ci/build', state: 'success' },
      { context: 'TIE', state: 'pending' },
      { context: 'Cairn/Merge-Gate', state: 'pending' },
    ]);
    expect(f.ownStatus).toEqual({ state: 'pending', description: 'waiting' });
    const none = await read();
    expect(none.ownStatus).toBeNull();
    // A status read that is not complete may have the gate's own status on an unread page: unreadable,
    // so the planner does not write blind (code review, finding 2).
    const partial = await read({ combinedStatus: statusPages([status('ci', 'success')], HEAD, 2) });
    expect(partial.checks?.complete).toBe(false);
    expect(partial.ownStatus).toBe('unreadable');
    const unreadable = await read({ combinedStatus: () => NOT_FOUND });
    expect(unreadable.checks).toBeNull();
    expect(unreadable.ownStatus).toBe('unreadable');
    expect(MERGE_GATE_STATUS_CONTEXT).toBe('cairn/merge-gate');
  });
});

describe('readGateGithubFacts: evidence presence (F16, F17)', () => {
  test('F16 only qualifying links are probed, at their own commit; stop at the first present; at most 5 probes', async () => {
    // A link at EARLIER (a commit of this PR) where the file did not exist yet.
    const early = await read({
      pull: () => ok(prBody({ body: `evidence: ${link(EARLIER)}` })),
      contents: (_path, ref) => (ref === EARLIER ? listing('other.png') : listing('shot.png')),
    });
    expect(early.evidence).toEqual([{ sha: EARLIER, path: SHOT, present: false }]);
    expect(early.log.filter(([n]) => n === 'contents')).toEqual([
      ['contents', 'docs/verify/1404', EARLIER],
    ]);
    // Links that do not qualify are not probed: another commit, a file the PR does not touch.
    const none = await read({
      pull: () =>
        ok(prBody({ body: `${link(MAIN)} ${link(HEAD, 'docs/verify/1404/untouched.png')}` })),
    });
    expect(none.evidence).toEqual([]);
    expect(names(none.log)).not.toContain('contents');
    // Stop after the first present one.
    const both = await read({ pull: () => ok(prBody({ body: `${link(HEAD)} ${link(EARLIER)}` })) });
    expect(both.evidence).toEqual([{ sha: HEAD, path: SHOT, present: true }]);
    // At most 5 (sha, directory) probes; links in the same directory at the same commit share one.
    const files = [
      ...FILES,
      ...Array.from({ length: 8 }, (_, k) =>
        ghFile(`docs/verify/1404/s${k}/f.png`, { status: 'added' }),
      ),
    ];
    const body = Array.from({ length: 8 }, (_, k) =>
      link(HEAD, `docs/verify/1404/s${k}/f.png`),
    ).join(' ');
    const capped = await read({
      pull: () => ok(prBody({ body, changed_files: files.length })),
      compare: comparePages(chain(EARLIER, HEAD), files),
      contents: () => listing('nothing.png'),
    });
    expect(capped.log.filter(([n]) => n === 'contents')).toHaveLength(5);
    // Links past the probe cap are unknown (null), not absent (code review, finding 4).
    expect(capped.evidence.map((e) => e.present)).toEqual([
      false,
      false,
      false,
      false,
      false,
      null,
      null,
      null,
    ]);
    const shared = await read({
      pull: () =>
        ok(
          prBody({
            body: `${link(HEAD, 'docs/verify/1404/a.png')} ${link(HEAD, 'docs/verify/1404/b.png')}`,
          }),
        ),
      compare: comparePages(chain(EARLIER, HEAD), [
        ...FILES,
        ghFile('docs/verify/1404/a.png'),
        ghFile('docs/verify/1404/b.png'),
      ]),
      contents: () => listing('b.png'),
    });
    expect(shared.log.filter(([n]) => n === 'contents')).toHaveLength(1);
    expect(shared.evidence).toEqual([
      { sha: HEAD, path: 'docs/verify/1404/a.png', present: false },
      { sha: HEAD, path: 'docs/verify/1404/b.png', present: true },
    ]);
  });

  test('F17 what a probe answer means; present is remembered for the commit, absent is not', async () => {
    const probe = async (contents: Fake['contents']) => (await read({ contents })).evidence;
    expect(await probe(() => NOT_FOUND)).toEqual([{ sha: HEAD, path: SHOT, present: false }]);
    for (const failure of [
      fail({ kind: 'status', status: 500, message: null }),
      fail({ kind: 'timeout' }),
      fail({ kind: 'network' }),
      fail({ kind: 'status', status: 403, message: null }),
    ]) {
      expect(await probe(() => failure)).toEqual([{ sha: HEAD, path: SHOT, present: null }]);
    }
    expect(await probe(() => ok({ type: 'file', name: 'shot.png' }))).toEqual([
      { sha: HEAD, path: SHOT, present: null },
    ]);
    expect(await probe(() => listing({ name: 'shot.png', type: 'dir' }))).toEqual([
      { sha: HEAD, path: SHOT, present: false },
    ]);
    expect(await probe(() => listing({ name: 'shot.png', type: 'symlink' }))).toEqual([
      { sha: HEAD, path: SHOT, present: false },
    ]);
    expect(await probe(() => listing({ name: 'shot.png', type: 'submodule' }))).toEqual([
      { sha: HEAD, path: SHOT, present: false },
    ]);
    expect(
      await probe(() =>
        ok([{ name: 'shot.png', type: 'file', path: 'docs/verify/1404/other/shot.png' }]),
      ),
    ).toEqual([{ sha: HEAD, path: SHOT, present: false }]);
    const thousand = Array.from({ length: 1000 }, (_, k) => `f${k}.png`);
    expect(await probe(() => listing(...thousand))).toEqual([
      { sha: HEAD, path: SHOT, present: null },
    ]);
    expect(await probe(() => listing(...thousand.slice(1), 'shot.png'))).toEqual([
      { sha: HEAD, path: SHOT, present: true },
    ]);
    // Remembered: a second evaluation with the same cache does not probe a present file again.
    const cache = newGateReadCache();
    await read({}, cache);
    const again = await read({ contents: () => NOT_FOUND }, cache);
    expect(names(again.log)).not.toContain('contents');
    expect(again.evidence).toEqual([{ sha: HEAD, path: SHOT, present: true }]);
    // Absent is not remembered.
    const c2 = newGateReadCache();
    await read({ contents: () => NOT_FOUND }, c2);
    const later = await read({}, c2);
    expect(later.evidence).toEqual([{ sha: HEAD, path: SHOT, present: true }]);
  });
});

describe('readGateGithubFacts: rate limits, throws, concurrency (F18)', () => {
  test('F18 a rate-limited read stops the evaluation; retryAt prefers retry-after', async () => {
    const limited = (retryAfterSeconds: number | null, resetAt: number | null) =>
      fail({ kind: 'rate-limited', status: 403, resetAt, retryAfterSeconds });
    const f = await read({ branch: () => limited(30, 9_999_999) });
    expect(names(f.log)).toEqual(['pull', 'branch']);
    expect(f.rateLimited).toEqual({ retryAt: REQ.now + 30_000 });
    expect(f.compare).toBe('unreadable');
    expect(f.checks).toBeNull();
    expect(f.ownStatus).toBe('unreadable');
    expect((await read({ pull: () => limited(null, 5_000_000) })).rateLimited).toEqual({
      retryAt: 5_000_000,
    });
    expect((await read({ checkRuns: () => limited(null, null) })).rateLimited).toEqual({
      retryAt: null,
    });
    const c = await read({ contents: () => limited(10, null) });
    expect(c.rateLimited).toEqual({ retryAt: REQ.now + 10_000 });
    expect(c.evidence).toEqual([{ sha: HEAD, path: SHOT, present: null }]);
  });

  test('F18 a port that throws is a failed read, never a throw out of the shell', async () => {
    const g = fakeGithub();
    const throwing: GateGithubPort = {
      ...g.port,
      checkRuns: () => Promise.reject(new TypeError('boom')),
      compare: () => {
        throw new Error('sync');
      },
    };
    const f = await readGateGithubFacts(throwing, REQ, newGateReadCache());
    expect(f.checks).toBeNull();
    expect(f.compare).toBe('unreadable');
    expect(f.pr).toEqual({ ...GREEN_PR, baseBehindBy: null });
  });
});

describe('readGateGithubFacts into mergeReadiness: a truncated compare (pr-gate run 1 on #1525, suggestion 3)', () => {
  test('300 files on page 1 and changed_files 301: compare-truncated, a human blocker, no digest', async () => {
    const files = Array.from({ length: 300 }, (_, k) => ghFile(`apps/server/src/f${k}.ts`));
    const f = await read({
      pull: () => ok(prBody({ changed_files: 301 })),
      compare: comparePages(chain(EARLIER, HEAD), files),
    });
    expect((f.compare as { files: unknown[] }).files).toHaveLength(300);
    expect(f.pr?.changedFiles).toBe(301);
    const r = mergeReadiness({
      policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
      build: { isGithubPr: true, isCurrent: true, phase: 'review', stepsInFlight: 0 },
      repo: { owner: REQ.owner, name: REQ.repo, defaultBranch: f.defaultBranch },
      ticketRef: REQ.ticketRef,
      issueNumber: 1404,
      pr: f.pr,
      checks: f.checks,
      compare: f.compare,
      evidence: f.evidence,
      verdicts: [],
      round: null,
      availability: { reviewerPerspectives: ['correctness'], verifier: true, decider: true },
    });
    expect(r.ready).toBe(false);
    expect(r.patchDigest).toBeNull();
    expect(r.blockers.find((b) => b.code === 'compare-truncated')).toMatchObject({
      class: 'human',
      detail: ['truncated'],
    });
  });
});

describe('readGateGithubFacts P4-0 base freshness', () => {
  test.each([0, 3, null, -1, '0'])('projects behind_by %s into the PR', async (behind) => {
    const f = await read({
      compare: comparePages(chain(EARLIER, HEAD), FILES, { behind_by: behind }),
    });
    expect(f.pr?.baseBehindBy).toBe(behind === 0 || behind === 3 ? behind : null);
  });
});
