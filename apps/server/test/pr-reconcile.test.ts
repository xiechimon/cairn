import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { conversationBranch, type Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  type QuotaWaitRow,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { githubBranchPulls, githubCompareStatus, githubPull } from '../src/lib/github.js';
import {
  applyBuildStepAction,
  completeStep,
  finishTodoDone,
  requestMerge,
} from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { DONE_ROW } from '../src/services/delivery-rows.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { updateTodo } from '../src/services/todos.js';
import { bootServer, type TestServer } from './helpers.js';

const globalFetch = vi.fn(() => Promise.reject(new Error('Unexpected global fetch')));
beforeEach(() => {
  globalFetch.mockClear();
  vi.stubGlobal('fetch', globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(globalFetch).not.toHaveBeenCalled();
});

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function res(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

interface PullSpec {
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha?: string | null;
  mergedBy?: string;
  headSha?: string;
  compare?: string | number | 'throw';
  mergedAt?: string | null;
  closedAt?: string | null;
  baseRef?: string;
  defaultBranch?: string;
  noBase?: boolean;
  noBaseRef?: boolean;
  noDefaultBranch?: boolean;
  noHead?: boolean;
  noHeadSha?: boolean;
  headRef?: string;
  headRepo?: string | null;
  headRepoId?: number;
  baseRepo?: string;
  baseOwner?: string;
  noBaseRepoId?: boolean;
  noMerged?: boolean;
  compareByBase?: Record<string, string>;
}

const REPO_ID = 4242;

const headRefs = new Map<number, string>();

interface BranchPullSpec {
  number: number;
  state?: 'open' | 'closed';
  merged?: boolean;
  headRef?: string;
  headRepoId?: number | null;
  baseRef?: string;
  baseRepoId?: number;
  htmlUrl?: string;
  authorAssociation?: string | null;
}

class PullsMock {
  readonly gateFetch = vi.fn((input: string | URL, init?: { headers?: Record<string, string> }) =>
    this.respond(input, init),
  );
  requests: string[] = [];
  headers: Record<string, string>[] = [];
  throwNext = false;
  onCompare: (() => void) | null = null;
  branchPulls: BranchPullSpec[] | number | 'throw' = [];
  onList: (() => void) | null = null;
  listRequests = () => this.requests.filter((u) => /\/pulls\?/.test(u));
  checkRuns = false;
  status304 = true;
  delayMs = 0;
  compareRequests = () => this.requests.filter((u) => u.includes('/compare/'));
  constructor(
    readonly pulls: Record<number, PullSpec>,
    private readonly status = 200,
  ) {}

  readonly fetch = (
    input: string | URL,
    init?: { headers?: Record<string, string> },
  ): Promise<ReturnType<typeof res>> => {
    this.requests.push(String(input));
    this.headers.push({ ...(init?.headers ?? {}) });
    return this.respond(input, init);
  };

  private readonly respond = (
    input: string | URL,
    init?: { headers?: Record<string, string> },
  ): Promise<ReturnType<typeof res>> => {
    if (this.delayMs > 0) {
      const wait = this.delayMs;
      this.delayMs = 0;
      return new Promise<void>((r) => setTimeout(r, wait)).then(() => this.respond(input, init));
    }
    const url = String(input);
    if (this.throwNext) {
      this.throwNext = false;
      return Promise.reject(new TypeError('fetch failed'));
    }
    if (this.status304 && (init?.headers?.['if-none-match'] ?? '') === '"x"') {
      return Promise.resolve(res(304, '"x"', {}));
    }
    const cmp = url.match(/\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)(?:\?.*)?$/);
    if (cmp !== null) {
      this.onCompare?.();
      const spec = Object.values(this.pulls).find((p) => (p.headSha ?? 'f'.repeat(40)) === cmp[2]);
      const status = spec?.compareByBase?.[cmp[1] ?? ''] ?? spec?.compare ?? 'identical';
      if (status === 'throw') return Promise.reject(new TypeError('fetch failed'));
      if (typeof status === 'number') return Promise.resolve(res(status, '"c"', {}));
      return Promise.resolve(res(200, '"c"', { status }));
    }
    if (/\/rules\/branches\//.test(url)) return Promise.resolve(res(200, '"r"', []));
    if (/\/branches\/[^/?]+$/.test(url)) {
      return Promise.resolve(res(200, '"b"', { name: 'main', protected: false }));
    }
    if (url.includes('/check-runs')) {
      if (!this.checkRuns) return Promise.resolve(res(404, '"x"', {}));
      return Promise.resolve(
        res(200, '"x"', {
          total_count: 1,
          check_runs: [{ name: 'ci', status: 'in_progress', conclusion: null }],
        }),
      );
    }
    if (/\/pulls\?/.test(url)) {
      this.onList?.();
      const list = this.branchPulls;
      if (list === 'throw') return Promise.reject(new TypeError('fetch failed'));
      if (typeof list === 'number') return Promise.resolve(res(list, '"l"', []));
      const listedAt = new Date().toISOString();
      return Promise.resolve(
        res(
          200,
          '"l"',
          list.map((p) => ({
            number: p.number,
            state: p.state ?? 'open',
            merged_at: p.merged === true ? listedAt : null,
            html_url: p.htmlUrl ?? `https://github.com/octo/demo/pull/${p.number}`,
            ...(p.authorAssociation === null
              ? {}
              : { author_association: p.authorAssociation ?? 'OWNER' }),
            head: {
              ref: p.headRef ?? headRefs.get(p.number) ?? '',
              repo: p.headRepoId === null ? null : { id: p.headRepoId ?? REPO_ID },
            },
            base: { ref: p.baseRef ?? 'main', repo: { id: p.baseRepoId ?? REPO_ID } },
          })),
        ),
      );
    }
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null) return Promise.resolve(res(404, '"x"', {}));
    const spec = this.pulls[Number(m[1])];
    if (spec === undefined) return Promise.resolve(res(404, '"x"', {}));
    const at = new Date().toISOString();
    return Promise.resolve(
      res(this.status, '"x"', {
        number: Number(m[1]),
        state: spec.state,
        ...(spec.noMerged ? {} : { merged: spec.merged }),
        merge_commit_sha: spec.mergeCommitSha ?? null,
        merged_by: spec.mergedBy === undefined ? null : { login: spec.mergedBy },
        head: spec.noHead
          ? null
          : {
              ...(spec.noHeadSha ? {} : { sha: spec.headSha ?? 'f'.repeat(40) }),
              ref: spec.headRef ?? headRefs.get(Number(m[1])) ?? '',
              repo:
                spec.headRepo === null
                  ? null
                  : { id: spec.headRepoId ?? REPO_ID, full_name: spec.headRepo ?? 'octo/demo' },
            },
        merged_at: spec.merged ? (spec.mergedAt === undefined ? at : spec.mergedAt) : null,
        closed_at:
          spec.state === 'closed' ? (spec.closedAt === undefined ? at : spec.closedAt) : null,
        base: spec.noBase
          ? undefined
          : {
              ...(spec.noBaseRef ? {} : { ref: spec.baseRef ?? 'main' }),
              repo: {
                ...(spec.noBaseRepoId ? {} : { id: REPO_ID }),
                full_name: spec.baseRepo ?? 'octo/demo',
                ...(spec.baseOwner === undefined ? {} : { owner: { login: spec.baseOwner } }),
                ...(spec.noDefaultBranch ? {} : { default_branch: spec.defaultBranch ?? 'main' }),
              },
            },
      }),
    );
  };
}

interface World {
  s: TestServer;
  projectId: string;
  todoId: string;
  buildId: string;
  prNumber: number;
  todoRow(): { phase: string; phaseAt: number };
  buildRow(): { errorMessage: string | null; prNumber: number | null; prUrl: string | null };
  systemRows(): string[];
  stepRows(): { kind: string; status: string }[];
}

function makeWorld(
  opts: {
    phase?: Phase;
    prNumber?: number;
    olderClosedPr?: number;
    newerBuildPr?: number | null;
    inflight?: 'pending' | 'claimed' | 'waiting_quota';
    inflightKind?: 'merge' | 'verify' | 'review';
    checkpoint?: string;
    checkpoints?: string[];
    phaseAt?: number;
    connected?: boolean;
    githubRepo?: string;
    repoKind?: 'github' | 'local';
  } = {},
): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const projectId = `proj-rec-${rnd}`;
  const todoId = `todo-rec-${rnd}`;
  const buildId = `build-rec-${rnd}`;
  const prNumber = opts.prNumber ?? 201;
  headRefs.clear();
  if (opts.olderClosedPr !== undefined) {
    headRefs.set(opts.olderClosedPr, conversationBranch(`build-old-${rnd}`));
  }
  headRefs.set(prNumber, conversationBranch(buildId));
  if (typeof opts.newerBuildPr === 'number') {
    headRefs.set(opts.newerBuildPr, conversationBranch(`build-new-${rnd}`));
  }
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId: s.team.id,
      repoKind: opts.repoKind ?? 'github',
      githubRepo: opts.repoKind === 'local' ? null : (opts.githubRepo ?? 'octo/demo'),
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'reconcile target',
      spec: 'do it',
      phase: opts.phase ?? 'review',
      phaseAt: opts.phaseAt ?? base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-rec-${rnd}` } },
    })
    .run();
  if (opts.olderClosedPr !== undefined) {
    s.db
      .insert(buildTable)
      .values({
        id: `build-old-${rnd}`,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 600_000,
        prUrl: `https://github.com/octo/demo/pull/${opts.olderClosedPr}`,
        prNumber: opts.olderClosedPr,
      })
      .run();
  }
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 60_000,
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  let latestBuildId = buildId;
  if (opts.newerBuildPr !== undefined) {
    latestBuildId = `build-new-${rnd}`;
    s.db
      .insert(buildTable)
      .values({
        id: latestBuildId,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 1_000,
        prUrl:
          opts.newerBuildPr === null
            ? null
            : `https://github.com/octo/demo/pull/${opts.newerBuildPr}`,
        prNumber: opts.newerBuildPr,
      })
      .run();
  }
  s.db.update(todoTable).set({ latestBuildId }).where(eq(todoTable.id, todoId)).run();
  if (opts.inflight !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-merge-${rnd}`,
        buildId,
        kind: opts.inflightKind ?? 'merge',
        status: opts.inflight,
        createdAt: base,
      })
      .run();
  }
  if (opts.checkpoint !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-build-${rnd}`,
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: opts.checkpoint,
        createdAt: base - 30_000,
      })
      .run();
  }
  for (const [k, commit] of (opts.checkpoints ?? []).entries()) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-build-${k}-${rnd}`,
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: commit,
        createdAt: base - 50_000 + k * 10_000,
      })
      .run();
  }
  if (opts.connected === true) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'gho_test', scope: 'read:user repo' },
    );
  }
  return {
    s,
    projectId,
    todoId,
    buildId,
    prNumber,
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
    buildRow: () => s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!,
    systemRows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .filter((r) => r.role === 'system')
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
    stepRows: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .map((r) => ({ kind: r.kind, status: r.status })),
  };
}

function pollerFor(
  w: World,
  mock: PullsMock,
  opts: { anonReadsPerHour?: number; anonIpReadsPerHour?: number } = {},
) {
  return createCiPoller(
    { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
    { githubFetch: mock.fetch, ...opts },
  );
}

async function sweepTwice(poller: ReturnType<typeof pollerFor>, t0 = Date.now()): Promise<void> {
  await poller.sweep(t0);
  await poller.sweep(t0 + 300_000);
}

const QUOTA_BLOCK: QuotaWaitRow = {
  kind: 'quota',
  providerId: 'relay',
  label: 'Relay',
  reason: '402: quota exceeded',
  retryAfterMs: null,
  firstSeenAt: 0,
  lastAt: 0,
  attempts: 1,
  probeAt: 0,
};

function addReviewCard(w: World, prNumber: number): void {
  const id = `${w.todoId}-${prNumber}`;
  headRefs.set(prNumber, conversationBranch(`b-${id}`));
  w.s.db
    .insert(todoTable)
    .values({
      id,
      teamId: w.s.team.id,
      projectId: w.projectId,
      title: `card ${prNumber}`,
      spec: 'do it',
      phase: 'review',
      phaseAt: Date.now(),
      seqNum: prNumber,
      assignment: { plan: null, build: null },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: `b-${id}`,
      todoId: id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  w.s.db
    .update(todoTable)
    .set({ latestBuildId: `b-${id}` })
    .where(eq(todoTable.id, id))
    .run();
}

describe('#1403 PR reconcile for review-phase builds', () => {
  test('authenticated sweeps keep merge-gate reads on the injected transport', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(mock.gateFetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/octo/demo/pulls/${w.prNumber}`,
      expect.anything(),
    );
    expect(mock.requests.filter((url) => url.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
  });

  test('① merged on GitHub → todo done, merge sha in a system row, celebration row', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def5678' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    const rows = w.systemRows();
    expect(rows.some((c) => c.includes(`#${w.prNumber}`) && c.includes('abc1234'))).toBe(true);
    expect(rows).toContain(DONE_ROW);
    expect(mock.requests.some((u) => u.endsWith(`/repos/octo/demo/pulls/${w.prNumber}`))).toBe(
      true,
    );
  });

  test('② closed without merge → todo failed with the cause on the build', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    await poller.sweep(t0 + 300_000);
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage ?? '').toContain(`#${w.prNumber}`);
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test('③ still open → nothing changes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.systemRows()).toEqual([]);
  });

  test.each([429, 404, 502])('④ unreadable (%i) → nothing changes', async (status) => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } }, status);
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑤ phase moved by a person during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL) => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
      return mock.fetch(input);
    };
    await createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: racing },
      { githubFetch: racing },
    ).sweep();
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑥ an older PR build of the same todo is closed, the latest PR is open → nothing changes', async () => {
    const w = makeWorld({ olderClosedPr: 150 });
    const mock = new PullsMock({
      150: { state: 'closed', merged: false },
      [w.prNumber]: { state: 'open', merged: false },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests.some((u) => u.endsWith('/pulls/150'))).toBe(false);
  });

  test('⑦ after done, a second sweep does not touch the todo again', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    const requestsAfterFirst = mock.requests.length;
    const rowsAfterFirst = w.systemRows().length;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(mock.requests.length).toBe(requestsAfterFirst);
    expect(w.systemRows().length).toBe(rowsAfterFirst);
  });

  test("⑧a the todo's current build has no PR; an older build's PR merged → nothing changes", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test("⑧b the todo's current build has no PR; an older build's PR closed → not failed", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test("⑨a two builds record one PR whose head is the current build's branch → read once, through the current build; rows land on it only", async () => {
    const w = makeWorld({ newerBuildPr: 201 });
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.filter((u) => u.endsWith('/pulls/201'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows()).toEqual([]);
    const current = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId !== w.buildId)
      .map((r) => String(r.content));
    expect(current.some((c) => c.startsWith('PR #201 已在 GitHub 合并'))).toBe(true);
  });

  test("⑨b a second build records the PR the older build opened (its head is the older build's branch, #1217 / #1195) → foreign: stays in review, one hint, no merged row", async () => {
    const w = makeWorld({ newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, w.todoId))
      .get()?.latestBuildId;
    expect(currentBuildId).not.toBe(w.buildId);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    );
    await poller.sweep();
    await poller.sweep(Date.now() + 300_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/201'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    const current = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
      .map((r) => String(r.content));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('PR #201');
    expect(current[0]).toContain(conversationBranch(String(currentBuildId)));
    expect(current.some((c) => c.startsWith('PR #201 已在 GitHub 合并'))).toBe(false);
    expect(current).not.toContain(DONE_ROW);
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally).toMatchObject({ reviewForeign: 1, merged: 0 });
  });

  test('⑩a a merge step in flight → reconcile does not step in', async () => {
    const w = makeWorld({ inflight: 'claimed' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test('⑪ anonymous: a candidate is read at most once per five minutes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(mock.requests).toHaveLength(1);
    await poller.sweep(t0 + 300_001);
    expect(mock.requests).toHaveLength(2);
  });

  test('⑫a connected: the second read is conditional and a 304 changes nothing', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    expect(mock.requests).toHaveLength(2);
    expect(mock.headers[1]?.['if-none-match']).toBe('"x"');
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑫b a thrown network error → nothing changes; the next sweep reads again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.throwNext = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑬ the merge row names who merged', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedBy: 'octocat',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.systemRows().some((c) => c.includes('abc1234') && c.includes('octocat'))).toBe(true);
  });

  test.each([['behind'], ['diverged']] as const)(
    '⑭a merged, but compare says %s: the checkpoint is not in the merged head → stays in review with a hint',
    async (compare) => {
      const w = makeWorld({ checkpoint: 'a'.repeat(40) });
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234', compare },
      });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(
        w.systemRows().some((c) => c.includes('aaaaaaa') && c.includes(`#${w.prNumber}`)),
      ).toBe(true);
      expect(w.systemRows()).not.toContain(DONE_ROW);
      expect(w.systemRows().some((c) => c.includes('重启任务'))).toBe(false);
    },
  );

  test('⑭b merged at a head built on top of the checkpoint (update-branch) → done', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234', compare: 'ahead' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑭c the checkpoint commit is unknown to GitHub (never pushed) → stays in review with a hint; once it is there, done', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 404 },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('aaaaaaa'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('GitHub 上找不到');
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) spec.compare = 'ahead';
    const t0 = Date.now();
    await poller.sweep(t0 + 60_000);
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑮a a merge step waiting for quota counts as in flight', async () => {
    const w = makeWorld({ inflight: 'waiting_quota' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
  });

  test.each(['verify', 'review'] as const)(
    '⑮c a %s step waiting for quota does not hold the reconcile and is stopped on finish',
    async (inflightKind) => {
      const w = makeWorld({ inflight: 'waiting_quota', inflightKind });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
      expect(w.stepRows().filter((r) => r.kind === inflightKind)).toEqual([
        { kind: inflightKind, status: 'stopped' },
      ]);
    },
  );

  test.each(['verify', 'review'] as const)(
    '⑮b an unclaimed %s step does not hold the reconcile',
    async (inflightKind) => {
      const w = makeWorld({ inflight: 'pending', inflightKind });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test.each([
    ['merged', true],
    ['closed', false],
  ] as const)(
    '⑳ %s: unclaimed verify / review steps are stopped when the reconcile finishes',
    async (_label, merged) => {
      const w = makeWorld({ inflight: 'pending', inflightKind: 'review' });
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-verify-${w.buildId}`,
          buildId: w.buildId,
          kind: 'verify',
          status: 'pending',
          createdAt: Date.now(),
        })
        .run();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged } });
      await sweepTwice(pollerFor(w, mock));
      expect(w.todoRow().phase).toBe(merged ? 'done' : 'failed');
      expect(w.stepRows().filter((r) => r.kind === 'review' || r.kind === 'verify')).toEqual([
        { kind: 'review', status: 'stopped' },
        { kind: 'verify', status: 'stopped' },
      ]);
      if (merged) expect(w.buildRow().errorMessage).toBeNull();
    },
  );

  test('⑯ the todo gets a new current build during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
      w.s.db
        .update(todoTable)
        .set({ latestBuildId: 'build-elsewhere' })
        .where(eq(todoTable.id, w.todoId))
        .run();
      return mock.fetch(input, init);
    };
    await createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: racing },
      { githubFetch: racing },
    ).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑱a reopened done→review after the reconcile finished it → not finished again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    w.s.db
      .update(todoTable)
      .set({ phaseAt: Date.now() - 60_000, hasChanges: true })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep();
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const rows = w.systemRows();
    expect(rows.filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toHaveLength(1);
    expect(rows.filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('⑱b merged before the card reached review (auto-merge the moment CI went green) → done', async () => {
    const w = makeWorld({ phaseAt: Date.now() });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedAt: new Date(Date.now() - 120_000).toISOString(),
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`)),
    ).toHaveLength(1);
  });

  test('⑱c reopened done→review after the merge step finished it → not finished again', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
    expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toBe(
      false,
    );
  });

  test('⑱d closed→review drag after the reconcile failed it → stays in review, errorMessage kept', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: false,
        closedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    w.s.db
      .update(todoTable)
      .set({ phaseAt: Date.now() - 60_000 })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const poller = pollerFor(w, mock);
    await sweepTwice(poller);
    expect(w.todoRow().phase).toBe('failed');
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'person note' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    const listsBefore = mock.listRequests().length;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBe('person note');
    await poller.sweep(Date.now() + 600_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBe('person note');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
    expect(mock.listRequests()).toHaveLength(listsBefore);
  });

  test('⑲ merged into a branch other than the default branch → stays in review, one hint', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'feature-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('feature-x'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('「feature-x」');
    expect(hints[0]).toContain('main');
  });

  test('㉑ the hint path reads compare once per (checkpoint, head) and writes the hint once', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'diverged' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    await poller.sweep();
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.systemRows().filter((c) => c.includes('aaaaaaa'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
  });

  test.each([429, 502, 'throw'] as const)(
    '㉒ compare unreadable (%s) → not finished; a later sweep reads compare again',
    async (compare) => {
      const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare } });
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并（`))).toBe(
        false,
      );
      const spec = mock.pulls[w.prNumber];
      if (spec !== undefined) spec.compare = 'ahead';
      await poller.sweep(t0 + 600_001);
      expect(mock.compareRequests()).toHaveLength(2);
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test('㉓ phase moved by a person while compare is in flight → no write', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    mock.onCompare = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    await pollerFor(w, mock).sweep();
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('㉔ several build steps: the last one to finish decides', async () => {
    const older = 'a'.repeat(40);
    const newer = 'b'.repeat(40);
    const w = makeWorld({ checkpoints: [older, newer] });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        compareByBase: { [older]: 'identical', [newer]: 'diverged' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${newer}...`);
    expect(w.systemRows().some((c) => c.includes('bbbbbbb'))).toBe(true);
  });

  test("㉔b a verify step created in an earlier round finishes after this round's build step → its pushed commit is the one checked", async () => {
    const c1 = 'a'.repeat(40);
    const c2 = 'b'.repeat(40);
    const c3 = 'c'.repeat(40);
    const w = makeWorld();
    const t = Date.now();
    const steps = [
      { id: 'b1', kind: 'build', commit: c1, createdAt: t - 50_000, beat: t - 45_000 },
      { id: 'v', kind: 'verify', commit: c3, createdAt: t - 40_000, beat: t - 2_000 },
      { id: 'p', kind: 'plan', commit: null, createdAt: t - 30_000, beat: t - 25_000 },
      { id: 'b2', kind: 'build', commit: c2, createdAt: t - 20_000, beat: t - 10_000 },
    ] as const;
    for (const s of steps) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${s.id}-${w.buildId}`,
          buildId: w.buildId,
          kind: s.kind,
          status: 'done',
          checkpointCommit: s.commit,
          createdAt: s.createdAt,
          claimedAt: s.beat - 3_000,
          lastHeartbeatAt: s.beat,
        })
        .run();
    }
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        headSha: c2,
        compareByBase: { [c3]: 'behind' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()).toHaveLength(1);
    expect(mock.compareRequests()[0]).toContain(`/compare/${c3}...${c2}`);
    expect(w.systemRows().some((c) => c.includes('ccccccc') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
    expect(w.systemRows()).not.toContain(DONE_ROW);
  });

  test('㉕ a checkpoint that is not a 40-hex sha is not put into a request URL', async () => {
    const w = makeWorld({ checkpoint: '../../user' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.some((u) => u.includes('/compare/'))).toBe(false);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toHaveLength(1);
    expect(w.systemRows()[0]).not.toContain('../../user');
  });

  test('㉖ requestMerge: the reconcile finishes the card during the PR probe → no merge step', async () => {
    const w = makeWorld({ olderClosedPr: 150 });
    const probe = (input: string | URL) => {
      w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
      const url = String(input);
      return Promise.resolve(
        res(200, '"p"', { number: Number(url.split('/').at(-1)), state: 'open', merged: false }),
      );
    };
    await expect(requestMerge({ ...w.s.svc, githubFetch: probe }, w.buildId)).rejects.toThrow(
      'illegal phase transition: done -> done',
    );
    expect(w.stepRows().filter((r) => r.kind === 'merge')).toEqual([]);
  });

  test('㉖b AI review: the reconcile finishes the card while the changes are read → no review step', async () => {
    const w = makeWorld();
    const pending = applyBuildStepAction({ ...w.s.svc, reposDir: '/nonexistent' }, w.buildId, {
      action: 'review',
      agentId: 'agent-x',
    });
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    await expect(pending).rejects.toThrow('读取变更期间任务相位已变为 done');
    expect(w.stepRows().filter((r) => r.kind === 'review')).toEqual([]);
    const announced = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, w.buildId))
      .all()
      .filter((r) => r.role === 'user');
    expect(announced).toEqual([]);
  });

  test('⑱e dragged to done by hand before the reconcile saw the merge, then back to review → the merge is reported once', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`)),
    ).toHaveLength(1);
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('⑱f closed by hand, then back to review → the close is reported once', async () => {
    const w = makeWorld({ connected: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    await sweepTwice(poller);
    expect(w.todoRow().phase).toBe('failed');
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(Date.now() + 600_000);
    expect(w.todoRow().phase).toBe('review');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test('㉚ merged, the response has no head sha, the build has a checkpoint → not finished', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, noHeadSha: true },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()).toEqual([]);
    expect(w.systemRows()).toEqual([]);
  });

  test.each([
    ['base', { noBase: true }],
    ['base.ref', { noBaseRef: true }],
    ['default_branch', { noDefaultBranch: true }],
  ] as const)(
    '㉗ a merged response without %s is not taken as a merge into the default branch',
    async (_label, missing) => {
      const w = makeWorld();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, ...missing } });
      const info = vi.fn();
      await createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
        { githubFetch: mock.fetch, logger: { info } },
      ).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows()).toEqual([]);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewUnreadable).toBe(1);
    },
  );

  test.each(['pulls', 'compare'] as const)(
    '㉘ a merge step starts while the %s read is in flight → no write',
    async (at) => {
      const w = makeWorld(at === 'compare' ? { checkpoint: 'a'.repeat(40) } : {});
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
      });
      const startMerge = () =>
        w.s.db
          .insert(stepTable)
          .values({
            id: `step-m-${at}-${w.buildId}`,
            buildId: w.buildId,
            kind: 'merge',
            status: 'pending',
            createdAt: Date.now(),
          })
          .run();
      const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
        if (at === 'pulls' && String(input).includes('/pulls/')) startMerge();
        return mock.fetch(input, init);
      };
      if (at === 'compare') mock.onCompare = startMerge;
      await createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: racing },
        { githubFetch: racing },
      ).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows()).toEqual([]);
    },
  );

  test('㉘c while compare is in flight the merge step finishes the card and a person reopens it → not finished again', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    mock.onCompare = () => {
      finishTodoDone(w.s.svc, w.todoId, w.buildId);
      updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    };
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
    expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toBe(
      false,
    );
  });

  test('㉜ a PR that leaves review drops its cache rows; back in review, the first read has no etag', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    expect(mock.requests).toHaveLength(2);
    expect(mock.headers[1]?.['if-none-match']).toBeUndefined();
  });

  test("㉝ a #931 rework round on the same build: the last round's close does not hide this round's", async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    await sweepTwice(poller);
    expect(w.todoRow().phase).toBe('failed');
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-rework-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        createdAt: Date.now() + 1,
      })
      .run();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await new Promise((r) => setTimeout(r, 5));
    await sweepTwice(poller, Date.now() + 600_000);
    expect(w.todoRow().phase).toBe('failed');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(2);
  });

  test('㉞ marked done by hand while the PR was open, reopened, then merged → finished', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) {
      spec.state = 'closed';
      spec.merged = true;
    }
    mock.status304 = false;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('㉟ the merge step reports done after a person marked the card done: only the step is recorded, no completion row', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mergeStepId = `step-merge-late-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: mergeStepId,
        buildId: w.buildId,
        kind: 'merge',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    completeStep(w.s.svc, mergeStepId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'merge')?.status).toBe('done');
    expect(w.systemRows()).toEqual([]);
  });

  test('㊱ a sweep that starts while the last one runs does nothing', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.delayMs = 30;
    const poller = pollerFor(w, mock);
    await Promise.all([poller.sweep(), poller.sweep()]);
    expect(mock.requests.filter((u) => u.includes('/pulls/'))).toHaveLength(1);
  });

  test('㊲ a PR that leaves the grind drops its check-runs cache row', async () => {
    const w = makeWorld({ connected: true, phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.checkRuns = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    const reads = mock.headers.filter((_, i) => mock.requests[i]?.includes('/check-runs'));
    expect(reads).toHaveLength(2);
    expect(reads[1]?.['if-none-match']).toBeUndefined();
  });

  test('㊳ a githubRepo that is not owner/repo → no request', async () => {
    const w = makeWorld({ githubRepo: 'nodash' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests).toEqual([]);
    expect(w.todoRow().phase).toBe('review');
  });

  test.each(['../user', 'octo/..', './demo'])(
    '㊳b githubRepo %s with a dot segment (#1466) → no request',
    async (githubRepo) => {
      const w = makeWorld({ githubRepo });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(mock.requests).toEqual([]);
      expect(w.todoRow().phase).toBe('review');
    },
  );

  test('㊴ anonymous: reads across all PRs stay under a per-hour budget', async () => {
    const w = makeWorld();
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      301: { state: 'open', merged: false },
      302: { state: 'open', merged: false },
    });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(mock.requests).toHaveLength(2);
    await poller.sweep(t0 + 300_001);
    expect(mock.requests).toHaveLength(2);
    await poller.sweep(t0 + 3_600_001);
    expect(mock.requests.length).toBeGreaterThan(2);
  });

  test('㊵ the newest done build step reported no checkpoint → the last reported one is checked', async () => {
    const pushed = 'c'.repeat(40);
    const w = makeWorld({ checkpoints: [pushed] });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-nocp-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: null,
        createdAt: Date.now(),
      })
      .run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compareByBase: { [pushed]: 'diverged' } },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${pushed}...`);
    expect(w.systemRows().some((c) => c.includes('ccccccc'))).toBe(true);
  });

  test('㊶ a grind candidate skipped for an in-flight step keeps its check-runs cache row', async () => {
    const w = makeWorld({ connected: true, phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.checkRuns = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-fix-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    await poller.sweep();
    w.s.db
      .update(stepTable)
      .set({ status: 'done' })
      .where(eq(stepTable.id, `step-fix-${w.buildId}`))
      .run();
    await poller.sweep();
    const reads = mock.headers.filter((_, i) => mock.requests[i]?.includes('/check-runs'));
    expect(reads).toHaveLength(2);
    expect(reads[1]?.['if-none-match']).toBe('"x"');
  });

  test('㊷ a #931 rework round gets the same hint again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-rework-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        createdAt: Date.now() + 1,
      })
      .run();
    await new Promise((r) => setTimeout(r, 5));
    await poller.sweep();
    expect(w.systemRows().filter((c) => c.includes('「release-x」'))).toHaveLength(2);
  });

  test('㊸ compare unreadable: not read again within ten minutes; a hint after the second failure', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.systemRows().filter((c) => c.includes('compare'))).toHaveLength(0);
    await poller.sweep(t0 + 60_000);
    expect(mock.compareRequests()).toHaveLength(1);
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c.includes('compare'))).toHaveLength(1);
  });

  test('㊹ anonymous: the budget goes to the PR read longest ago, so every card gets its turn', async () => {
    const w = makeWorld();
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      301: { state: 'open', merged: false },
      302: { state: 'open', merged: false },
    });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 3_600_001);
    const read = new Set(mock.requests.map((u) => u.split('/').at(-1)));
    expect(read).toEqual(new Set([String(w.prNumber), '301', '302']));
  });

  test('㊺ the merge step finishing the card stops unclaimed verify / review steps too', () => {
    const w = makeWorld({ inflight: 'pending', inflightKind: 'review' });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.stepRows().filter((r) => r.kind === 'review')).toEqual([
      { kind: 'review', status: 'stopped' },
    ]);
  });

  test("㊻ anonymous: the grind's check-runs reads count against the same budget", async () => {
    const w = makeWorld({ phase: 'building' });
    addReviewCard(w, 401);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      401: { state: 'closed', merged: true },
    });
    mock.checkRuns = true;
    await pollerFor(w, mock, { anonIpReadsPerHour: 2 }).sweep();
    expect(mock.requests.filter((u) => u.includes('/check-runs'))).toHaveLength(1);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/401'))).toHaveLength(0);
  });

  test('㊽ the card leaves review during the second unreadable compare → no hint', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    mock.onCompare = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('[49] the reconcile finishes the card: the done card is published without the quota wait of the verify step it stopped', async () => {
    const w = makeWorld({ connected: true, inflight: 'waiting_quota', inflightKind: 'verify' });
    w.s.db
      .update(stepTable)
      .set({ quotaBlock: QUOTA_BLOCK })
      .where(eq(stepTable.buildId, w.buildId))
      .run();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const hub = w.s.svc.hub;
    const docs: Parameters<typeof hub.publishTodoDoc>[1][] = [];
    const publish = hub.publishTodoDoc.bind(hub);
    hub.publishTodoDoc = (teamId, doc) => {
      docs.push(doc);
      publish(teamId, doc);
    };
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(docs.at(-1)?.phase).toBe('done');
    expect(docs.at(-1)?.quotaWait).toBeNull();
  });

  test('[50] anonymous: a pulls read waits until the budget also has room for the compare it may need', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    addReviewCard(w, 301);
    const mine: PullSpec = { state: 'open', merged: false, compare: 'ahead' };
    const mock = new PullsMock({ [w.prNumber]: mine, 301: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
    const t0 = Date.now();
    await poller.sweep(t0);
    mine.state = 'closed';
    mine.merged = true;
    mock.status304 = false;
    await poller.sweep(t0 + 300_001);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(1);
    await poller.sweep(t0 + 3_600_001);
    expect(w.todoRow().phase).toBe('done');
    expect(mock.compareRequests()).toHaveLength(1);
  });

  test('[51] closed, then reopened before the next read (a close and reopen to rerun CI) → not failed', async () => {
    const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
    const spec: PullSpec = { state: 'closed', merged: false };
    const mock = new PullsMock({ [w.prNumber]: spec });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    spec.state = 'open';
    mock.status304 = false;
    await poller.sweep(t0 + 60_000);
    spec.state = 'closed';
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
  });

  test('[52] a closed response without a merged field is unreadable, not a close', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, noMerged: true },
    });
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test.each([
    ['a merge step starts', false],
    ['the merge step finishes the card and a person reopens it', true],
  ] as const)(
    '[53] %s during the second unreadable compare → no hint',
    async (_label, finished) => {
      const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      mock.onCompare = () => {
        if (finished) {
          finishTodoDone(w.s.svc, w.todoId, w.buildId);
          updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
          return;
        }
        w.s.db
          .insert(stepTable)
          .values({
            id: `step-merge-late-${w.buildId}`,
            buildId: w.buildId,
            kind: 'merge',
            status: 'pending',
            createdAt: Date.now(),
          })
          .run();
      };
      await poller.sweep(t0 + 600_001);
      expect(mock.compareRequests()).toHaveLength(2);
      expect(w.systemRows().filter((c) => c.includes('compare'))).toEqual([]);
    },
  );

  test('[54] a second merge step in the same round writes its completion row again', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(2);
  });

  test('[55] the sweep log counts the reconcile apart from the grind', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const info = vi.fn();
    await createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    ).sweep();
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally.pending).toBe(0);
    expect(tally.reviewPending).toBe(1);
  });

  test("[56] anonymous: the grind's reads count toward the per-IP total, not the reconcile's own share", async () => {
    const w = makeWorld({ phase: 'building' });
    addReviewCard(w, 402);
    w.s.db
      .update(todoTable)
      .set({ phase: 'building' })
      .where(eq(todoTable.id, `${w.todoId}-402`))
      .run();
    addReviewCard(w, 401);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      401: { state: 'open', merged: false },
      402: { state: 'open', merged: false },
    });
    mock.checkRuns = true;
    await pollerFor(w, mock, { anonReadsPerHour: 2 }).sweep();
    expect(mock.requests.filter((u) => u.includes('/check-runs'))).toHaveLength(2);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/401'))).toHaveLength(1);
  });

  test('[57] a close counts when the two reads happened 50 s apart, not the two sweep starts', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const t0 = Date.now();
    const fetch = mock.fetch;
    let slow = true;
    const timed = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      {
        githubFetch: (input, init) => {
          if (slow) {
            slow = false;
            vi.setSystemTime(Date.now() + 45_000);
          }
          return fetch(input, init);
        },
      },
    );
    try {
      await timed.sweep(t0);
      vi.setSystemTime(t0 + 60_000);
      await timed.sweep(t0 + 60_000);
      expect(w.todoRow().phase).toBe('review');
      vi.setSystemTime(t0 + 120_000);
      await timed.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('[58] a merged PR is not read again while its card stays in review', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 300_001);
    await poller.sweep(t0 + 600_002);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c.includes('release-x'))).toHaveLength(1);
  });

  test.each(['closed', 'done'] as const)(
    '[59] the done funnel on a card a person moved to %s throws before it stops anything',
    (phase) => {
      const w = makeWorld({ inflight: 'pending', inflightKind: 'verify' });
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      updateTodo(w.s.svc, w.todoId, { phase }, { manualPhase: true });
      expect(() => finishTodoDone(w.s.svc, w.todoId, w.buildId)).toThrow(
        `illegal phase transition: ${phase} -> done`,
      );
      expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
      expect(w.systemRows()).toEqual([]);
    },
  );

  test('[60] anonymous: a compare that sends no request (checkpoint not a sha) takes no budget', async () => {
    const w = makeWorld({ checkpoint: 'not-a-sha' });
    addReviewCard(w, 301);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true },
      301: { state: 'open', merged: false },
    });
    await pollerFor(w, mock, { anonReadsPerHour: 3 }).sweep();
    expect(mock.compareRequests()).toHaveLength(0);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/301'))).toHaveLength(1);
  });

  test.each([
    ['base.ref', {}, { noBaseRef: true }],
    ['default_branch', {}, { noDefaultBranch: true }],
    ['the base repo id', {}, { noBaseRepoId: true }],
    ['head', {}, { noHead: true }],
    ['head sha (the build has a checkpoint)', { checkpoint: 'a'.repeat(40) }, { noHeadSha: true }],
  ] as const)(
    '[61] a merged response without %s is read again on a later sweep; the complete one finishes the card',
    async (_label, world, missing) => {
      const w = makeWorld(world);
      const spec: PullSpec = {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234def5678',
        ...missing,
      };
      const mock = new PullsMock({ [w.prNumber]: spec });
      const poller = pollerFor(w, mock);
      const pullReads = () => mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`));
      const t0 = Date.now();
      await poller.sweep(t0);
      expect(w.todoRow().phase).toBe('review');
      Object.assign(spec, {
        noBaseRef: false,
        noDefaultBranch: false,
        noBaseRepoId: false,
        noHead: false,
        noHeadSha: false,
      });
      await poller.sweep(t0 + 60_000);
      expect(pullReads()).toHaveLength(1);
      await poller.sweep(t0 + 300_000);
      expect(pullReads()).toHaveLength(2);
      expect(mock.headers.at(-1)?.['if-none-match']).toBeUndefined();
      expect(w.todoRow().phase).toBe('done');
      const rows = w.systemRows();
      expect(
        rows.some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并（合并提交 abc1234`)),
      ).toBe(true);
      expect(rows).toContain(DONE_ROW);
    },
  );

  test.each([
    ['closed', false],
    ['merged', true],
  ] as const)(
    '[62a] a fork PR with the same branch name, %s → the card is neither failed nor finished; one hint',
    async (_label, merged) => {
      const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
      const mock = new PullsMock({
        [w.prNumber]: {
          state: 'closed',
          merged,
          mergeCommitSha: 'abc1234',
          headRepo: 'mallory/demo',
          headRepoId: REPO_ID + 1,
        },
      });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
        { githubFetch: mock.fetch, logger: { info } },
      );
      await sweepTwice(poller);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
      const rows = w.systemRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`PR #${w.prNumber}`);
      expect(rows[0]).toContain(conversationBranch(w.buildId));
      expect(rows[0]).not.toContain('mallory');
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewForeign).toBe(1);
    },
  );

  test('[62b] a PR from another branch of the target repo → not finished', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, headRef: 'someone-elses-branch' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toEqual([]);
  });

  test.each([
    ['renamed', 'octo/demo2'],
    ['transferred', 'neworg/demo'],
  ] as const)(
    '[62c] the repo was %s on GitHub (head and base both %s, the project still says octo/demo) → done',
    async (_label, name) => {
      const w = makeWorld();
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, headRepo: name, baseRepo: name },
      });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
      expect(w.systemRows()).toContain(DONE_ROW);
    },
  );

  test.each([
    ['closed', false],
    ['merged', true],
  ] as const)(
    '[62d] a %s PR whose head repo is null (fork deleted) is foreign: one hint per round, counted, kept in the cache',
    async (_label, merged) => {
      const w = makeWorld({ connected: true });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged, headRepo: null } });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
        { githubFetch: mock.fetch, logger: { info } },
      );
      await poller.sweep();
      await poller.sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      const rows = w.systemRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`PR #${w.prNumber}`);
      expect(rows[0]).toContain(conversationBranch(w.buildId));
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewForeign).toBe(1);
      expect(tally.reviewUnreadable).toBe(0);
      const reads = mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`));
      if (merged) {
        expect(reads).toHaveLength(1);
      } else {
        expect(reads).toHaveLength(2);
        const pullHeaders = mock.headers.filter((_, index) =>
          mock.requests[index]?.endsWith(`/pulls/${w.prNumber}`),
        );
        expect(pullHeaders[1]?.['if-none-match']).toBe('"x"');
      }
    },
  );

  test('[63] a merge step completing through completeStep stops an unclaimed verify step', () => {
    const w = makeWorld({ inflight: 'pending', inflightKind: 'verify', repoKind: 'local' });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mergeStepId = `step-merge-done-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: mergeStepId,
        buildId: w.buildId,
        kind: 'merge',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    completeStep(w.s.svc, mergeStepId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('stopped');
    expect(w.systemRows()).toContain(DONE_ROW);
  });

  test('[64] the reconcile finishing a split child advances the waves: the unblocked sibling starts', async () => {
    const w = makeWorld();
    const parentId = `${w.todoId}-parent`;
    const siblingId = `${w.todoId}-sibling`;
    const card = (id: string, phase: Phase, seqNum: number) => ({
      id,
      teamId: w.s.team.id,
      projectId: w.projectId,
      title: id,
      spec: 'do it',
      phase,
      phaseAt: Date.now(),
      seqNum,
    });
    w.s.db
      .insert(todoTable)
      .values({ ...card(parentId, 'building', 10), assignment: { plan: null, build: null } })
      .run();
    w.s.db.update(todoTable).set({ sourceTodo: parentId }).where(eq(todoTable.id, w.todoId)).run();
    w.s.db
      .insert(todoTable)
      .values({
        ...card(siblingId, 'todo', 11),
        sourceTodo: parentId,
        blockedBy: [w.todoId],
        assignment: { plan: null, build: { agentId: 'agent-split-next' } },
      })
      .run();
    const phaseOf = (id: string) =>
      w.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()?.phase;
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(phaseOf(siblingId)).toBe('queued');
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.todoId, siblingId)).all(),
    ).toHaveLength(1);
    expect(phaseOf(parentId)).toBe('building');
  });

  test('[65a] an over-long base branch name with control characters is cut to 100 characters in the hint', async () => {
    const w = makeWorld({ connected: true });
    const long = `release-${'x'.repeat(300)}`;
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        baseRef: `${long}\u0007\u001b[2J`,
        defaultBranch: 'ma\u0000in\n',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('release-'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain(`「${long.slice(0, 100)}…」`);
    expect(hints[0]).toContain('「main」');
    expect(hints[0]).not.toMatch(/\p{Cc}/u);
    expect(hints[0]?.length).toBeLessThan(250);
  });

  test('[65b] the merger login and the merge commit in the merge row lose control characters and are bounded', async () => {
    const w = makeWorld({ connected: true });
    const login = `octocat${'y'.repeat(200)}`;
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: '\u001babc1234def5678',
        mergedBy: `oct\nocat${'y'.repeat(200)}`,
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    const row = w.systemRows().find((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`));
    expect(row).toContain('合并提交 abc1234，');
    expect(row).toContain(`由 ${login.slice(0, 100)}… 合并`);
    expect(row).not.toMatch(/\p{Cc}/u);
  });

  test('[65c] format characters in a branch name (a bidi override, zero-width characters) are stripped from the hint', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        baseRef: 'rel‮ease​-x',
        defaultBranch: 'ma‍in⁦',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes(`PR #${w.prNumber}`));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('「release-x」');
    expect(hints[0]).toContain('「main」');
    expect(hints[0]).not.toMatch(/\p{Cf}/u);
  });

  test.each([
    ['the sweep skips the read', 'before'],
    ['it starts during the read, the sweep drops what it read', 'during'],
  ] as const)(
    '[67a] a step runs after the first closed read (%s): the first read after it does not confirm the close',
    async (_label, at) => {
      const w = makeWorld({ connected: true });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
      const stepId = `step-verify-run-${w.buildId}`;
      const claimVerify = () =>
        w.s.db
          .insert(stepTable)
          .values({
            id: stepId,
            buildId: w.buildId,
            kind: 'verify',
            status: 'claimed',
            createdAt: Date.now(),
          })
          .run();
      let raceNext = false;
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
        {
          githubFetch: (input, init) => {
            if (raceNext) {
              raceNext = false;
              claimVerify();
            }
            return mock.fetch(input, init);
          },
        },
      );
      const t0 = Date.now();
      await poller.sweep(t0);
      if (at === 'before') claimVerify();
      else raceNext = true;
      await poller.sweep(t0 + 60_000);
      w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, stepId)).run();
      await poller.sweep(t0 + 900_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      await poller.sweep(t0 + 960_000);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test.each([
    ['a network error', 'throw'],
    ['a response without head', 'noHead'],
  ] as const)(
    '[67b] a read that gets nothing (%s) between two closed reads: the count starts over',
    async (_label, failure) => {
      const w = makeWorld({ connected: true });
      const spec: PullSpec = { state: 'closed', merged: false };
      const mock = new PullsMock({ [w.prNumber]: spec });
      mock.status304 = false;
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      if (failure === 'throw') mock.throwNext = true;
      else spec.noHead = true;
      await poller.sweep(t0 + 60_000);
      spec.noHead = false;
      await poller.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      await poller.sweep(t0 + 180_000);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test('[67c] anonymous: the sweeps that skip a PR for the five-minute interval do not reset its close', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    for (let k = 0; k < 5; k += 1) await poller.sweep(t0 + k * 60_000);
    expect(mock.requests).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 300_000);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(2);
    expect(w.todoRow().phase).toBe('failed');
  });

  test('[68] merged at the last build checkpoint, then a verify step pushed a commit → stays in review with a hint', async () => {
    const built = 'a'.repeat(40);
    const verified = 'b'.repeat(40);
    const w = makeWorld({ checkpoint: built });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-verify-pushed-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        checkpointCommit: verified,
        createdAt: Date.now(),
      })
      .run();
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        headSha: built,
        compareByBase: { [verified]: 'behind' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${verified}...${built}`);
    expect(w.systemRows().some((c) => c.includes('bbbbbbb') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
    expect(w.systemRows()).not.toContain(DONE_ROW);
  });

  test('[69] every review candidate lands in exactly one bucket of the sweep log, also after its hint is written', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    addReviewCard(w, 303);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'diverged' },
      301: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
      302: { state: 'closed', merged: false, headRepo: 'mallory/demo', headRepoId: REPO_ID + 1 },
      303: { state: 'open', merged: false },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const buckets = [
      'reviewPending',
      'reviewSkipped',
      'reviewUnreadable',
      'reviewForeign',
      'merged',
      'closedUnmerged',
      'hinted',
      'settledBefore',
      'adopted',
    ] as const;
    for (const t of [0, 60_000]) {
      await poller.sweep(Date.now() + t);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewCandidates).toBe(4);
      expect(buckets.reduce((n, k) => n + (tally[k] ?? 0), 0)).toBe(4);
      expect(tally).toMatchObject({ hinted: 2, reviewForeign: 1, reviewPending: 1, errors: 0 });
    }
    const all = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system');
    expect(all).toHaveLength(3);
  });

  test('[70a] a PR from the work branch into another branch (a backport) closed without merge → after the confirming read, one hint and nothing else', async () => {
    const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: false,
        baseRef: 'release-1.2',
        defaultBranch: 'main',
      },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const tallyOf = () => info.mock.calls.at(-1)?.[0] as Record<string, number>;
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.systemRows()).toEqual([]);
    expect(tallyOf().reviewPending).toBe(1);
    await poller.sweep(t0 + 60_000);
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
    const rows = w.systemRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`PR #${w.prNumber}`);
    expect(rows[0]).toContain('「release-1.2」');
    expect(rows[0]).toContain('「main」');
    expect(rows.some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`))).toBe(
      false,
    );
    expect(tallyOf()).toMatchObject({ hinted: 1, closedUnmerged: 0 });
  });

  test('[70b] closed without merge into the default branch, whatever it is called → failed as before', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, baseRef: 'trunk', defaultBranch: 'trunk' },
    });
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage ?? '').toContain(`#${w.prNumber}`);
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test.each([
    ['base.ref', { noBaseRef: true }],
    ['default_branch', { noDefaultBranch: true }],
  ] as const)(
    '[70c] a closed response without %s is unreadable: not failed; the close counts again from the next complete read',
    async (_label, missing) => {
      const w = makeWorld({ connected: true });
      const spec: PullSpec = { state: 'closed', merged: false, ...missing };
      const mock = new PullsMock({ [w.prNumber]: spec });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
        { githubFetch: mock.fetch, logger: { info } },
      );
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      expect(w.systemRows()).toEqual([]);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewUnreadable).toBe(1);
      Object.assign(spec, { noBaseRef: false, noDefaultBranch: false });
      await poller.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('review');
      await poller.sweep(t0 + 180_000);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test('㊼ compare asks for one page', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    await pollerFor(w, mock).sweep();
    expect(mock.compareRequests()[0]).toMatch(/\?per_page=1$/);
    expect(w.todoRow().phase).toBe('done');
  });

  test('building-phase builds stay with the CI grind path (its PR read gives the head SHA; not reconciled)', async () => {
    const w = makeWorld({ phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.filter((u) => u.includes('/pulls/'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('building');
    expect(w.systemRows()).toEqual([]);
  });
});

describe('#1403 [66] live GitHub response shapes (captured over REST, see docs/verify/1403)', () => {
  const MAIN_OLDER = '66d5022e374da641ed37ca59ec4fa1c089cb1fac';
  const MAIN_NEWER = '23a39da9f7dc929fa8e1e271e2dd73d4bbdb0458';
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
  function serve(body: unknown) {
    const urls: string[] = [];
    const fetch = (input: string | URL) => {
      urls.push(String(input));
      return Promise.resolve(res(200, '"live"', body));
    };
    return { urls, fetch };
  }

  test('[66a] an open PR (pulls/1414): no merge commit, even though GitHub sends its test-merge sha', async () => {
    const body = fixture('pull-1414-open.json') as { merge_commit_sha?: unknown };
    expect(typeof body.merge_commit_sha).toBe('string');
    const { fetch, urls } = serve(body);
    const page = await githubPull(fetch, null, 'xiechimon', 'cairn', 1414);
    expect(urls).toEqual(['https://api.github.com/repos/xiechimon/cairn/pulls/1414']);
    expect(page?.etag).toBe('"live"');
    expect(page?.pull).toEqual({
      state: 'open',
      merged: false,
      mergedAt: null,
      mergeCommitSha: null,
      mergedBy: null,
      headSha: '9fa4ed90fa76bc7d7a82c7ffe20ab3782dc2cddd',
      headRef: 'claude/bootstrap-p2',
      headRepoId: 1361226985,
      baseRef: 'main',
      baseRepoId: 1361226985,
      defaultBranch: 'main',
      baseOwner: 'xiechimon',
      title: 'server(1403): reconcile review-phase PRs merged or closed on GitHub',
      authorAssociation: 'OWNER',
      mergeableState: 'blocked',
      openerLogin: 'xiechimon',
      openerType: 'User',
    });
  });

  test('[66b] a merged PR (pulls/1454): merge commit, merger login, head repo id = base repo id', async () => {
    const { fetch } = serve(fixture('pull-1454-merged.json'));
    const page = await githubPull(fetch, null, 'xiechimon', 'cairn', 1454);
    expect(page?.pull).toEqual({
      state: 'closed',
      merged: true,
      mergeCommitSha: MAIN_NEWER,
      mergedAt: '2026-10-21T07:54:00Z',
      mergedBy: 'xiechimon',
      headSha: '815d5b73f70829d44d6895e1a7a51e13bc6a0555',
      headRef: 'claude/optimistic-albattani-r5pmfn',
      headRepoId: 1361226985,
      baseRef: 'main',
      baseRepoId: 1361226985,
      defaultBranch: 'main',
      baseOwner: 'xiechimon',
      title: 'server(1453): a step that finishes before its stop lands leaves an exited card alone',
      authorAssociation: 'OWNER',
      mergeableState: 'unknown',
      openerLogin: 'xiechimon',
      openerType: 'User',
    });
  });

  test.each([
    ['ahead', 'compare-ahead.json', MAIN_OLDER, MAIN_NEWER],
    ['behind', 'compare-behind.json', MAIN_NEWER, MAIN_OLDER],
  ] as const)(
    '[66c] compare between two commits on main reads %s',
    async (status, file, base, head) => {
      const { fetch, urls } = serve(fixture(file));
      expect(await githubCompareStatus(fetch, null, 'xiechimon', 'cairn', base, head)).toBe(status);
      expect(urls).toEqual([
        `https://api.github.com/repos/xiechimon/cairn/compare/${base}...${head}?per_page=1`,
      ]);
    },
  );
});

describe('#1403 segment 2: the PR the build tracks', () => {
  function closedWithSibling(opts: { connected?: boolean; sibling?: PullSpec } = {}) {
    const w = makeWorld({
      connected: opts.connected ?? true,
      inflight: 'pending',
      inflightKind: 'verify',
    });
    const branch = conversationBranch(w.buildId);
    headRefs.set(202, branch);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false },
      202: opts.sibling ?? { state: 'open', merged: false },
    });
    return { w, branch, mock };
  }

  const closedRows = (w: World) =>
    w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`));

  test("[s2-A1] closed and confirmed, an open PR from the build's own branch → that PR is recorded, nothing fails", async () => {
    const { w, branch, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202 }, { number: w.prNumber, state: 'closed' }];
    const info = vi.fn();
    const published = vi.spyOn(w.s.hub, 'publishBuildDoc');
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(mock.listRequests()).toEqual([]);
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow()).toMatchObject({
      prNumber: 202,
      prUrl: 'https://github.com/octo/demo/pull/202',
      errorMessage: null,
    });
    expect(published.mock.calls.some(([, record]) => record.prNumber === 202)).toBe(true);
    expect(closedRows(w)).toEqual([]);
    const adopted = w
      .systemRows()
      .filter((c) => c.includes(`#${w.prNumber}`) && c.includes('#202'));
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toContain(`「${branch}」`);
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
    expect(mock.listRequests()).toHaveLength(1);
    const listed = decodeURIComponent(mock.listRequests()[0] ?? '');
    expect(listed).toContain('https://api.github.com/repos/octo/demo/pulls?');
    for (const part of ['state=all', `head=octo:${branch}`, 'base=main', 'per_page=10']) {
      expect(listed).toContain(part);
    }
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally).toMatchObject({ adopted: 1, closedUnmerged: 0, reviewCandidates: 1 });
    const buckets = [
      'reviewPending',
      'reviewSkipped',
      'reviewUnreadable',
      'reviewForeign',
      'merged',
      'closedUnmerged',
      'hinted',
      'settledBefore',
      'adopted',
    ];
    expect(buckets.reduce((n, k) => n + (tally[k] ?? 0), 0)).toBe(1);
    await poller.sweep(t0 + 120_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/202'))).toHaveLength(1);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
  });

  test('[s2-A2] the PR on the same branch is already merged → it is recorded, then the merged path finishes the card', async () => {
    const { w, mock } = closedWithSibling({
      sibling: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def' },
    });
    mock.branchPulls = [{ number: 202, state: 'closed', merged: true }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.buildRow().prNumber).toBe(202);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows().some((c) => c.startsWith('PR #202 已在 GitHub 合并'))).toBe(true);
    expect(closedRows(w)).toEqual([]);
  });

  test('[s2-A3] no other PR on the branch → failed as before, after one list read', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, state: 'closed' }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(closedRows(w)).toHaveLength(1);
    expect(mock.listRequests()).toHaveLength(1);
  });

  test.each([
    ['a fork PR with the same branch name', { number: 202, headRepoId: REPO_ID + 1 }],
    ['a fork that was deleted (head repo null)', { number: 202, headRepoId: null }],
    ['a PR from another branch', { number: 202, headRef: 'feature-x' }],
    ['a PR into another base', { number: 202, baseRef: 'release-x' }],
    ['a PR whose base is another repository', { number: 202, baseRepoId: REPO_ID + 5 }],
    ['another closed PR that was not merged', { number: 202, state: 'closed' as const }],
  ])('[s2-A4] the list holds only %s → not recorded, failed as before', async (_label, entry) => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [entry];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
  });

  test.each([502, 429, 'throw'] as const)(
    '[s2-A5] the list read fails (%s) → nothing written; the next sweep confirms again and acts',
    async (failure) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = failure;
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow()).toMatchObject({ prNumber: w.prNumber, errorMessage: null });
      expect(w.systemRows()).toEqual([]);
      mock.branchPulls = [];
      await poller.sweep(t0 + 120_000);
      expect(mock.listRequests()).toHaveLength(2);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test('[s2-A6] no list read for a close and reopen, or for a closed PR into another base', async () => {
    const reopened = closedWithSibling();
    const poller = pollerFor(reopened.w, reopened.mock);
    const spec = reopened.mock.pulls[reopened.w.prNumber];
    const t0 = Date.now();
    await poller.sweep(t0);
    if (spec !== undefined) spec.state = 'open';
    reopened.mock.status304 = false;
    await poller.sweep(t0 + 60_000);
    expect(reopened.mock.listRequests()).toEqual([]);
    expect(reopened.w.todoRow().phase).toBe('review');

    const other = makeWorld({ connected: true });
    const mock = new PullsMock({
      [other.prNumber]: { state: 'closed', merged: false, baseRef: 'release-x' },
    });
    await sweepTwice(pollerFor(other, mock));
    expect(mock.listRequests()).toEqual([]);
    expect(other.todoRow().phase).toBe('review');
  });

  test.each(['the card leaves review', 'a step starts'] as const)(
    '[s2-A7] %s while the list read is in flight → no write',
    async (race) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202 }];
      mock.onList = () => {
        if (race === 'the card leaves review') {
          w.s.db
            .update(todoTable)
            .set({ phase: 'planning' })
            .where(eq(todoTable.id, w.todoId))
            .run();
        } else {
          w.s.db
            .insert(stepTable)
            .values({
              id: `step-merge-race-${w.buildId}`,
              buildId: w.buildId,
              kind: 'merge',
              status: 'claimed',
              createdAt: Date.now(),
            })
            .run();
        }
      };
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.buildRow().prNumber).toBe(w.prNumber);
      expect(w.systemRows()).toEqual([]);
      expect(w.todoRow().phase).toBe(race === 'the card leaves review' ? 'planning' : 'review');
    },
  );

  test("[s2-A8] anonymous: the list read takes the slot the pulls read kept for it, within the reconcile's own budget", async () => {
    const { w, mock } = closedWithSibling({ connected: false });
    mock.branchPulls = [{ number: 202 }];
    const poller = pollerFor(w, mock, { anonReadsPerHour: 4 });
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 300_000);
    expect(mock.requests).toHaveLength(3);
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.buildRow().prNumber).toBe(202);
    await poller.sweep(t0 + 360_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/202'))).toEqual([]);
  });

  test('[s2-A15] the recorded PR shows up open in the list (reopened between the two reads) → not failed, nothing written', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow()).toMatchObject({ prNumber: w.prNumber, errorMessage: null });
    expect(w.systemRows()).toEqual([]);
    mock.branchPulls = [];
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
  });

  test("[s2-A9] the recorded PR is another build's (9b shape) and this build has its own PR → its own PR is recorded, no foreign hint", async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    const own = conversationBranch(currentBuildId);
    headRefs.set(305, own);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
      305: { state: 'open', merged: false },
    });
    mock.branchPulls = [{ number: 305 }];
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox, githubFetch: mock.gateFetch },
      { githubFetch: mock.fetch, logger: { info } },
    );
    await poller.sweep();
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(305);
    const rows = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
      .map((r) => String(r.content));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('#201');
    expect(rows[0]).toContain('#305');
    expect(rows[0]).toContain(`「${own}」`);
    expect(w.todoRow().phase).toBe('review');
    expect(info.mock.calls.at(-1)?.[0]).toMatchObject({ adopted: 1, reviewForeign: 0 });
    expect(decodeURIComponent(mock.listRequests()[0] ?? '')).toContain(`head=octo:${own}`);
  });

  test('[s2-A7b] the recorded PR is foreign and a step starts while the list read is in flight → no write', async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(305, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.branchPulls = [{ number: 305 }];
    mock.onList = () => {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-merge-race-${currentBuildId}`,
          buildId: currentBuildId,
          kind: 'merge',
          status: 'claimed',
          createdAt: Date.now(),
        })
        .run();
    };
    await pollerFor(w, mock).sweep();
    expect(mock.listRequests()).toHaveLength(1);
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(201);
    const rows = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system');
    expect(rows).toEqual([]);
  });

  test('[s2-A9b] the recorded PR is foreign and the build has no PR of its own → one hint per round; the branch is listed again after ten minutes and a PR of its own found then is recorded', async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(305, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    await poller.sweep(t0 + 120_000);
    expect(mock.listRequests()).toHaveLength(1);
    const hints = () =>
      w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && String(r.content).includes('#201'));
    expect(hints()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    mock.branchPulls = [{ number: 305, state: 'closed', merged: true }];
    await poller.sweep(t0 + 600_000);
    expect(mock.listRequests()).toHaveLength(2);
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(305);
    expect(hints().filter((r) => String(r.content).includes('#305'))).toHaveLength(1);
  });

  test.each([
    ['an open PR and merged ones → the open one', [205, 204, 203], 204],
    ['only merged ones → the highest number', [203, 205], 205],
  ] as const)('[s2-A11] %s', async (_label, numbers, expected) => {
    const { w, mock } = closedWithSibling();
    for (const n of numbers) headRefs.set(n, conversationBranch(w.buildId));
    mock.branchPulls = numbers.map((n) =>
      n === 204 ? { number: n } : { number: n, state: 'closed' as const, merged: true },
    );
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(expected);
  });

  test('[s2-A15b] the recorded PR is open again and the list also has a higher open PR of the branch → still a reopen, nothing recorded', async () => {
    const { w, mock } = closedWithSibling();
    headRefs.set(221, conversationBranch(w.buildId));
    mock.branchPulls = [{ number: 221 }, { number: w.prNumber }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.systemRows()).toEqual([]);
  });

  test('[s2-A16] only a merged PR older than the recorded one is on the branch → not recorded; the close of the newer one stands', async () => {
    const { w, mock } = closedWithSibling();
    headRefs.set(150, conversationBranch(w.buildId));
    mock.branchPulls = [{ number: 150, state: 'closed', merged: true }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(closedRows(w)).toHaveLength(1);
  });

  test('[s2-A17] the list asks for the owner the PR response names, not the stored one (renamed or transferred repository)', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, baseOwner: 'octo-moved' },
    });
    await sweepTwice(pollerFor(w, mock));
    const listed = decodeURIComponent(mock.listRequests()[0] ?? '');
    expect(listed).toContain(`head=octo-moved:${conversationBranch(w.buildId)}`);
  });

  test.each([502, 'throw'] as const)(
    '[s2-A9c] the recorded PR is foreign and the list read fails (%s) → the hint as before; the branch is listed again after ten minutes',
    async (failure) => {
      const w = makeWorld({ connected: true, newerBuildPr: 201 });
      headRefs.set(201, conversationBranch(w.buildId));
      const currentBuildId = String(
        w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
      );
      headRefs.set(305, conversationBranch(currentBuildId));
      const mock = new PullsMock({
        201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
      });
      mock.branchPulls = failure;
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      const hints = w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && r.conversationId === currentBuildId);
      expect(hints).toHaveLength(1);
      expect(String(hints[0]?.content)).toContain('PR #201 的 head');
      mock.branchPulls = [{ number: 305 }];
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      await poller.sweep(t0 + 600_000);
      expect(mock.listRequests()).toHaveLength(2);
      const current = w.s.db
        .select()
        .from(buildTable)
        .where(eq(buildTable.id, currentBuildId))
        .get();
      expect(current?.prNumber).toBe(305);
    },
  );

  test("[s2-A9e] the recorded PR is foreign and the build's own merged PR has a lower number → recorded (the recorded number is someone else's)", async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(150, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.branchPulls = [{ number: 150, state: 'closed', merged: true }];
    await pollerFor(w, mock).sweep();
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(150);
  });

  test("[s2-A9d] the recorded PR is open but not the build's own → it is not left pending: the build's own PR is recorded, or one hint per round", async () => {
    const adopt = makeWorld({ connected: true });
    headRefs.set(adopt.prNumber, 'someone-else/feature');
    headRefs.set(202, conversationBranch(adopt.buildId));
    const mock = new PullsMock({ [adopt.prNumber]: { state: 'open', merged: false } });
    mock.branchPulls = [{ number: 202 }];
    await pollerFor(adopt, mock).sweep();
    expect(adopt.buildRow().prNumber).toBe(202);
    expect(adopt.todoRow().phase).toBe('review');

    const hint = makeWorld({ connected: true });
    headRefs.set(hint.prNumber, 'someone-else/feature');
    const mock2 = new PullsMock({ [hint.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(hint, mock2);
    await poller.sweep();
    await poller.sweep(Date.now() + 60_000);
    expect(mock2.listRequests()).toHaveLength(1);
    const hints = hint.systemRows().filter((c) => c.includes(`PR #${hint.prNumber} 的 head`));
    expect(hints).toHaveLength(1);
    expect(hint.buildRow().prNumber).toBe(hint.prNumber);
  });

  function foreignWorld(opts: { connected?: boolean } = {}) {
    const w = makeWorld({ connected: opts.connected ?? true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    const own = conversationBranch(currentBuildId);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const currentPr = () =>
      w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get()?.prNumber;
    const currentRows = () =>
      w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
        .map((r) => String(r.content));
    return { w, mock, currentBuildId, own, currentPr, currentRows };
  }

  test('[s2-A18] a merged PR of the build is not taken when a newer PR of the build was closed without merge (the person rejected the newer work)', async () => {
    const f = foreignWorld();
    headRefs.set(150, f.own);
    headRefs.set(160, f.own);
    f.mock.branchPulls = [
      { number: 160, state: 'closed' },
      { number: 150, state: 'closed', merged: true },
    ];
    await pollerFor(f.w, f.mock).sweep();
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);

    const { w, mock } = closedWithSibling();
    headRefs.set(205, conversationBranch(w.buildId));
    headRefs.set(210, conversationBranch(w.buildId));
    mock.branchPulls = [
      { number: 210, state: 'closed' },
      { number: 205, state: 'closed', merged: true },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
  });

  test('[s2-A19] the build records another PR while the list read is in flight (the daemon probe) → that value is kept, nothing written', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202 }];
    mock.onList = () => {
      w.s.db.update(buildTable).set({ prNumber: 555 }).where(eq(buildTable.id, w.buildId)).run();
    };
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(555);
    expect(w.systemRows()).toEqual([]);
    expect(w.todoRow().phase).toBe('review');
  });

  test('[s2-A20] the daemon probe records the foreign PR again and the reconcile adopts again → the adoption row is written once per round', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(f.currentPr()).toBe(305);
    await poller.sweep(t0 + 60_000);
    f.w.s.db
      .update(buildTable)
      .set({ prNumber: 201 })
      .where(eq(buildTable.id, f.currentBuildId))
      .run();
    await poller.sweep(t0 + 600_000);
    expect(f.currentPr()).toBe(305);
    expect(f.currentRows().filter((c) => c.includes('改记'))).toHaveLength(1);
  });

  test('[s2-A21] anonymous: the foreign path lists the branch at most once an hour', async () => {
    const f = foreignWorld({ connected: false });
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 600_000);
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 3_600_000);
    expect(f.mock.listRequests()).toHaveLength(2);
  });

  test('[s2-A22] the recorded PR changes: the ten-minute wait starts again for the new one', async () => {
    const f = foreignWorld();
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    headRefs.set(202, conversationBranch(f.w.buildId));
    f.mock.pulls[202] = { state: 'closed', merged: true, mergeCommitSha: 'def5678' };
    headRefs.set(305, f.own);
    f.mock.branchPulls = [{ number: 305 }];
    f.w.s.db
      .update(buildTable)
      .set({ prNumber: 202 })
      .where(eq(buildTable.id, f.currentBuildId))
      .run();
    await poller.sweep(t0 + 120_000);
    expect(f.mock.listRequests()).toHaveLength(2);
    expect(f.currentPr()).toBe(305);
  });

  test('[s2-A5b] the list read fails at two confirming reads in a row → the close is reported as in segment 1', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 120_000);
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('failed');
    expect(closedRows(w)).toHaveLength(1);
  });

  test('[s2-A5c] a failed list read during an earlier close does not count toward a later close', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const spec = mock.pulls[w.prNumber];
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    mock.status304 = false;
    if (spec !== undefined) spec.state = 'open';
    await poller.sweep(t0 + 120_000);
    if (spec !== undefined) spec.state = 'closed';
    await poller.sweep(t0 + 180_000);
    await poller.sweep(t0 + 240_000);
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[s2-A15c] the recorded PR shows up merged in the list (merged between the two reads) → nothing written; the next read finishes the card', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, state: 'closed', merged: true }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) spec.merged = true;
    mock.status304 = false;
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('done');
    expect(closedRows(w)).toEqual([]);
  });

  test('[s2-A22b] the build goes back to a PR it recorded before: the old listing time is gone, the branch is listed at once', async () => {
    const f = foreignWorld();
    headRefs.set(202, conversationBranch(f.w.buildId));
    f.mock.pulls[202] = { state: 'closed', merged: true, mergeCommitSha: 'def5678' };
    const poller = pollerFor(f.w, f.mock);
    const setRecorded = (n: number) =>
      f.w.s.db
        .update(buildTable)
        .set({ prNumber: n })
        .where(eq(buildTable.id, f.currentBuildId))
        .run();
    const t0 = Date.now();
    await poller.sweep(t0);
    setRecorded(202);
    await poller.sweep(t0 + 60_000);
    setRecorded(201);
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    await poller.sweep(t0 + 120_000);
    expect(f.mock.listRequests()).toHaveLength(3);
    expect(f.currentPr()).toBe(305);
  });

  test('[s2-A13] the recorded URL is built from the repository and number, not taken from the response', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202, htmlUrl: 'https://evil.example/pull/202‮' }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prUrl).toBe('https://github.com/octo/demo/pull/202');
    expect(w.systemRows().join('\n')).not.toContain('evil');
  });

  test('[s2-A14] the branch PR list parser: live captures, and unreadable answers', async () => {
    const fixture = (name: string): unknown =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
    const urls: string[] = [];
    const serve = (status: number, body: unknown) => (input: string | URL) => {
      urls.push(String(input));
      return Promise.resolve(res(status, '"live"', body));
    };
    const open = await githubBranchPulls(
      serve(200, fixture('branch-pulls-open.json')),
      null,
      'xiechimon',
      'cairn',
      { head: 'xiechimon:claude/bootstrap-p2', base: 'main' },
    );
    expect(urls).toEqual([
      'https://api.github.com/repos/xiechimon/cairn/pulls?state=all&head=xiechimon%3Aclaude%2Fbootstrap-p2&base=main&per_page=10',
    ]);
    expect(open).toEqual([
      {
        number: 1414,
        state: 'open',
        merged: false,
        headRef: 'claude/bootstrap-p2',
        headRepoId: 1361226985,
        baseRef: 'main',
        baseRepoId: 1361226985,
        authorAssociation: null,
      },
    ]);
    const merged = await githubBranchPulls(
      serve(200, fixture('branch-pulls-merged.json')),
      null,
      'xiechimon',
      'cairn',
      { head: 'xiechimon:claude/optimistic-albattani-r5pmfn', base: 'main' },
    );
    expect(merged?.map((p) => [p.number, p.state, p.merged])).toEqual([
      [1474, 'closed', true],
      [1456, 'closed', true],
      [1454, 'closed', true],
      [1452, 'closed', true],
      [1449, 'closed', true],
      [1436, 'closed', true],
      [1425, 'closed', true],
    ]);
    const args = ['o', 'r', { head: 'o:b', base: 'main' }] as const;
    expect(await githubBranchPulls(serve(200, { message: 'x' }), null, ...args)).toBeNull();
    expect(await githubBranchPulls(serve(404, []), null, ...args)).toBeNull();
    expect(
      await githubBranchPulls(() => Promise.reject(new TypeError('fetch failed')), null, ...args),
    ).toBeNull();
  });

  test('[2b-P4] the recorded PR is foreign and the card leaves review while the list read is in flight → no write', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    f.mock.onList = () => {
      f.w.s.db
        .update(todoTable)
        .set({ phase: 'planning' })
        .where(eq(todoTable.id, f.w.todoId))
        .run();
    };
    await pollerFor(f.w, f.mock).sweep();
    expect(f.mock.listRequests()).toHaveLength(1);
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows()).toEqual([]);
  });

  test('[2b-P5] a failed list read counts within one close only: the card leaving review and coming back starts again', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const setPhase = (phase: Phase) =>
      w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, w.todoId)).run();
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    setPhase('planning');
    await poller.sweep(t0 + 120_000);
    setPhase('review');
    await poller.sweep(t0 + 180_000);
    await poller.sweep(t0 + 240_000);
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[2b-P6] anonymous: a foreign list read skipped for lack of budget does not count as a listing', async () => {
    const f = foreignWorld({ connected: false });
    const poller = pollerFor(f.w, f.mock, { anonIpReadsPerHour: 2 });
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(f.mock.listRequests()).toHaveLength(1);
    addReviewCard(f.w, 401);
    const grind = `${f.w.todoId}-401`;
    const setGrind = (phase: Phase) =>
      f.w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, grind)).run();
    setGrind('building');
    await poller.sweep(t0 + 3_000_000);
    await poller.sweep(t0 + 3_300_000);
    setGrind('closed');
    await poller.sweep(t0 + 3_600_001);
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 6_900_001);
    expect(f.mock.listRequests()).toHaveLength(2);
  });

  test.each([
    'NONE',
    'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'MANNEQUIN',
    null,
  ] as const)(
    '[2b-P7a] closed path: an open PR from the build’s branch whose author has no write access (%s) is not adopted → failed as in segment 1',
    async (association) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202, authorAssociation: association }];
      await sweepTwice(pollerFor(w, mock));
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.buildRow().prNumber).toBe(w.prNumber);
      expect(w.todoRow().phase).toBe('failed');
      expect(closedRows(w)).toHaveLength(1);
    },
  );

  test.each(['OWNER', 'MEMBER', 'COLLABORATOR'] as const)(
    '[2b-P7b] closed path: an open PR from the build’s branch by %s is adopted',
    async (association) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202, authorAssociation: association }];
      await sweepTwice(pollerFor(w, mock));
      expect(w.buildRow().prNumber).toBe(202);
      expect(w.todoRow().phase).toBe('review');
      expect(closedRows(w)).toEqual([]);
    },
  );

  test('[2b-P7c] foreign path: an open PR from the build’s own branch by an author without write access is not adopted; the hint', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305, authorAssociation: 'NONE' }];
    await pollerFor(f.w, f.mock).sweep();
    expect(f.mock.listRequests()).toHaveLength(1);
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);
  });

  test('[2b-P7d] closed path: a merged PR from the build’s branch whose author has no write access is not adopted', async () => {
    const { w, mock } = closedWithSibling({ sibling: { state: 'closed', merged: true } });
    mock.branchPulls = [
      { number: 202, state: 'closed', merged: true, authorAssociation: 'CONTRIBUTOR' },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.todoRow().phase).toBe('failed');
  });

  test('[2b-P7g] closed path: a newer PR closed unmerged sets the rejection floor whoever authored it (the list does not say who closed it) → the older merged PR is not adopted', async () => {
    const { w, mock } = closedWithSibling({ sibling: { state: 'closed', merged: true } });
    headRefs.set(203, conversationBranch(w.buildId));
    mock.branchPulls = [
      { number: 203, state: 'closed', authorAssociation: 'NONE' },
      { number: 202, state: 'closed', merged: true, authorAssociation: 'OWNER' },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.todoRow().phase).toBe('failed');
  });

  test.each(['NONE', 'CONTRIBUTOR', null] as const)(
    '[2b-P7h] foreign path: own #150 merged by OWNER, own #160 by %s closed unmerged → nothing adopted (pr-gate 1509 run 2, correctness)',
    async (association) => {
      const f = foreignWorld();
      headRefs.set(150, f.own);
      headRefs.set(160, f.own);
      f.mock.branchPulls = [
        { number: 160, state: 'closed', authorAssociation: association },
        { number: 150, state: 'closed', merged: true, authorAssociation: 'OWNER' },
      ];
      await pollerFor(f.w, f.mock).sweep();
      expect(f.currentPr()).toBe(201);
      expect(f.currentRows().some((c) => c.includes('改记为本任务的 PR'))).toBe(false);
      expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);
    },
  );

  test('[2b-P7f] the recorded PR itself shows up open again in the list → no write, whoever opened it', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, authorAssociation: 'NONE' }];
    await sweepTwice(pollerFor(w, mock));
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[2b-P7e] the list parser reads author_association (live capture, docs/verify/1403/live-branch-pulls-assoc.json)', async () => {
    const body: unknown = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, 'fixtures/github', 'branch-pulls-assoc.json'),
        'utf8',
      ),
    );
    const list = await githubBranchPulls(
      () => Promise.resolve(res(200, '"live"', body)),
      null,
      'xiechimon',
      'cairn',
      { head: 'xiechimon:claude/bootstrap-p2-seg2', base: 'main' },
    );
    expect(list).toEqual([
      {
        number: 1489,
        state: 'closed',
        merged: true,
        headRef: 'claude/bootstrap-p2-seg2',
        headRepoId: 1361226985,
        baseRef: 'main',
        baseRepoId: 1361226985,
        authorAssociation: 'OWNER',
      },
    ]);
  });

  test('[s2-T2] a verify or review step created after the completion row does not start a new round', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const later = Date.now() + 1_000;
    for (const kind of ['verify', 'review'] as const) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${kind}-late-${w.buildId}`,
          buildId: w.buildId,
          kind,
          status: 'done',
          createdAt: later,
        })
        .run();
    }
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[s2-T3] the first closed sighting is dropped when the card leaves review', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    w.s.db.update(todoTable).set({ phase: 'planning' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep(t0 + 60_000);
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 180_000);
    expect(w.todoRow().phase).toBe('failed');
  });

  test.each([
    ['T4', 'failed'],
    ['T5', 'stopped'],
  ] as const)(
    '[s2-%s] a %s build step that pushed a commit does not decide containment',
    async (_id, status) => {
      const built = 'a'.repeat(40);
      const other = 'b'.repeat(40);
      const w = makeWorld({ connected: true, checkpoint: built });
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${status}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'build',
          status,
          checkpointCommit: other,
          createdAt: Date.now(),
          lastHeartbeatAt: Date.now(),
        })
        .run();
      const mock = new PullsMock({
        [w.prNumber]: {
          state: 'closed',
          merged: true,
          headSha: built,
          compareByBase: { [other]: 'diverged' },
        },
      });
      await pollerFor(w, mock).sweep();
      expect(mock.compareRequests()).toEqual([]);
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test('[s2-T6] finishing the card stops queued gate steps only: a claimed verify step is left alone', () => {
    const w = makeWorld({ inflight: 'claimed', inflightKind: 'verify' });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('claimed');
  });
});
