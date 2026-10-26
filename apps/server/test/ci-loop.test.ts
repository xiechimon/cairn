import { rm } from 'node:fs/promises';
import { conversationBranch, type Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { completeStep } from '../src/services/builds.js';
import {
  buildCiFixPrompt,
  CI_EMPTY_CHECKS_GRACE_MS,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  CI_POLL_INTERVAL_MS,
  type CiCheckFailure,
  createCiPoller,
} from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { finishStep } from '../src/services/machine-finish-step.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
let throttleHome: string;
beforeAll(async () => {
  throttleHome = makeTestTempDir('ci-loop-');
  vi.stubEnv('CAIRN_HOME', throttleHome);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '0');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(throttleHome, { recursive: true, force: true });
  for (const d of disposables) d();
});

export interface CheckSpec {
  name: string;
  status: string;
  conclusion?: string;
  summary?: string;
}

function res(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

function headOf(prNumber: number): string {
  return prNumber.toString(16).padStart(8, '0').repeat(5);
}

class CheckRunsMock {
  requests: { url: string; headers: Record<string, string> }[] = [];
  otherRequests: string[] = [];

  constructor(
    private readonly state: {
      checks: CheckSpec[];
      etag?: string;
      status?: number;
      branch: string;
    },
  ) {}

  readonly fetch = (input: string | URL, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    const pr = url.match(/\/pulls\/(\d+)$/);
    if (pr !== null) {
      this.otherRequests.push(url);
      const n = Number(pr[1]);
      return Promise.resolve(
        res(200, '"pr"', {
          number: n,
          state: 'open',
          merged: false,
          mergeable_state: 'clean',
          head: { sha: headOf(n), ref: this.state.branch, repo: { id: 1 } },
          base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
        }),
      );
    }
    if (/\/rules\/branches\//.test(url)) {
      this.otherRequests.push(url);
      return Promise.resolve(res(200, '"r"', []));
    }
    if (/\/branches\/[^/?]+$/.test(url)) {
      this.otherRequests.push(url);
      return Promise.resolve(res(200, '"b"', { name: 'main', protected: false }));
    }
    this.requests.push({ url, headers: { ...(init?.headers ?? {}) } });
    const etag = this.state.etag ?? '"etag-1"';
    const status = this.state.status ?? 200;
    if (status === 200 && (init?.headers?.['if-none-match'] ?? '') === etag) {
      return Promise.resolve(res(304, etag, {}));
    }
    if (status !== 200) return Promise.resolve(res(status, etag, {}));
    return Promise.resolve(
      res(200, etag, {
        total_count: this.state.checks.length,
        check_runs: this.state.checks.map((c) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion ?? null,
          output: { title: null, summary: c.summary ?? null },
        })),
      }),
    );
  };
}

interface WorldOpts {
  phase?: Phase;
  prNumber?: number;
  fixRounds?: number;
  activeFix?: 'pending' | 'claimed' | 'waiting_quota';
  checks?: CheckSpec[];
  etag?: string;
  status?: number;
}

interface PrWorld {
  s: TestServer;
  teamId: string;
  projectId: string;
  todoId: string;
  buildId: string;
  prNumber: number;
  base: number;
  mock: CheckRunsMock;
  poller: ReturnType<typeof createCiPoller>;
  todoRow(): { phase: string; hasChanges: boolean; v: number };
  buildRow(): { prNumber: number | null; errorMessage: string | null };
  fixRoundSteps(): { id: string; prompt: string | null; status: string }[];
  allSteps(): { id: string; kind: string; status: string; prompt: string | null }[];
}

