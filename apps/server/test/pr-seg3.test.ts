import { conversationBranch, type Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { type BuildDeps, completeStep, lastPushedCheckpoint } from '../src/services/builds.js';
import {
  CI_EMPTY_CHECKS_GRACE_MS,
  CI_FIX_PROMPT_HEAD,
  CI_MERGE_CONFLICT_PROMPT_HEAD,
  createCiPoller,
} from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, type TestServer } from './helpers.js';

vi.mock('../src/services/machine-gate-port.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  evaluateProductGate: vi.fn(async () => ({
    ready: true,
    headSha: 'f'.repeat(40),
    patchDigest: 'legacy-reconcile-audited-patch',
    policy: 'human',
    blockers: [],
  })),
}));

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const HEAD = 'a1b2c3d4'.repeat(5);
const OLD = '0f1e2d3c'.repeat(5);
const REPO_ID = 4242;
const PUSHED = '5e6f7a8b'.repeat(5);

interface Run {
  name: string;
  status?: string;
  conclusion?: string | null;
  summary?: string;
}

function reply(status: number, body: unknown, etag = '"e"', extra: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (n: string) => (n.toLowerCase() === 'etag' ? etag : (extra[n.toLowerCase()] ?? null)),
    },
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
  };
}

class Fake {
  requests: string[] = [];
  headSha = HEAD;
  mergeableState: string | null = 'clean';
  pullStatus: number | 'throw' = 200;
  protection: { contexts: string[]; checks: string[] } | null | number = null;
  rules: string[] | number = [];
  rulesRateLimit: 'header' | 'text' | 'sso' | null = null;
  enforcement: string | null = null;
  runs: Record<string, Run[]> = {};
  onPull: (() => void) | null = null;
  pullState: 'open' | 'closed' = 'open';
  headRepoId: number | null = REPO_ID;
  headRef: string | null = null;
  headRefMissing = false;
  baseRef = 'main';
  defaultBranch = 'main';
  rulesMessage = 'x';

  reads = (part: string) => this.requests.filter((u) => u.includes(part));

  readonly fetch: FetchLike = async (input, init) => {
    const url = String(input);
    this.requests.push(url);
    if (/\/pulls\/\d+$/.test(url)) {
      this.onPull?.();
      if (this.pullStatus === 'throw') throw new TypeError('fetch failed');
      if (this.pullStatus !== 200) return reply(this.pullStatus, { message: 'x' });
      return reply(200, {
        number: Number(url.split('/').at(-1)),
        state: this.pullState,
        merged: false,
        title: 'demo',
        author_association: 'OWNER',
        ...(this.mergeableState === null ? {} : { mergeable_state: this.mergeableState }),
        head: {
          sha: this.headSha,
          ref: this.headRefMissing ? undefined : (this.headRef ?? this.branch),
          repo: this.headRepoId === null ? null : { id: this.headRepoId },
        },
        base: { ref: this.baseRef, repo: { id: REPO_ID, default_branch: this.defaultBranch } },
      });
    }
    if (/\/rules\/branches\//.test(url)) {
      if (typeof this.rules === 'number') {
        if (this.rulesRateLimit === 'header') {
          return reply(this.rules, { message: 'x' }, '"e"', { 'x-ratelimit-remaining': '0' });
        }
        if (this.rulesRateLimit === 'sso') {
          return reply(
            this.rules,
            { message: 'Resource protected by organization SAML enforcement.' },
            '"e"',
            {
              'x-github-sso': 'required; url=https://github.com/orgs/octo/sso',
            },
          );
        }
        const message =
          this.rulesRateLimit === 'text'
            ? 'You have exceeded a secondary rate limit.'
            : this.rulesMessage;
        return reply(this.rules, { message });
      }
      return reply(
        200,
        this.rules.length === 0
          ? []
          : [
              {
                type: 'required_status_checks',
                parameters: {
                  strict_required_status_checks_policy: true,
                  required_status_checks: this.rules.map((context) => ({ context })),
                },
              },
            ],
      );
    }
    if (/\/repos\/octo\/demo\/branches\/[^?]+$/.test(url)) {
      const p = this.protection;
      if (typeof p === 'number') return reply(p, { message: 'x' });
      return reply(200, {
        name: 'main',
        protected: p !== null,
        protection:
          p === null
            ? { enabled: false, required_status_checks: { contexts: [], checks: [] } }
            : {
                enabled: true,
                required_status_checks: {
                  ...(this.enforcement === null ? {} : { enforcement_level: this.enforcement }),
                  contexts: p.contexts,
                  checks: p.checks.map((context) => ({ context, app_id: null })),
                  strict: true,
                },
              },
      });
    }
    const cr = url.match(/\/commits\/([^/]+)\/check-runs/);
    if (cr !== null) {
      const runs = this.runs[decodeURIComponent(cr[1] ?? '')] ?? [];
      const etag = `"runs-${JSON.stringify(runs).length}"`;
      if (init?.headers?.['if-none-match'] === etag) return reply(304, {}, etag);
      return reply(
        200,
        {
          total_count: runs.length,
          check_runs: runs.map((r) => ({
            name: r.name,
            status: r.status ?? 'completed',
            conclusion: r.conclusion === undefined ? 'success' : r.conclusion,
            head_sha: decodeURIComponent(cr[1] ?? ''),
            output: { title: null, summary: r.summary ?? null },
          })),
        },
        etag,
      );
    }
    return reply(404, { message: 'Not Found' });
  };

