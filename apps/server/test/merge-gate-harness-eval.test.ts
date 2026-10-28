import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  type CompareFile,
  type MergeReadiness,
} from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import {
  createHarnessEvalCoordinator,
  type HarnessEvalDispatchRequest,
  type HarnessEvalTerminalOutcome,
} from '../src/services/harness-eval-coordinator.js';
import { computePatchDigest } from '../src/services/merge-gate/digest.js';
import { gateStatusFor } from '../src/services/merge-gate/gate-status.js';
import { judgeMergeReadinessWithHarnessEval } from '../src/services/merge-gate/harness-eval-judge.js';
import { prepareHarnessEvalRouting } from '../src/services/merge-gate/harness-eval-route.js';
import {
  type GateInputs,
  type GateVerdictView,
  mergeReadiness,
} from '../src/services/merge-gate/readiness.js';

function reclassify1865MissingStaleAsTransient(r: MergeReadiness): MergeReadiness {
  return {
    ...r,
    blockers: r.blockers.map((b) =>
      b.code === 'harness-regression-missing' || b.code === 'harness-regression-stale'
        ? { ...b, class: 'transient' }
        : b,
    ),
  };
}

const HEAD = 'a'.repeat(40);
const MAIN = 'f'.repeat(40);
const EARLIER = 'e'.repeat(40);
const REPO = 'xiechimon/cairn';
const PR_NUMBER = 1979;
const HARNESS_SHA = 'ab'.repeat(32);
const TRACE_DIGEST = 'cd'.repeat(32);

const file = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: '1'.repeat(40),
  additions: 3,
  deletions: 1,
  patchSha: 'c'.repeat(64),
  ...over,
  filename,
});

const SHOT = file('docs/verify/1979/shot.png', {
  status: 'added',
  additions: 0,
  deletions: 0,
  patchSha: null,
});
const HARNESS_FILES = [
  file('apps/server/src/services/chief.ts'),
  file('apps/server/test/ci-loop.test.ts'),
  SHOT,
];
const DIGEST = computePatchDigest(HARNESS_FILES).patchDigest as string;
const OLD_DIGEST = `pd2:${'0'.repeat(64)}`;

const link = `https://raw.githubusercontent.com/xiechimon/cairn/${HEAD}/docs/verify/1979/shot.png`;

const v = (
  kind: GateVerdictView['kind'],
  outcome: GateVerdictView['outcome'],
  perspective: string | null = null,
): GateVerdictView => ({
  kind,
  outcome,
  perspective,
  patchDigest: DIGEST,
});

function harnessInputs(over: Partial<GateInputs> = {}): GateInputs {
  return {
    policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
    build: { isGithubPr: true, isCurrent: true, phase: 'review', stepsInFlight: 0 },
    repo: { owner: 'xiechimon', name: 'cairn', defaultBranch: 'main' },
    ticketRef: '1979',
    issueNumber: 1979,
    pr: {
      state: 'open',
      merged: false,
      draft: false,
      mergeableState: 'clean',
      baseBehindBy: 0,
      headSha: HEAD,
      baseRef: 'main',
      baseRepoFullName: REPO,
      headRepoFullName: REPO,
      body: `evidence: ${link}`,
      changedFiles: HARNESS_FILES.length,
    },
    checks: {
      headSha: HEAD,
      statusSha: HEAD,
      required: ['check', 'pack-smoke'],
      runs: [
        { name: 'check', headSha: HEAD, status: 'completed', conclusion: 'success' },
        { name: 'pack-smoke', headSha: HEAD, status: 'completed', conclusion: 'success' },
        { name: 'pr-evidence', headSha: HEAD, status: 'completed', conclusion: 'success' },
      ],
      statuses: [],
      complete: true,
    },
    compare: {
      headSha: HEAD,
      files: HARNESS_FILES,
      commits: [
        { sha: EARLIER, parents: [MAIN] },
        { sha: HEAD, parents: [EARLIER] },
      ],
      totalCommits: 2,
    },
    evidence: [{ sha: HEAD, path: SHOT.filename, present: true }],
    verdicts: [
      v('verify', 'pass'),
      v('review', 'pass', 'correctness'),
      v('review', 'pass', 'security'),
      v('review', 'pass', 'design'),
      v('decision', 'pass', 'chief'),
    ],
    round: {
      perspectives: ['correctness', 'security', 'design'],
      timedOut: [],
      fixRoundsExhausted: false,
      fixNoChange: false,
      gateRoundsExhausted: false,
    },
    availability: {
      reviewerPerspectives: ['correctness', 'security', 'design'],
      verifier: true,
      decider: true,
    },
    harnessEvalText: null,
    ...over,
  };
}

function resultJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    patchDigest: DIGEST,
    harness_sha: HARNESS_SHA,
    decision_ok: 0.955,
    trace_digest: TRACE_DIGEST,
    ...over,
  });
}

const worlds: { close(): void; dir: string }[] = [];

afterEach(() => {
  while (worlds.length > 0) {
    const opened = worlds.pop();
    if (opened === undefined) break;
    opened.close();
    rmSync(opened.dir, { recursive: true, force: true });
  }
});

function openWorld(opts: { now?: { value: number }; attemptTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-1979-'));
  const opened = openDbWithHandle(join(dir, 'db.sqlite'));
  worlds.push({ close: opened.close, dir });
  const dispatches: HarnessEvalDispatchRequest[] = [];
  const now = opts.now ?? { value: 1_000_000 };
  let idSeq = 0;
  const coordinator = createHarnessEvalCoordinator({
    db: opened.db,
    dispatch: async (request) => {
      dispatches.push(request);
    },
    now: () => now.value,
    attemptTimeoutMs: opts.attemptTimeoutMs ?? 60_000,
    newId: () => {
      idSeq += 1;
      return `id-${idSeq}`;
    },
  });
  return { coordinator, dispatches, now };
}

async function routeAndRead(
  coordinator: ReturnType<typeof createHarnessEvalCoordinator>,
  inputs: GateInputs,
  need: 'missing' | 'stale' | null,
  dispatchAuthorized: boolean,
) {
  const routed = await prepareHarnessEvalRouting({
    coordinator,
    repo: REPO,
    pr: PR_NUMBER,
    patchDigest: DIGEST,
    need,
    dispatchAuthorized,
  });
  const readiness = mergeReadiness({
    ...inputs,
    harnessEval: { attempt: routed.attempt },
  });
  return { routed, readiness };
}

describe('merge-gate harness eval routing (#1979)', () => {
  test('missing evidence with dispatch authorized: one worker dispatched; readiness shows harness-regression-evaluating (transient)', async () => {
    const { coordinator, dispatches } = openWorld();
    const { routed, readiness } = await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(routed.created).toBe(true);
    expect(routed.dispatched).toBe(true);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.patchDigest).toBe(DIGEST);
    expect(readiness.blockers.map((b) => [b.code, b.class])).toEqual([
      ['harness-regression-evaluating', 'transient'],
    ]);
    expect(gateStatusFor(readiness).state).toBe('pending');
  });

  test('stale evidence: same, bound to the new digest', async () => {
    const { coordinator, dispatches } = openWorld();
    const inputs = harnessInputs({
      harnessEvalText: resultJson({ patchDigest: OLD_DIGEST }),
    });
    const { routed, readiness } = await routeAndRead(coordinator, inputs, 'stale', true);
    expect(routed.created).toBe(true);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.patchDigest).toBe(DIGEST);
    expect(readiness.blockers.map((b) => b.code)).toEqual(['harness-regression-evaluating']);
  });

  test('after a passing result is published, reconcile clears the regression blocker and every unrelated blocker in the fixture is still present', async () => {
    const { coordinator, dispatches } = openWorld();
    const first = await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(first.readiness.blockers.some((b) => b.code === 'harness-regression-evaluating')).toBe(
      true,
    );
    expect(dispatches).toHaveLength(1);
    const attempt = first.routed.attempt;
    expect(attempt).not.toBeNull();
    coordinator.complete(attempt!.id, attempt!.workerId, 'completed');

    const withVerifyMissing: GateInputs = {
      ...harnessInputs({ harnessEvalText: resultJson() }),
      verdicts: harnessInputs().verdicts.filter((x) => x.kind !== 'verify'),
    };
    const after = await routeAndRead(coordinator, withVerifyMissing, null, true);
    expect(after.routed.dispatched).toBe(false);
    expect(dispatches).toHaveLength(1);
    expect(after.readiness.blockers.map((b) => b.code)).toEqual(['verify-missing']);
    expect(after.readiness.blockers.some((b) => b.code.startsWith('harness-regression-'))).toBe(
      false,
    );
  });

  test('a result below 0.924 yields harness-regression-below-threshold (human) and no second dispatch for that digest', async () => {
    const { coordinator, dispatches } = openWorld();
    await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(dispatches).toHaveLength(1);
    const attempt = coordinator.getAttempt({
      repo: REPO,
      pr: PR_NUMBER,
      patchDigest: DIGEST,
    });
    expect(attempt).not.toBeNull();
    coordinator.complete(attempt!.id, attempt!.workerId, 'completed');

    const below = harnessInputs({
      harnessEvalText: resultJson({
        decision_ok: CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER - 0.001,
      }),
    });
    const again = await routeAndRead(coordinator, below, null, true);
    expect(dispatches).toHaveLength(1);
    expect(again.readiness.blockers.map((b) => [b.code, b.class])).toEqual([
      ['harness-regression-below-threshold', 'human'],
    ]);
    const third = await routeAndRead(coordinator, below, 'missing', true);
    expect(dispatches).toHaveLength(1);
    expect(third.readiness.blockers.map((b) => b.code)).toEqual([
      'harness-regression-below-threshold',
    ]);
  });

  test('timeout, unavailable worker, budget refusal, failed eval and rejected publication each end as a human blocker, never pending forever', async () => {
    const cases: HarnessEvalTerminalOutcome[] = [
      'timeout',
      'unavailable_worker',
      'budget_refusal',
      'worker_failure',
      'rejected_publication',
    ];
    for (const outcome of cases) {
      const now = { value: 1_000_000 };
      const { coordinator, dispatches } = openWorld({
        now,
        attemptTimeoutMs: 1_000,
      });
      const routed = await prepareHarnessEvalRouting({
        coordinator,
        repo: REPO,
        pr: PR_NUMBER,
        patchDigest: DIGEST,
        need: 'missing',
        dispatchAuthorized: true,
      });
      expect(routed.attempt).not.toBeNull();
      if (outcome === 'timeout') {
        now.value = routed.attempt!.deadlineAt;
        coordinator.reconcile(now.value);
      } else {
        expect(routed.dispatched).toBe(true);
        coordinator.complete(routed.attempt!.id, routed.attempt!.workerId, outcome);
      }
      const after = await prepareHarnessEvalRouting({
        coordinator,
        repo: REPO,
        pr: PR_NUMBER,
        patchDigest: DIGEST,
        need: 'missing',
        dispatchAuthorized: true,
      });
      expect(after.dispatched).toBe(false);
      expect(dispatches).toHaveLength(1);
      const readiness = mergeReadiness({
        ...harnessInputs(),
        harnessEval: { attempt: after.attempt },
      });
      const harness = readiness.blockers.filter((b) => b.code.startsWith('harness-regression-'));
      expect(harness).toHaveLength(1);
      expect(harness[0]?.code).toBe('harness-regression-missing');
      expect(harness[0]?.class).toBe('human');
      expect(gateStatusFor(readiness).state).toBe('failure');
    }
  });

  test('with another transient blocker present (e.g. verify-missing), a terminal coordinator failure still makes gate-status failure, not pending', async () => {
    const { coordinator } = openWorld();
    const claimed = await prepareHarnessEvalRouting({
      coordinator,
      repo: REPO,
      pr: PR_NUMBER,
      patchDigest: DIGEST,
      need: 'missing',
      dispatchAuthorized: true,
    });
    coordinator.complete(claimed.attempt!.id, claimed.attempt!.workerId, 'worker_failure');
    const inputs: GateInputs = {
      ...harnessInputs(),
      verdicts: harnessInputs().verdicts.filter((x) => x.kind !== 'verify'),
      harnessEval: {
        attempt: coordinator.getAttempt({
          repo: REPO,
          pr: PR_NUMBER,
          patchDigest: DIGEST,
        }),
      },
    };
    const readiness = mergeReadiness(inputs);
    expect(readiness.blockers.map((b) => b.code).sort()).toEqual(
      ['harness-regression-missing', 'verify-missing'].sort(),
    );
    expect(gateStatusFor(readiness).state).toBe('failure');
  });

  test('repeated reconcile and an evidence-only head update do not dispatch again', async () => {
    const { coordinator, dispatches } = openWorld();
    const first = await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(dispatches).toHaveLength(1);
    const second = await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(second.routed.created).toBe(false);
    expect(second.routed.dispatched).toBe(false);
    expect(dispatches).toHaveLength(1);
    const evidenceOnlyHead = harnessInputs({
      pr: {
        ...harnessInputs().pr!,
        headSha: 'b'.repeat(40),
      },
      checks: {
        ...harnessInputs().checks!,
        headSha: 'b'.repeat(40),
        statusSha: 'b'.repeat(40),
        runs: harnessInputs().checks!.runs.map((r) => ({ ...r, headSha: 'b'.repeat(40) })),
      },
      compare: {
        ...(harnessInputs().compare as Exclude<GateInputs['compare'], string>),
        headSha: 'b'.repeat(40),
        commits: [
          { sha: EARLIER, parents: [MAIN] },
          { sha: HEAD, parents: [EARLIER] },
          { sha: 'b'.repeat(40), parents: [HEAD] },
        ],
        totalCommits: 3,
      },
      evidence: [{ sha: 'b'.repeat(40), path: SHOT.filename, present: true }],
    });
    const third = await routeAndRead(coordinator, evidenceOnlyHead, 'missing', true);
    expect(third.routed.attempt?.id).toBe(first.routed.attempt?.id);
    expect(dispatches).toHaveLength(1);
  });

  test("#1865's reclassification (missing and stale as transient, no dispatch) fails this suite", async () => {
    const { coordinator, dispatches } = openWorld();
    const missing = mergeReadiness(harnessInputs());
    expect(missing.blockers.map((b) => [b.code, b.class])).toEqual([
      ['harness-regression-missing', 'human'],
    ]);
    const fake = reclassify1865MissingStaleAsTransient(missing);
    expect(fake.blockers[0]?.class).toBe('transient');
    expect(gateStatusFor(fake).state).toBe('pending');
    expect(dispatches).toHaveLength(0);

    const real = await routeAndRead(coordinator, harnessInputs(), 'missing', true);
    expect(dispatches).toHaveLength(1);
    expect(real.readiness.blockers.map((b) => [b.code, b.class])).toEqual([
      ['harness-regression-evaluating', 'transient'],
    ]);
    expect(fake.blockers[0]?.code).not.toBe('harness-regression-evaluating');
  });

  test('production judgeMergeReadinessWithHarnessEval dispatches for missing evidence and attaches a live attempt', async () => {
    const { coordinator, dispatches } = openWorld();
    const judged = await judgeMergeReadinessWithHarnessEval({
      inputs: harnessInputs(),
      coordinator,
      repo: REPO,
      pr: PR_NUMBER,
      dispatchAuthorized: true,
      now: 1_000_000,
    });
    expect(judged.need).toBe('missing');
    expect(judged.routed.dispatched).toBe(true);
    expect(dispatches).toHaveLength(1);
    expect(judged.readiness.blockers.map((b) => [b.code, b.class])).toEqual([
      ['harness-regression-evaluating', 'transient'],
    ]);
    expect(judged.inputs.harnessEval?.attempt?.state).toBe('dispatched');
  });
});