function makePrWorld(opts: WorldOpts = {}): PrWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const teamId = s.team.id;
  const projectId = `proj-ci-${rnd}`;
  const todoId = `todo-ci-${rnd}`;
  const buildId = `build-ci-${rnd}`;
  const prNumber = opts.prNumber ?? 101;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId,
      title: 'ci loop target',
      spec: 'do it',
      phase: opts.phase ?? 'building',
      phaseAt: base,
      seqNum: 1,
      latestBuildId: buildId,
      assignment: { plan: null, build: { agentId: `agent-ci-${rnd}` } },
    })
    .run();
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
  s.db
    .insert(stepTable)
    .values({
      id: `step-orig-${rnd}`,
      buildId,
      kind: 'build',
      status: 'done',
      machineId: `machine-ci-${rnd}`,
      sessionId: `sess-${rnd}`,
      createdAt: base - 90_000,
    })
    .run();
  const failures: CiCheckFailure[] = [
    { name: 'lint', conclusion: 'failure', summary: 'biome 报 2 处 error' },
  ];
  for (let i = 0; i < (opts.fixRounds ?? 0); i++) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-fix-${rnd}-${i}`,
        buildId,
        kind: 'build',
        status: 'done',
        machineId: `machine-ci-${rnd}`,
        prompt: buildCiFixPrompt({
          prNumber,
          prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
          round: i + 1,
          failures,
        }),
        createdAt: base + i,
      })
      .run();
  }
  if (opts.activeFix !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-live-${rnd}`,
        buildId,
        kind: 'build',
        status: opts.activeFix,
        ...(opts.activeFix === 'claimed'
          ? { machineId: `machine-ci-${rnd}`, claimedAt: base, lastHeartbeatAt: base }
          : {}),
        prompt: buildCiFixPrompt({
          prNumber,
          prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
          round: (opts.fixRounds ?? 0) + 1,
          failures,
        }),
        createdAt: base,
      })
      .run();
  }
  const mock = new CheckRunsMock({
    checks: opts.checks ?? [],
    etag: opts.etag,
    status: opts.status,
    branch: conversationBranch(buildId),
  });
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: mock.fetch });
  return {
    s,
    teamId,
    projectId,
    todoId,
    buildId,
    prNumber,
    base,
    mock,
    poller,
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
    buildRow: () => s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!,
    fixRoundSteps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .filter((r) => (r.prompt ?? '').startsWith(CI_FIX_PROMPT_HEAD)),
    allSteps: () => s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all(),
  };
}

let nextCandidatePr = 1000;