  branch = '';
}

interface World {
  s: TestServer;
  fake: Fake;
  deps: BuildDeps;
  todoId: string;
  buildId: string;
  phase(): Phase;
  setPhase(p: Phase): void;
  systemRows(): string[];
  steps(): { kind: string; status: string; prompt: string | null }[];
  poller: ReturnType<typeof createCiPoller>;
}

let seq = 0;
function makeWorld(
  opts: {
    phase?: Phase;
    connected?: boolean;
    anonIpReadsPerHour?: number;
    projectId?: string;
    s?: TestServer;
    fake?: Fake;
  } = {},
): World {
  seq += 1;
  const fake = opts.fake ?? new Fake();
  const s = opts.s ?? bootServer();
  if (opts.s === undefined) disposables.push(() => s.dispose());
  const rnd = `${seq}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = opts.projectId ?? `proj-s3-${rnd}`;
  const todoId = `todo-s3-${rnd}`;
  const buildId = `build-s3-${rnd}`;
  const base = Date.now();
  if (opts.projectId === undefined) {
    s.db
      .insert(projectTable)
      .values({
        id: projectId,
        name: `s3-${rnd}`,
        teamId: s.team.id,
        repoKind: 'github',
        githubRepo: 'octo/demo',
      })
      .run();
  }
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'seg3',
      spec: 'do it',
      phase: opts.phase ?? 'building',
      phaseAt: base,
      seqNum: seq,
      hasChanges: true,
      assignment: { plan: null, build: null },
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
      prUrl: 'https://github.com/octo/demo/pull/201',
      prNumber: 201,
    })
    .run();
  s.db.update(todoTable).set({ latestBuildId: buildId }).where(eq(todoTable.id, todoId)).run();
  s.db
    .insert(stepTable)
    .values({
      id: `step-b-${rnd}`,
      buildId,
      kind: 'build',
      status: 'done',
      checkpointCommit: HEAD,
      createdAt: base - 30_000,
    })
    .run();
  if (opts.connected !== false && opts.s === undefined) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'gho_s3', scope: 'repo' },
    );
  }
  fake.branch = conversationBranch(buildId);
  const deps: BuildDeps = { ...s.svc, box: s.secretBox, githubFetch: fake.fetch };
  const poller = createCiPoller(
    { ...s.svc, box: s.secretBox },
    {
      githubFetch: fake.fetch,
      ...(opts.anonIpReadsPerHour !== undefined
        ? { anonIpReadsPerHour: opts.anonIpReadsPerHour }
        : {}),
    },
  );
  return {
    s,
    fake,
    deps,
    todoId,
    buildId,
    poller,
    phase: () =>
      s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase as Phase,
    setPhase: (p) => s.db.update(todoTable).set({ phase: p }).where(eq(todoTable.id, todoId)).run(),
    systemRows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .filter((r) => r.role === 'system')
        .map((r) => String(r.content)),
    steps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .filter((r) => r.id !== `step-b-${rnd}`)
        .map((r) => ({ kind: r.kind, status: r.status, prompt: r.prompt })),
  };
}

const fixSteps = (w: World) =>
  w.steps().filter((r) => (r.prompt ?? '').startsWith(CI_FIX_PROMPT_HEAD));
const conflictSteps = (w: World) =>
  w.steps().filter((r) => (r.prompt ?? '').startsWith(CI_MERGE_CONFLICT_PROMPT_HEAD));

describe('#1403 segment 3: checks by head SHA, required checks, BEHIND / DIRTY', () => {
  test('[s3-F1] the grind reads the PR, then the check runs of its head SHA (not the branch name)', async () => {
    const w = makeWorld();
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.fake.reads('/pulls/201')).toHaveLength(1);
    expect(w.fake.reads('/check-runs')).toEqual([
      expect.stringContaining(`/repos/octo/demo/commits/${HEAD}/check-runs`),
    ]);
    expect(w.fake.reads(encodeURIComponent(w.fake.branch))).toEqual([]);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F2] a new head with no required run yet is pending, even when the old head was green', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check'], checks: [] };
    w.fake.runs[OLD] = [{ name: 'check' }];
    w.fake.runs[HEAD] = [];
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(w.steps()).toEqual([]);
  });

  test.each(['neutral', 'skipped', 'cancelled'])(
    '[s3-F3] a required check concluding %s: no advance, no fix round, one hint per round',
    async (conclusion) => {
      const w = makeWorld();
      w.fake.protection = { contexts: ['check'], checks: [] };
      w.fake.runs[HEAD] = [{ name: 'check', conclusion }];
      const t0 = Date.now();
      await w.poller.sweep(t0);
      await w.poller.sweep(t0 + 60_000);
      expect(w.phase()).toBe('building');
      expect(fixSteps(w)).toEqual([]);
      const hints = w.systemRows().filter((c) => c.includes('「check」'));
      expect(hints).toHaveLength(1);
      expect(hints[0]).toContain(conclusion);
    },
  );

  test('[s3-F4] a missing required check is pending; past the empty-checks grace it is a blocked hint (a commit status or a run past page 1 is not read), never green', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check', 'e2e'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'check' }];
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.systemRows()).toEqual([]);
    await w.poller.sweep(t0 + CI_EMPTY_CHECKS_GRACE_MS + 60_000);
    expect(w.phase()).toBe('building');
    expect(w.steps()).toEqual([]);
    const hints = w.systemRows().filter((c) => c.includes('「e2e」'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('missing');
  });

  test('[s3-F4b] no run at all with a required list: pending past the grace (not "no CI")', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check'], checks: [] };
    const t0 = Date.now();
    await w.poller.sweep(t0);
    await w.poller.sweep(t0 + CI_EMPTY_CHECKS_GRACE_MS + 60_000);
    expect(w.phase()).toBe('building');
  });

  test('[s3-F5] a non-required check fails while the required ones pass: green', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'check' }, { name: 'lint', conclusion: 'failure' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
    expect(fixSteps(w)).toEqual([]);
  });

  test('[s3-F6b] a required check concluding action_required (a person must approve): blocked hint, no [ci-fix]', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'action_required' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(fixSteps(w)).toEqual([]);
    expect(w.systemRows().filter((c) => c.includes('action_required'))).toHaveLength(1);
  });

  test('[s3-F8c] a failed required-list read is not retried by the next candidate in the same sweep', async () => {
    const a = makeWorld();
    const b = makeWorld({ s: a.s, fake: a.fake, projectId: undefined });
    a.fake.protection = 500;
    const t0 = Date.now();
    await a.poller.sweep(t0);
    expect(a.fake.reads('/demo/branches/main')).toHaveLength(1);
    expect(a.phase()).toBe('building');
    expect(b.phase()).toBe('building');
    await a.poller.sweep(t0 + 60_000);
    expect(a.fake.reads('/demo/branches/main')).toHaveLength(2);
  });

  test.each(['failure', 'timed_out'])(
    '[s3-F6] a required check concluding %s: a [ci-fix] round',
    async (conclusion) => {
      const w = makeWorld();
      w.fake.protection = { contexts: ['check'], checks: [] };
      w.fake.runs[HEAD] = [{ name: 'check', conclusion, summary: 'broke' }];
      await w.poller.sweep();
      expect(w.phase()).toBe('building');
      expect(fixSteps(w)).toHaveLength(1);
      expect(fixSteps(w)[0]?.prompt).toContain('check');
    },
  );

  test('[s3-F7] no required list: neutral and skipped do not block, cancelled does', async () => {
    const ok = makeWorld();
    ok.fake.runs[HEAD] = [
      { name: 'a' },
      { name: 'b', conclusion: 'neutral' },
      { name: 'c', conclusion: 'skipped' },
    ];
    await ok.poller.sweep();
    expect(ok.phase()).toBe('review');
    const blocked = makeWorld();
    blocked.fake.runs[HEAD] = [{ name: 'a' }, { name: 'b', conclusion: 'cancelled' }];
    await blocked.poller.sweep();
    expect(blocked.phase()).toBe('building');
    expect(fixSteps(blocked)).toEqual([]);
    expect(blocked.systemRows().filter((c) => c.includes('「b」'))).toHaveLength(1);
  });

  test('[s3-F7b] no required list: action_required (waiting for a person) blocks too', async () => {
    const w = makeWorld();
    w.fake.runs[HEAD] = [{ name: 'a' }, { name: 'b', conclusion: 'action_required' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(fixSteps(w)).toEqual([]);
    expect(w.systemRows().filter((c) => c.includes('「b」'))).toHaveLength(1);
  });

  test('[s3-F26c] a name with one success passes although a sibling run of that name failed', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check'], checks: [] };
    w.fake.runs[HEAD] = [
      { name: 'check', conclusion: 'failure' },
      { name: 'check', conclusion: 'success' },
    ];
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
    expect(fixSteps(w)).toEqual([]);
  });

  const pushedJustNow = (w: World, at: number) =>
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-p-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        prompt: `${CI_FIX_PROMPT_HEAD} round 1`,
        checkpointCommit: PUSHED,
        createdAt: at - 2_000,
        finishedAt: at - 1_000,
      })
      .run();

  test('[s3-F30] right after cairn pushed, a PR read still on the old head is waited out: no fix round, no merge-conflict round', async () => {
    const w = makeWorld();
    const t0 = Date.now();
    pushedJustNow(w, t0);
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'failure' }];
    await w.poller.sweep(t0);
    expect(fixSteps(w)).toHaveLength(1);
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep(t0 + 60_000);
    expect(conflictSteps(w)).toEqual([]);
    expect(w.phase()).toBe('building');
  });

  test('[s3-F30b] past the grace the PR head decides (a person may have pushed on top)', async () => {
    const w = makeWorld();
    const t0 = Date.now();
    pushedJustNow(w, t0);
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'failure' }];
    await w.poller.sweep(t0 + CI_EMPTY_CHECKS_GRACE_MS + 1_000);
    expect(fixSteps(w)).toHaveLength(2);
  });

  test('[s3-F30d] a verify step that pushed just now also counts as cairn’s last push', async () => {
    const w = makeWorld({ phase: 'review' });
    const t0 = Date.now();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-vp-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        checkpointCommit: PUSHED,
        createdAt: t0 - 2_000,
        finishedAt: t0 - 1_000,
      })
      .run();
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep(t0);
    expect(conflictSteps(w)).toEqual([]);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F30e] a later step that pushed nothing does not hide cairn’s last push', async () => {
    const w = makeWorld({ phase: 'review' });
    const t0 = Date.now();
    pushedJustNow(w, t0);
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-np-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        createdAt: t0 - 800,
        finishedAt: t0 - 500,
      })
      .run();
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep(t0);
    expect(conflictSteps(w)).toEqual([]);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F30c] at review, a dirty read on the head before cairn’s last push is waited out', async () => {
    const w = makeWorld({ phase: 'review' });
    const t0 = Date.now();
    pushedJustNow(w, t0);
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep(t0);
    expect(conflictSteps(w)).toEqual([]);
    expect(w.phase()).toBe('review');
  });

  test.each([
    ['the branch read answers 500', { protection: 500 }],
    ['the branch read answers 404', { protection: 404 }],
    ['the rules read answers 429', { rules: 429 }],
    ['the rules read answers 403 with x-ratelimit-remaining 0', { rules: 403, rl: 'header' }],
    ['the rules read answers 403 with a rate-limit message', { rules: 403, rl: 'text' }],
    ['the rules read answers 403 asking for SAML SSO (x-github-sso)', { rules: 403, rl: 'sso' }],
  ] as const)('[s3-F8] %s: no move, no check-runs read', async (_name, o) => {
    const w = makeWorld();
    if ('protection' in o) w.fake.protection = o.protection;
    if ('rules' in o) w.fake.rules = o.rules;
    if ('rl' in o) w.fake.rulesRateLimit = o.rl;
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.fake.reads('/check-runs')).toEqual([]);
    expect(w.phase()).toBe('building');
    expect(w.steps()).toEqual([]);
  });

  test('[s3-F9] required names: classic contexts, classic checks and ruleset checks together', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['a'], checks: ['b'] };
    w.fake.rules = ['c'];
    w.fake.runs[HEAD] = [{ name: 'a' }, { name: 'b' }];
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.phase()).toBe('building');
    w.fake.runs[HEAD] = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    await w.poller.sweep(t0 + 60_000);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F9b] classic protection with enforcement_level off: its contexts are not required', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['stale'], checks: [] };
    w.fake.enforcement = 'off';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
  });

  test('[s3-F9c] a default branch with a slash keeps the slash in the branch and rules paths', async () => {
    const w = makeWorld();
    w.fake.defaultBranch = 'release/main';
    w.fake.baseRef = 'release/main';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.fake.reads('/repos/octo/demo/branches/release/main')).toHaveLength(1);
    expect(w.fake.reads('/rules/branches/release/main')).toHaveLength(1);
    expect(w.fake.reads('%2F')).toEqual([]);
  });

  test('[s3-F10] the required list is read once per repository and branch for ten minutes', async () => {
    const one = makeWorld();
    const two = makeWorld({ s: one.s, fake: one.fake, projectId: undefined });
    one.fake.protection = { contexts: ['check'], checks: [] };
    const t0 = Date.now();
    await one.poller.sweep(t0);
    await one.poller.sweep(t0 + 60_000);
    expect(one.fake.reads('/demo/branches/main')).toHaveLength(1);
    expect(one.fake.reads('/rules/branches/main')).toHaveLength(1);
    await one.poller.sweep(t0 + 600_001);
    expect(one.fake.reads('/demo/branches/main')).toHaveLength(2);
    expect(two.todoId).not.toBe(one.todoId);
  });

  test.each([
    ['502', 502],
    ['a network error', 'throw'],
  ] as const)(
    '[s3-F11] the PR read fails (%s): no check-runs read, no move',
    async (_name, status) => {
      const w = makeWorld();
      w.fake.pullStatus = status;
      w.fake.runs[HEAD] = [{ name: 'check' }];
      await w.poller.sweep();
      expect(w.fake.reads('/check-runs')).toEqual([]);
      expect(w.phase()).toBe('building');
    },
  );

  test('[s3-F12] dirty at building: one [merge-conflict] step on the same build, no [ci-fix]', async () => {
    const w = makeWorld();
    w.fake.mergeableState = 'dirty';
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'failure' }];
    await w.poller.sweep();
    expect(conflictSteps(w)).toHaveLength(1);
    const prompt = conflictSteps(w)[0]?.prompt ?? '';
    expect(prompt).toContain('origin/main');
    expect(prompt).toContain('force-push');
    expect(prompt).toContain('PR #201');
    expect(fixSteps(w)).toEqual([]);
    expect(w.phase()).toBe('building');
  });

  test('[s3-F13] dirty at review: the card goes back to queued with one [merge-conflict] step', async () => {
    const w = makeWorld({ phase: 'review' });
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep();
    expect(w.phase()).toBe('queued');
    expect(conflictSteps(w)).toEqual([
      expect.objectContaining({ kind: 'build', status: 'pending' }),
    ]);
  });

  test('[s3-F14] dirty after two merge-conflict rounds: no third step, one hint per round', async () => {
    const w = makeWorld();
    for (const i of [1, 2]) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-mc-${i}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'build',
          status: 'done',
          prompt: `${CI_MERGE_CONFLICT_PROMPT_HEAD} round ${i}`,
          createdAt: Date.now() - 1_000 + i,
        })
        .run();
    }
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    await w.poller.sweep(t0 + 60_000);
    expect(conflictSteps(w)).toHaveLength(2);
    expect(w.phase()).toBe('failed');
    const build = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get();
    expect(build?.errorMessage).toContain('冲突');
  });

  test('[s3-F14b] dirty after two merge-conflict rounds at review: no third step, the card stays, one hint per round', async () => {
    const w = makeWorld({ phase: 'review' });
    for (const i of [1, 2]) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-mc-${i}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'build',
          status: 'done',
          prompt: `${CI_MERGE_CONFLICT_PROMPT_HEAD} round ${i}`,
          createdAt: Date.now() - 1_000 + i,
        })
        .run();
    }
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    await w.poller.sweep(t0 + 60_000);
    expect(conflictSteps(w)).toHaveLength(2);
    expect(w.phase()).toBe('review');
    expect(w.systemRows().filter((c) => c.includes('冲突'))).toHaveLength(1);
  });

  test('[s3-F13b] dirty at review stops the unclaimed verify step before the card goes back to queued', async () => {
    const w = makeWorld({ phase: 'review' });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-v-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep();
    expect(w.phase()).toBe('queued');
    expect(w.steps().find((r) => r.kind === 'verify')?.status).toBe('stopped');
  });

  const withVerifier = (w: World) =>
    w.s.db
      .update(todoTable)
      .set({ assignment: { plan: null, build: null, verify: { agentId: 'agent-verify' } } })
      .where(eq(todoTable.id, w.todoId))
      .run();
  const addVerify = (w: World, status: 'pending' | 'stopped') =>
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-v-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status,
        createdAt: Date.now() - 5_000,
        ...(status === 'stopped' ? { finishedAt: Date.now() - 4_000 } : {}),
      })
      .run();

  test('[s3-F13c] a verify step the merge-conflict round stopped is queued again when the grind brings the card back to review', async () => {
    const w = makeWorld({ phase: 'review' });
    withVerifier(w);
    addVerify(w, 'pending');
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.phase()).toBe('queued');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.setPhase('building');
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 60_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['pending', 'stopped']);
  });

  test('[s3-F13e] the card reaches review again in the same round while that verify is still queued: no second verify', async () => {
    const w = makeWorld({ phase: 'review' });
    withVerifier(w);
    addVerify(w, 'pending');
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.setPhase('building');
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 60_000);
    w.setPhase('building');
    await w.poller.sweep(t0 + 120_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['pending', 'stopped']);
  });

  test('[s3-F13f] the re-verify survives a [ci-fix] round after the merge-conflict round', async () => {
    const w = makeWorld({ phase: 'review' });
    withVerifier(w);
    addVerify(w, 'pending');
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.setPhase('building');
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'failure' }];
    await w.poller.sweep(t0 + 60_000);
    expect(fixSteps(w)).toHaveLength(1);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 120_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['pending', 'stopped']);
  });

  test('[s3-F13g] a verify that already ran on the pre-conflict head is queued again after the merge-conflict round', async () => {
    const w = makeWorld({ phase: 'review' });
    withVerifier(w);
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-v-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        createdAt: Date.now() - 5_000,
        finishedAt: Date.now() - 4_000,
      })
      .run();
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.phase()).toBe('queued');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.setPhase('building');
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 60_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['done', 'pending']);
  });

  test('[s3-F13h] an unclaimed AI review step stopped by the merge-conflict round is said in the timeline', async () => {
    const w = makeWorld({ phase: 'review' });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-r-${w.buildId}`,
        buildId: w.buildId,
        kind: 'review',
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep();
    expect(w.steps().find((r) => r.kind === 'review')?.status).toBe('stopped');
    expect(w.systemRows().filter((c) => c.includes('AI 审核步'))).toHaveLength(1);
  });

  test('[s3-F13i] a merge-conflict round at building on a build that already ran a verify queues it again', async () => {
    const w = makeWorld();
    withVerifier(w);
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-v-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        createdAt: Date.now() - 5_000,
        finishedAt: Date.now() - 4_000,
      })
      .run();
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(conflictSteps(w)).toHaveLength(1);
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 60_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['done', 'pending']);
  });

  test('[s3-F13j] a merge-conflict round at building stops an unclaimed verify step and queues it again at review', async () => {
    const w = makeWorld();
    withVerifier(w);
    addVerify(w, 'pending');
    w.fake.mergeableState = 'dirty';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(conflictSteps(w)).toHaveLength(1);
    expect(w.steps().find((r) => r.kind === 'verify')?.status).toBe('stopped');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.kind, 'build')).run();
    w.fake.mergeableState = 'clean';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep(t0 + 60_000);
    expect(w.phase()).toBe('review');
    const verifies = w.steps().filter((r) => r.kind === 'verify');
    expect(verifies.map((r) => r.status).sort()).toEqual(['pending', 'stopped']);
  });

  test('[s3-F13d] a verify step stopped otherwise (by a person) is not queued again when the grind reaches review', async () => {
    const w = makeWorld();
    withVerifier(w);
    addVerify(w, 'stopped');
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
    expect(
      w
        .steps()
        .filter((r) => r.kind === 'verify')
        .map((r) => r.status),
    ).toEqual(['stopped']);
  });

  test('[s3-F26b] a blocked hint names a check once when several runs share its name', async () => {
    const w = makeWorld();
    w.fake.runs[HEAD] = [
      { name: 'build', conclusion: 'cancelled' },
      { name: 'build', conclusion: 'cancelled' },
    ];
    await w.poller.sweep();
    const hint = w.systemRows().find((c) => c.includes('「build」'));
    expect(hint?.split('「build」')).toHaveLength(2);
  });

  test.each([
    ['a fork PR with the same branch name', { headRepoId: 9999 }],
    ['a deleted fork (head repo null)', { headRepoId: null }],
    ['a PR from another branch', { headRef: 'feature/other' }],
    ['a closed PR', { pullState: 'closed' }],
    ['a PR into another base branch', { baseRef: 'release' }],
  ] as const)(
    '[s3-F25] building, the recorded PR is %s: no merge-conflict step; checks are read by the build’s own branch name',
    async (_name, o) => {
      const w = makeWorld();
      Object.assign(w.fake, o);
      w.fake.mergeableState = 'dirty';
      await w.poller.sweep();
      expect(conflictSteps(w)).toEqual([]);
      expect(w.fake.reads('/check-runs')).toEqual([
        expect.stringContaining(`/commits/${encodeURIComponent(w.fake.branch)}/check-runs`),
      ]);
    },
  );

  test.each([
    ['a deleted fork (head repo null)', { headRepoId: null }],
    ['a PR from another branch', { headRef: 'feature/other' }],
    ['a response without head.ref', { headRefMissing: true }],
    ['a PR into another base branch', { baseRef: 'release' }],
  ] as const)(
    '[s3-F25b] review, the recorded PR is %s and dirty: no merge-conflict round',
    async (_name, o) => {
      const w = makeWorld({ phase: 'review' });
      Object.assign(w.fake, o);
      w.fake.mergeableState = 'dirty';
      await w.poller.sweep();
      expect(conflictSteps(w)).toEqual([]);
      expect(w.phase()).toBe('review');
    },
  );

  test('[s3-F26] runs that share a name: one success counts, a cancelled or skipped sibling does not block', async () => {
    const req = makeWorld();
    req.fake.protection = { contexts: ['check'], checks: [] };
    req.fake.runs[HEAD] = [
      { name: 'check', conclusion: 'cancelled' },
      { name: 'check', conclusion: 'success' },
    ];
    await req.poller.sweep();
    expect(req.phase()).toBe('review');
    const none = makeWorld();
    none.fake.runs[HEAD] = [
      { name: 'ci', conclusion: 'skipped' },
      { name: 'ci', conclusion: 'cancelled' },
      { name: 'ci', conclusion: 'success' },
    ];
    await none.poller.sweep();
    expect(none.phase()).toBe('review');
  });

  test.each([
    [403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.'],
    [404, 'Not Found'],
  ] as const)(
    '[s3-F27] the rules read answers %i (%s): no rules, the classic list decides',
    async (status, message) => {
      const w = makeWorld();
      w.fake.rules = status;
      w.fake.rulesMessage = message;
      w.fake.runs[HEAD] = [{ name: 'check' }];
      await w.poller.sweep();
      expect(w.phase()).toBe('review');
    },
  );

  test('[s3-F27b] the rules read answers 403 for the token’s permissions (not the plan): no move', async () => {
    const w = makeWorld();
    w.fake.rules = 403;
    w.fake.rulesMessage = 'Resource not accessible by integration';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('building');
    expect(w.fake.reads('/check-runs')).toEqual([]);
  });

  test('[s3-F12b] a default branch name with shell characters is quoted in the merge-conflict prompt', async () => {
    const w = makeWorld();
    w.fake.defaultBranch = 'main;curl x|sh';
    w.fake.baseRef = 'main;curl x|sh';
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep();
    const prompt = conflictSteps(w)[0]?.prompt ?? '';
    expect(prompt).toContain("git fetch origin 'main;curl x|sh'");
    expect(prompt).toContain("git merge 'origin/main;curl x|sh'");
    expect(prompt).not.toContain('git fetch origin main;');
  });

  test('[s3-F4c] the missing-check grace keeps its start while another required check re-runs', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['a', 'b'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'a' }];
    const t0 = Date.now();
    await w.poller.sweep(t0);
    w.fake.runs[HEAD] = [{ name: 'a', status: 'in_progress', conclusion: null }];
    await w.poller.sweep(t0 + 60_000);
    w.fake.runs[HEAD] = [{ name: 'a' }];
    await w.poller.sweep(t0 + CI_EMPTY_CHECKS_GRACE_MS + 1_000);
    expect(w.systemRows().filter((c) => c.includes('「b」'))).toHaveLength(1);
  });

  test('[s3-F28] the verdict follows a refreshed required list even when the check runs answer 304', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['check', 'gone'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'check' }];
    const t0 = Date.now();
    await w.poller.sweep(t0);
    expect(w.phase()).toBe('building');
    w.fake.protection = { contexts: ['check'], checks: [] };
    await w.poller.sweep(t0 + 600_001);
    expect(w.fake.reads('/check-runs')).toHaveLength(2);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F15] dirty with a step in flight: nothing', async () => {
    const w = makeWorld();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-fly-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    w.fake.mergeableState = 'dirty';
    await w.poller.sweep();
    expect(conflictSteps(w)).toEqual([]);
  });

  test('[s3-F16] the card leaves building during the PR read: no write', async () => {
    const w = makeWorld();
    w.fake.mergeableState = 'dirty';
    w.fake.onPull = () => w.setPhase('closed');
    await w.poller.sweep();
    expect(conflictSteps(w)).toEqual([]);
    expect(w.systemRows()).toEqual([]);
  });

  test('[s3-F16b] the card leaves review during the PR read: no write', async () => {
    const w = makeWorld({ phase: 'review' });
    w.fake.mergeableState = 'dirty';
    w.fake.onPull = () => w.setPhase('closed');
    await w.poller.sweep();
    expect(conflictSteps(w)).toEqual([]);
    expect(w.phase()).toBe('closed');
  });

  test('[s3-F17] behind at review: one hint per round naming update-branch, no request, phase kept', async () => {
    const w = makeWorld({ phase: 'review' });
    w.fake.mergeableState = 'behind';
    const t0 = Date.now();
    await w.poller.sweep(t0);
    await w.poller.sweep(t0 + 60_000);
    const hints = w.systemRows().filter((c) => c.includes('update-branch'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('expected_head_sha');
    expect(w.fake.requests.some((u) => u.includes('update-branch'))).toBe(false);
    expect(w.phase()).toBe('review');
  });

  test('[s3-F17b] behind at building: the checks decide', async () => {
    const w = makeWorld();
    w.fake.mergeableState = 'behind';
    w.fake.runs[HEAD] = [{ name: 'check' }];
    await w.poller.sweep();
    expect(w.phase()).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test.each(['unknown', 'blocked', 'clean', 'unstable', 'has_hooks', 'draft', null])(
    '[s3-F18] mergeable_state %s at review: no BEHIND or DIRTY action',
    async (state) => {
      const w = makeWorld({ phase: 'review' });
      w.fake.mergeableState = state;
      await w.poller.sweep();
      expect(w.phase()).toBe('review');
      expect(w.systemRows()).toEqual([]);
      expect(w.steps()).toEqual([]);
    },
  );

  test('[s3-F19] a blocked-check hint cleans GitHub text', async () => {
    const w = makeWorld();
    w.fake.protection = { contexts: ['chec‮k'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'chec‮k', conclusion: 'cancelled' }];
    await w.poller.sweep();
    const hint = w.systemRows().find((c) => c.includes('cancelled'));
    expect(hint).toBeDefined();
    expect(hint).not.toMatch(/‮/);
    expect(hint).toContain('「check」');
  });

  test('[s3-F20] completeStep writes finishedAt; the last pushed checkpoint follows it', () => {
    const w = makeWorld();
    const now = Date.now();
    const add = (id: string, commit: string, hb: number, finished: number | null) =>
      w.s.db
        .insert(stepTable)
        .values({
          id: `${id}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'verify',
          status: 'done',
          checkpointCommit: commit,
          lastHeartbeatAt: hb,
          finishedAt: finished,
          createdAt: now - 20_000,
        })
        .run();
    add('a', 'aaaaaaaa'.repeat(5), now - 1_000, now - 5_000);
    add('b', 'bbbbbbbb'.repeat(5), now - 9_000, now - 2_000);
    expect(lastPushedCheckpoint(w.deps, w.buildId, { mergeSteps: false })).toBe(
      'bbbbbbbb'.repeat(5),
    );
    const id = `step-c-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({ id, buildId: w.buildId, kind: 'verify', status: 'claimed', createdAt: now })
      .run();
    completeStep(w.deps, id);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get();
    expect(row?.status).toBe('done');
    expect(typeof row?.finishedAt).toBe('number');
  });

  test('[s3-F21] rows without finishedAt keep the old order (last report)', () => {
    const w = makeWorld();
    const now = Date.now();
    w.s.db
      .insert(stepTable)
      .values({
        id: `old-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        checkpointCommit: 'cccccccc'.repeat(5),
        lastHeartbeatAt: now,
        createdAt: now - 10_000,
      })
      .run();
    expect(lastPushedCheckpoint(w.deps, w.buildId, { mergeSteps: false })).toBe(
      'cccccccc'.repeat(5),
    );
  });

  test('[s3-F23] merge-conflict rounds do not count as CI fix rounds', async () => {
    const w = makeWorld();
    for (const i of [1, 2]) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-mc-${i}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'build',
          status: 'done',
          prompt: `${CI_MERGE_CONFLICT_PROMPT_HEAD} round ${i}`,
          createdAt: Date.now() - 1_000 + i,
        })
        .run();
    }
    w.fake.protection = { contexts: ['check'], checks: [] };
    w.fake.runs[HEAD] = [{ name: 'check', conclusion: 'failure' }];
    await w.poller.sweep();
    expect(fixSteps(w)).toHaveLength(1);
    expect(fixSteps(w)[0]?.prompt).toContain('第 1 轮');
  });

  test('[s3-F24] anonymous: the grind’s PR and required-list reads count toward the per-IP total', async () => {
    const w = makeWorld({ connected: false, anonIpReadsPerHour: 5 });
    w.fake.runs[HEAD] = [{ name: 'check', status: 'in_progress', conclusion: null }];
    const r = makeWorld({ phase: 'review', s: w.s, fake: w.fake });
    await w.poller.sweep();
    expect(w.fake.reads('/check-runs')).toHaveLength(1);
    expect(w.fake.reads('/branches/')).toHaveLength(2);
    expect(w.fake.reads('/pulls/')).toHaveLength(1);
    expect(r.phase()).toBe('review');
  });
});