function addCandidate(
  s: TestServer,
  checks: CheckSpec[],
  opts: { prNumber?: number; phase?: Phase } = {},
) {
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const prNumber = opts.prNumber ?? nextCandidatePr++;
  const projectId = `proj-ci-${rnd}`;
  const todoId = `todo-ci-${rnd}`;
  const buildId = `build-ci-${rnd}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `t-${rnd}`,
      spec: '',
      phase: opts.phase ?? 'building',
      phaseAt: base,
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base,
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  return {
    todoId,
    buildId,
    prNumber,
    mock: new CheckRunsMock({ checks, branch: conversationBranch(buildId) }),
  };
}

describe('#1150 (1) scan-surface discipline: batch scan + conditional requests (ETag)', () => {
  test('one sweep = one DB scan taking all candidates, exactly one check-runs GET per candidate, read by the PR head SHA (#1403 segment 3: read the PR first, then read the required-check list by the default branch)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();

    expect(w.mock.requests).toHaveLength(1);
    const req = w.mock.requests[0];
    if (req === undefined) throw new Error('no request made');
    expect(req.url).toContain('https://api.github.com/repos/octo/demo/commits/');
    expect(req.url).toContain(`/commits/${headOf(w.prNumber)}/check-runs`);
    expect(req.url).not.toContain(encodeURIComponent(conversationBranch(w.buildId)));
    expect(w.mock.otherRequests).toEqual([
      'https://api.github.com/repos/octo/demo/pulls/101',
      'https://api.github.com/repos/octo/demo/branches/main',
      'https://api.github.com/repos/octo/demo/rules/branches/main?per_page=100',
    ]);
    expect(req.url).toContain('per_page=');
    expect(req.headers['if-none-match']).toBeUndefined();
    expect(req.headers.accept).toContain('vnd.github+json');
  });

  test('ETag round-trip: first round 200 stores etag, next round carries if-none-match -> 304 -> criteria reused (body not parsed)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, w.todoId)).run();

    await w.poller.sweep();

    expect(w.mock.requests).toHaveLength(2);
    const req2 = w.mock.requests[1];
    if (req2 === undefined) throw new Error('second sweep made no request');
    expect(req2.headers['if-none-match']).toBe('"etag-1"');
    expect(w.todoRow().phase).toBe('review');
  });

  test('batch reconcile: 3 candidates in one round = 3 conditional GETs, red/green/pending three states each landed + reconcile row logged', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const red = addCandidate(s, [
      { name: 'lint', status: 'completed', conclusion: 'failure', summary: '2 errors' },
    ]);
    const green = addCandidate(s, [{ name: 'lint', status: 'completed', conclusion: 'success' }]);
    const pending = addCandidate(s, [{ name: 'e2e', status: 'in_progress' }]);
    const all = [red, green, pending];
    const info = vi.fn();
    const poller = createCiPoller(
      { ...s.svc, box: s.secretBox },
      {
        githubFetch: (input, init) => {
          const url = String(input);
          for (const c of all) {
            if (url.endsWith(`/pulls/${c.prNumber}`) || url.includes(headOf(c.prNumber))) {
              return c.mock.fetch(url, init);
            }
          }
          if (/\/branches\//.test(url)) return red.mock.fetch(url, init);
          throw new Error(`unexpected url ${url}`);
        },
        logger: { info },
      },
    );
    await poller.sweep();

    expect(red.mock.requests).toHaveLength(1);
    expect(green.mock.requests).toHaveLength(1);
    expect(pending.mock.requests).toHaveLength(1);
    const redSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, red.buildId))
      .all()
      .filter((r) => (r.prompt ?? '').startsWith(CI_FIX_PROMPT_HEAD));
    expect(redSteps).toHaveLength(1);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, red.todoId)).get()!.phase).toBe(
      'building',
    );
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, green.todoId)).get()!.phase).toBe(
      'review',
    );
    const pendingTodo = s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, pending.todoId))
      .get()!;
    expect(pendingTodo.phase).toBe('building');
    expect(pendingTodo.v).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    const tally = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(tally.candidates).toBe(3);
    expect(tally.appended).toBe(1);
    expect(tally.advanced).toBe(1);
    expect(tally.pending).toBe(1);
  });

  test('rate-limited/unreadable = fail-open: no rows touched, retried next round (no crash)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      status: 429,
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.todoRow().v).toBe(1);
  });

  test('token ladder: connection row present -> conditional GET carries the Authorization header (checks read via the existing GitHub connection)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.teamId, login: 'octo', accessToken: 'token-plain', scope: 'repo' },
    );
    await w.poller.sweep();
    expect(w.mock.requests[0]?.headers.authorization).toBe('Bearer token-plain');
  });

  test('#1403 when a rerun new build is the todo current build, the old PR build is no longer grinded (checks not read, no fix step dispatched)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    const newer = `${w.buildId}-rerun`;
    w.s.db
      .insert(buildTable)
      .values({
        id: newer,
        todoId: w.todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: w.base,
      })
      .run();
    w.s.db.update(todoTable).set({ latestBuildId: newer }).where(eq(todoTable.id, w.todoId)).run();
    await w.poller.sweep();
    expect(w.mock.requests).toHaveLength(0);
    expect(w.fixRoundSteps()).toHaveLength(0);
  });

  test('scan surface excludes non-candidates: builds without a PR, non-building phases, non-github projects all skip check reads', async () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const noPr = addCandidate(s, []);
    s.db.update(buildTable).set({ prNumber: null }).where(eq(buildTable.id, noPr.buildId)).run();
    const review = addCandidate(s, []);
    s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, review.todoId)).run();
    const notGithub = addCandidate(s, []);
    s.db
      .update(projectTable)
      .set({ repoKind: 'local', githubRepo: null })
      .where(
        eq(
          projectTable.id,
          s.db.select().from(todoTable).where(eq(todoTable.id, notGithub.todoId)).get()!.projectId,
        ),
      )
      .run();
    const urls: string[] = [];
    const poller = createCiPoller(
      { ...s.svc },
      {
        githubFetch: (url) => {
          urls.push(String(url));
          return Promise.resolve(res(404, '"x"', {}));
        },
      },
    );
    await poller.sweep();
    expect(urls.filter((u) => u.includes('/check-runs'))).toEqual([]);
    expect(urls).toEqual([expect.stringMatching(/\/pulls\/\d+$/)]);
  });
});

describe('#1150 (2) pending checks not misjudged red (three-state machine)', () => {
  test('running/queued -> untouched: no fix step, phase unchanged, no errorMessage', async () => {
    const w = makePrWorld({ checks: [{ name: 'e2e', status: 'in_progress' }] });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.todoRow().v).toBe(1);
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('mixed (1 failure completed + 1 queued) -> still pending: not judged red before all complete', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'failure' },
        { name: 'e2e', status: 'queued' },
      ],
    });
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('building');
    expect(w.fixRoundSteps()).toHaveLength(0);
  });

  test('empty checks (repo without CI / race) -> pending untouched within grace; past grace pushed through as green', async () => {
    const w = makePrWorld({ checks: [] });
    await w.poller.sweep(w.base);
    expect(w.todoRow().phase).toBe('building');
    await w.poller.sweep(w.base + CI_EMPTY_CHECKS_GRACE_MS - 1_000);
    expect(w.todoRow().phase).toBe('building');
    await w.poller.sweep(w.base + CI_EMPTY_CHECKS_GRACE_MS + 1_000);
    expect(w.todoRow().phase).toBe('review');
  });
});

describe('#1150 (3) fix-step dead-loop gate (stop after N consecutive red rounds)', () => {
  test('red -> appended fix step: prompt carries the failing check name and log digest + PR number; fix step queued pending', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'failure', summary: 'biome 2 errors' },
        { name: 'typecheck', status: 'completed', conclusion: 'timed_out' },
      ],
    });
    await w.poller.sweep();
    const rounds = w.fixRoundSteps();
    expect(rounds).toHaveLength(1);
    const prompt = rounds[0]?.prompt ?? '';
    expect(prompt).toContain(CI_FIX_PROMPT_HEAD);
    expect(prompt).toContain('lint');
    expect(prompt).toContain('biome 2 errors');
    expect(prompt).toContain('typecheck');
    expect(prompt).toContain(String(w.prNumber));
    expect(prompt).toContain('同一分支');
    expect(rounds[0]?.status).toBe('pending');
    expect(w.todoRow().phase).toBe('building');
  });

  test('fix step in flight -> not double-dispatched (idempotent): the same round sweep does not append a second', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await w.poller.sweep();
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(1);
  });

  test('#1403 a fix step suspended on quota counts as in flight: checks not read, no second appended [ci-fix]', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      activeFix: 'waiting_quota',
    });
    await w.poller.sweep();
    expect(w.mock.requests).toHaveLength(0);
    expect(w.fixRoundSteps().map((r) => r.status)).toEqual(['waiting_quota']);
  });

  test('#1403 an execution step suspended on quota (no marker, e.g. #931 rework round) also counts as in flight: no fix step dispatched', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-rework-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'waiting_quota',
        createdAt: w.base,
      })
      .run();
    await w.poller.sweep();
    expect(w.mock.requests).toHaveLength(0);
    expect(w.fixRoundSteps()).toHaveLength(0);
  });

  test('#1403 an unclaimed verify / review step (queued or waiting on quota) does not block the grind-green; a claimed one does', async () => {
    for (const kind of ['verify', 'review'] as const) {
      for (const status of ['pending', 'waiting_quota'] as const) {
        const w = makePrWorld({
          checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
        });
        w.s.db
          .insert(stepTable)
          .values({
            id: `step-gate-${w.buildId}`,
            buildId: w.buildId,
            kind,
            status,
            createdAt: w.base,
          })
          .run();
        await w.poller.sweep();
        expect(w.mock.requests).toHaveLength(1);
        expect(w.fixRoundSteps()).toHaveLength(1);
      }
    }
    const held = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    held.s.db
      .insert(stepTable)
      .values({
        id: `step-gate-${held.buildId}`,
        buildId: held.buildId,
        kind: 'verify',
        status: 'claimed',
        machineId: 'machine-gate',
        claimedAt: held.base,
        lastHeartbeatAt: held.base,
        createdAt: held.base,
      })
      .run();
    await held.poller.sweep();
    expect(held.mock.requests).toHaveLength(0);
    expect(held.fixRoundSteps()).toHaveLength(0);
  });

  test('round N-1 completed still red -> append round N; round N completed still red -> stop, mark failed, hand to a human (no more dispatch)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      fixRounds: CI_FIX_ROUNDS_MAX - 1,
    });
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(CI_FIX_ROUNDS_MAX);
    expect(w.todoRow().phase).toBe('building');
    expect(w.buildRow().errorMessage).toBeNull();

    for (const r of w.fixRoundSteps()) {
      w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, r.id)).run();
    }
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(CI_FIX_ROUNDS_MAX);
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage).toContain('连续');
    expect(w.buildRow().errorMessage).toContain('转人工');
    const before = w.mock.requests.length;
    await w.poller.sweep();
    expect(w.mock.requests.length).toBe(before);
  });

  test('count criteria = fix-round steps with a marker prompt (original execution steps not counted)', () => {
    const w = makePrWorld({ checks: [], fixRounds: 2 });
    expect(w.allSteps()).toHaveLength(3);
    expect(w.fixRoundSteps()).toHaveLength(2);
  });
});

describe('#1150 (4) poller does not write back when a build was manually advanced/closed (read the current phase first)', () => {
  test('phase already review (human takeover) -> even red does not dispatch or write', async () => {
    const w = makePrWorld({
      phase: 'review',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await w.poller.sweep();
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('phase already closed / failed -> also untouched', async () => {
    const closed = makePrWorld({
      phase: 'closed',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await closed.poller.sweep();
    expect(closed.fixRoundSteps()).toHaveLength(0);
    expect(closed.todoRow().phase).toBe('closed');
    const failed = makePrWorld({
      phase: 'failed',
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    await failed.poller.sweep();
    expect(failed.fixRoundSteps()).toHaveLength(0);
    expect(failed.buildRow().errorMessage).toBeNull();
  });

  test('re-read phase before acting: advanced by a human between the scan snapshot and the write -> not written (race inside the network window)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
    });
    const inner = w.mock.fetch;
    const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
      const p = inner(input, init);
      w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
      return p;
    };
    const poller2 = createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing });
    await poller2.sweep();
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().phase).toBe('review');
  });
});

describe('#1150 green push-through / completeStep holds building / scheduler wiring', () => {
  test('green -> phase advances to the review gate (no fix step dispatched); hasChanges carried without loss', async () => {
    const w = makePrWorld({
      checks: [
        { name: 'lint', status: 'completed', conclusion: 'success' },
        { name: 'e2e', status: 'completed', conclusion: 'success' },
      ],
    });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    await w.poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.fixRoundSteps()).toHaveLength(0);
    expect(w.todoRow().hasChanges).toBe(true);
  });

  test('after green the candidate leaves the grind-green set: another sweep no longer reads checks (moves to the #1403 reconcile surface)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    await w.poller.sweep();
    const checksReads = () => w.mock.requests.filter((r) => r.url.includes('/check-runs')).length;
    const before = checksReads();
    await w.poller.sweep();
    expect(checksReads()).toBe(before);
  });

  test('completeStep: execution step done + PR delivered (prNumber present) -> stays building; no PR -> review (existing behavior)', () => {
    const withPr = makePrWorld({ checks: [] });
    const stepId = `step-run-${Math.random().toString(36).slice(2, 8)}`;
    withPr.s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: withPr.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId}`,
        createdAt: withPr.base,
      })
      .run();
    completeStep(withPr.s.svc, stepId, { hasChanges: true });
    expect(withPr.todoRow().phase).toBe('building');
    expect(withPr.todoRow().hasChanges).toBe(true);

    const noPr = makePrWorld({ checks: [] });
    noPr.s.db
      .update(buildTable)
      .set({ prNumber: null, prUrl: null })
      .where(eq(buildTable.id, noPr.buildId))
      .run();
    const stepId2 = `step-run2-${Math.random().toString(36).slice(2, 8)}`;
    noPr.s.db
      .insert(stepTable)
      .values({
        id: stepId2,
        buildId: noPr.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId2}`,
        createdAt: noPr.base,
      })
      .run();
    completeStep(noPr.s.svc, stepId2, { hasChanges: true });
    expect(noPr.todoRow().phase).toBe('review');

    const hosted = makePrWorld({ checks: [] });
    hosted.s.db
      .update(projectTable)
      .set({ repoKind: 'hosted', githubRepo: null, repoName: 'rework-lifecycle' })
      .where(eq(projectTable.id, hosted.projectId))
      .run();
    const stepId3 = `step-run3-${Math.random().toString(36).slice(2, 8)}`;
    hosted.s.db
      .insert(stepTable)
      .values({
        id: stepId3,
        buildId: hosted.buildId,
        kind: 'build',
        status: 'claimed',
        machineId: `machine-ci-${stepId3}`,
        createdAt: hosted.base,
      })
      .run();
    completeStep(hosted.s.svc, stepId3, { hasChanges: true });
    expect(hosted.todoRow().phase).toBe('review');
  });

  test('scheduler wiring: start() scans immediately + 60s self-loop; stop() stops; tick() does not go outbound (sync contract)', async () => {
    const w = makePrWorld({
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 }, undefined, {
      githubFetch: w.mock.fetch,
      logger: { info: () => {} },
    });
    scheduler.tick();
    expect(w.mock.requests).toHaveLength(0);
    scheduler.start();
    await vi.waitFor(() => {
      expect(w.todoRow().phase).toBe('review');
    });
    expect(w.mock.requests.length).toBeGreaterThanOrEqual(1);
    scheduler.stop();
    expect(CI_POLL_INTERVAL_MS).toBe(60_000);
  });
});

describe('#1533 ci-fix turns green reconciliation ticket', () => {
  test.each([
    ['success', 2, 1],
    ['success', 0, 0],
    ['failure', 1, 0],
    [null, 1, 0],
  ] as const)('%s，修复轮 %s：只在修复后真绿触发', async (conclusion, fixRounds, expected) => {
    const w = makePrWorld({
      fixRounds,
      checks: conclusion === null ? [] : [{ name: 'lint', status: 'completed', conclusion }],
    });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.teamId, login: 'octo', accessToken: 'token-plain', scope: 'repo' },
    );
    const created: { title: string; body: string; labels: string[] }[] = [];
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      {
        githubFetch: (input, init) => {
          if (String(input).includes('/issues')) {
            if (init?.method === 'POST') {
              created.push(JSON.parse(init.body ?? '{}'));
              return Promise.resolve(res(201, '', { number: 200 }));
            }
            return Promise.resolve(res(200, '', []));
          }
          return w.mock.fetch(input, init);
        },
      },
    );
    await poller.sweep();
    expect(created).toHaveLength(expected);
    if (expected) {
      expect(created[0]?.labels).toEqual(['correction', 'enhancement', 'needs-triage']);
      expect(created[0]?.body).toContain('待归因');
      expect(created[0]?.body).toContain('负对照');
      expect(created[0]?.body).toContain('cairn-dedupe: ci-fix:lint');
      expect(w.todoRow().phase).toBe('review');
      w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, w.todoId)).run();
      await poller.sweep();
      expect(created).toHaveLength(1);
    }
  });

  test('ticket-creation failure does not block the review, compensated after restart; another build of the same kind dedupes, a different kind opens separately', async () => {
    const w = makePrWorld({
      fixRounds: 1,
      checks: [{ name: 'lint', status: 'completed', conclusion: 'success' }],
    });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.teamId, login: 'octo', accessToken: 'token-plain', scope: 'repo' },
    );
    let available = false;
    let writes = 0;
    let lists = 0;
    const extra = addCandidate(
      w.s,
      [{ name: 'lint', status: 'completed', conclusion: 'success' }],
      { phase: 'todo' },
    );
    const githubFetch: FetchLike = (input, init) => {
      if (String(input).includes('/issues')) {
        if (!available) return Promise.resolve(res(503, '', {}));
        if (init?.method === 'POST') {
          writes += 1;
          return Promise.resolve(res(201, '', { number: 200 }));
        }
        lists += 1;
        const issue = {
          number: 200,
          state: 'open',
          title: 'correction',
          labels: [{ name: 'correction' }],
          body: '<!-- cairn-dedupe: ci-fix:lint -->',
        };
        return Promise.resolve(
          res(200, '', /\/issues\/200$/.test(String(input)) ? issue : writes > 0 ? [issue] : []),
        );
      }
      if (
        String(input).includes(headOf(extra.prNumber)) ||
        String(input).endsWith(`/pulls/${extra.prNumber}`)
      )
        return extra.mock.fetch(input, init);
      return w.mock.fetch(input, init);
    };
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch }).sweep();
    expect(w.todoRow().phase).toBe('review');
    available = true;
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch }).sweep();
    expect(writes).toBe(1);
    expect(w.todoRow().phase).toBe('review');
    w.s.db
      .insert(stepTable)
      .values({
        id: `${extra.buildId}-fix`,
        buildId: extra.buildId,
        kind: 'build',
        status: 'done',
        createdAt: w.base,
        prompt: buildCiFixPrompt({
          prNumber: extra.prNumber,
          prUrl: null,
          round: 1,
          failures: [
            { name: 'lint', conclusion: 'failure', summary: null },
            { name: 'typecheck', conclusion: 'failure', summary: null },
          ],
        }),
      })
      .run();
    w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, extra.todoId)).run();
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch }).sweep();
    expect(writes).toBe(2);
    expect(lists).toBe(3);
  });
});

describe('#1829 closing push and agent-opened PR recovery', () => {
  test.each([0, CI_FIX_ROUNDS_MAX - 1, CI_FIX_ROUNDS_MAX])(
    'a pre-push rejection after %i ci-fix rounds uses the shared round cap and preserves hook output',
    async (fixRounds) => {
      const w = makePrWorld({ fixRounds });
      w.s.db
        .update(buildTable)
        .set({ prNumber: null, prUrl: null })
        .where(eq(buildTable.id, w.buildId))
        .run();
      const machineId = `machine-${w.buildId}`;
      w.s.db
        .insert(machineTable)
        .values({ id: machineId, teamId: w.teamId, name: 'builder', tokenHash: machineId })
        .run();
      const stepId = `closing-${w.buildId}`;
      w.s.db
        .insert(stepTable)
        .values({
          id: stepId,
          buildId: w.buildId,
          kind: 'build',
          status: 'claimed',
          machineId,
          createdAt: w.base,
        })
        .run();
      const hookOutput = 'pre-push: lint failed: README.md:12 invalid evidence link';
      await finishStep(
        {
          ...w.s.svc,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
          box: w.s.secretBox,
          githubFetch: async () => res(200, '', []),
        },
        machineId,
        stepId,
        {
          status: 'success',
          noOutput: true,
          hasChanges: true,
          pushHookOutput: hookOutput,
        },
      );
      if (fixRounds === CI_FIX_ROUNDS_MAX) {
        expect(w.todoRow().phase).toBe('failed');
        expect(w.fixRoundSteps()).toHaveLength(CI_FIX_ROUNDS_MAX);
        return;
      }
      expect(w.todoRow().phase).toBe('building');
      expect(w.buildRow().errorMessage).toBeNull();
      expect(w.fixRoundSteps()).toHaveLength(fixRounds + 1);
      expect(w.fixRoundSteps().at(-1)).toMatchObject({
        status: 'pending',
        prompt: expect.stringContaining(hookOutput),
      });
      expect(w.fixRoundSteps().at(-1)?.prompt).toContain('same branch');
    },
  );

  test.each(['open', 'closed', 'foreign branch', 'fork', 'unreadable'])(
    'agent-opened PR discovery: %s',
    async (state) => {
      const w = makePrWorld({
        checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }],
      });
      w.s.db
        .update(buildTable)
        .set({ prNumber: null, prUrl: null })
        .where(eq(buildTable.id, w.buildId))
        .run();
      const machineId = `machine-${w.buildId}`;
      w.s.db
        .insert(machineTable)
        .values({ id: machineId, teamId: w.teamId, name: 'builder', tokenHash: machineId })
        .run();
      const stepId = `closing-${w.buildId}`;
      w.s.db
        .insert(stepTable)
        .values({
          id: stepId,
          buildId: w.buildId,
          kind: 'build',
          status: 'claimed',
          machineId,
          createdAt: w.base,
        })
        .run();
      const githubFetch: FetchLike = async (input, init) => {
        if (String(input).includes('/pulls?')) {
          expect(new URL(String(input)).searchParams.get('head')).toBe(
            `octo:${conversationBranch(w.buildId)}`,
          );
          expect(new URL(String(input)).searchParams.get('state')).toBe('open');
          if (state === 'unreadable') return res(503, '', {});
          return res(200, '', [
            {
              number: w.prNumber,
              state: state === 'closed' ? 'closed' : 'open',
              head: {
                ref: state === 'foreign branch' ? 'other' : conversationBranch(w.buildId),
                repo: { id: state === 'fork' ? 2 : 1 },
              },
              base: { ref: 'main', repo: { id: 1 } },
            },
          ]);
        }
        if (String(input).includes('/rules/branches/'))
          return res(200, '', [
            {
              type: 'required_status_checks',
              parameters: { required_status_checks: [{ context: 'lint' }] },
            },
          ]);
        return w.mock.fetch(input, init);
      };
      await finishStep(
        {
          ...w.s.svc,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
          box: w.s.secretBox,
          githubFetch,
        },
        machineId,
        stepId,
        { status: 'success', hasChanges: true },
      );
      if (state !== 'open') {
        expect(w.buildRow().prNumber).toBeNull();
        expect(w.todoRow().phase).toBe('review');
        return;
      }
      expect(w.buildRow().prNumber).toBe(w.prNumber);
      expect(
        w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()?.prUrl,
      ).toBe(`https://github.com/octo/demo/pull/${w.prNumber}`);
      expect(w.todoRow().phase).toBe('building');
      await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch }).sweep();
      expect(w.fixRoundSteps()).toHaveLength(1);
      expect(w.fixRoundSteps()[0]?.prompt).toContain('lint');
    },
  );
});
