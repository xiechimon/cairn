import {
  DEFAULT_AUTONOMY_SETTINGS,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
  REVIEW_VERDICT_KIND,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  build,
  chief,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  plan as planTable,
  project,
  pushDelivery,
  pushDigestItem,
  pushSubscription,
  step,
  team,
  todo,
} from '../src/db/schema.js';
import { completeStep, maybeEnqueueVerifyStep } from '../src/services/builds.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import {
  evaluateMergeGate,
  gateRunMismatch,
  MERGE_GATE_RUN_KIND,
} from '../src/services/merge-gate-run.js';
import { setTodoPhase } from '../src/services/todos.js';
import {
  bootServer,
  postProject,
  seedRoute,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OWNER = 'xiechimon';
const REPO = 'cairn';
const servers: TestServer[] = [];

afterEach(() => {
  for (const s of servers) s.dispose();
  servers.length = 0;
  vi.restoreAllMocks();
});

function ok(body: unknown): GateRaw {
  return { kind: 'ok', status: 200, etag: null, link: null, body };
}

function scriptedPort(
  statuses: { sha: string; state: string; description: string }[],
  options: { checksPending?: boolean; forked?: boolean; additions?: number; body?: string } = {},
): GateGithubPort {
  const shot = 'docs/verify/1794/shot.png';
  const pull = {
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    changed_files: 2,
    mergeable_state: 'clean',
    body: `evidence: https://raw.githubusercontent.com/${OWNER}/${REPO}/${HEAD}/${shot}${options.body ?? ''}`,
    head: {
      sha: HEAD,
      ref: 'lane/1794',
      repo: { full_name: options.forked ? 'another/fork' : `${OWNER}/${REPO}` },
    },
    base: {
      ref: 'main',
      repo: { full_name: `${OWNER}/${REPO}`, default_branch: 'main' },
    },
  };
  const compare = {
    total_commits: 1,
    behind_by: 0,
    commits: [{ sha: HEAD, parents: [{ sha: BASE }] }],
    files: [
      {
        filename: 'apps/server/src/services/merge-gate/readiness.ts',
        status: 'modified',
        sha: '1'.repeat(40),
        additions: options.additions ?? 4,
        deletions: 1,
        patch: '@@ protected\n+gate\n',
      },
      {
        filename: shot,
        status: 'added',
        sha: '2'.repeat(40),
        additions: 0,
        deletions: 0,
      },
    ],
  };
  const runs = [
    {
      id: 1,
      name: 'check',
      status: options.checksPending ? 'in_progress' : 'completed',
      conclusion: 'success',
      head_sha: HEAD,
      app: { id: 1 },
    },
    {
      id: 2,
      name: 'pr-evidence',
      status: 'completed',
      conclusion: 'success',
      head_sha: HEAD,
      app: { id: 1 },
    },
  ];
  return {
    pull: async () => ok(pull),
    branch: async () =>
      ok({
        commit: { sha: BASE },
        protected: true,
        protection: { required_status_checks: { contexts: ['check'] } },
      }),
    branchRules: async () => ok([]),
    compare: async () => ok(compare),
    checkRuns: async () => ok({ total_count: runs.length, check_runs: runs }),
    combinedStatus: async () => ok({ sha: HEAD, state: 'success', total_count: 0, statuses: [] }),
    contents: async (path) =>
      ok([
        {
          type: 'file',
          name: 'shot.png',
          path: path.endsWith('shot.png') ? path : `${path}/shot.png`,
        },
      ]),
    createStatus: async (sha, status) => {
      statuses.push({ sha, state: status.state, description: status.description });
      return ok({});
    },
  };
}

async function world(stepKind: 'build' | 'session' = 'build'): Promise<{
  s: TestServer;
  buildId: string;
  stepId: string;
  reviewerId: string;
}> {
  const s = bootServer();
  servers.push(s);
  const projectId = await postProject(s.app, 'gate', { mergePolicy: 'autonomous' });
  s.db
    .update(project)
    .set({ repoKind: 'github', githubRepo: `${OWNER}/${REPO}` })
    .where(eq(project.id, projectId))
    .run();
  const reviewerId = 'route-reviewer';
  seedSessionRoute(s, { modelId: 'claude-opus-4-8' });
  seedRoute(s, 'review', { id: reviewerId, provider: 'openai-codex', modelId: 'gpt-5.4' });
  seedRoute(s, 'coordinator', { modelId: 'claude-chief' });
  s.db
    .insert(chief)
    .values({
      id: 'chief-1794',
      userId: s.user.id,
      teamId: s.team.id,
      createdAt: 1,
    })
    .run();
  const todoId = 'todo-1794';
  const buildId = 'build-1794';
  const stepId = 'step-build-1794';
  s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'gate',
      phase: 'building',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: buildId,
      sourceKind: 'github-issue',
      sourceRef: `github:${OWNER}/${REPO}#1794`,
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      prNumber: 7,
      prUrl: `https://github.com/${OWNER}/${REPO}/pull/7`,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: stepId,
      buildId,
      kind: stepKind,
      status: 'claimed',
      checkpointCommit: HEAD,
      createdAt: 1,
    })
    .run();
  return { s, buildId, stepId, reviewerId };
}

describe('in-product merge gate', () => {
  test('a finished GitHub build enqueues one review step for the default Reviewer and stays in building', () => {
    return world().then(({ s, buildId, stepId, reviewerId }) => {
      completeStep(s.svc, stepId, { hasChanges: true });
      const reviews = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .filter((row) => row.kind === 'review');
      expect(reviews).toHaveLength(1);
      expect(parseReviewPromptMeta(reviews[0]?.prompt ?? null)?.agentId).toBe(reviewerId);
      expect(reviews[0]?.prompt ?? '').toContain(HEAD);
      expect(s.db.select().from(todo).where(eq(todo.id, 'todo-1794')).get()?.phase).toBe(
        'building',
      );
      completeStep(s.svc, stepId, { hasChanges: true });
      expect(
        s.db
          .select()
          .from(step)
          .where(eq(step.buildId, buildId))
          .all()
          .filter((row) => row.kind === 'review'),
      ).toHaveLength(1);
    });
  });

  test.each(['build', 'session'] as const)(
    'evaluation persists the gate snapshot, records a gate run, and a protected path stays blocked until an independent review is bound (%s author step)',
    async (stepKind) => {
      const { s, buildId, stepId } = await world(stepKind);
      completeStep(s.svc, stepId, { hasChanges: true });
      s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
      const review = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .find((row) => row.kind === 'review');
      expect(review).toBeDefined();
      s.db
        .update(step)
        .set({ status: 'done', finishedAt: 2 })
        .where(eq(step.id, review?.id ?? ''))
        .run();
      const statuses: { sha: string; state: string; description: string }[] = [];
      const missing = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort(statuses) });
      expect(missing?.ready).toBe(false);
      expect(missing?.blockers.map((b) => b.code)).toContain('independent-review-missing');
      expect(missing?.blockers.some((b) => b.code === 'policy-human')).toBe(false);
      expect(s.db.select().from(gateState).where(eq(gateState.buildId, buildId)).get()?.ready).toBe(
        false,
      );
      expect(
        s.db.select().from(gateDigest).where(eq(gateDigest.buildId, buildId)).all().length,
      ).toBe(1);
      expect(s.db.select().from(gateRound).where(eq(gateRound.buildId, buildId)).all().length).toBe(
        1,
      );
      expect(statuses[0]?.sha).toBe(HEAD);
      expect(statuses[0]?.state).toBe('pending');

      const compareBody = {
        files: [
          {
            filename: 'apps/server/src/services/merge-gate/readiness.ts',
            status: 'modified',
            sha: '1'.repeat(40),
            additions: 4,
            deletions: 1,
            patch: '@@ protected\n+gate\n',
          },
          {
            filename: 'docs/verify/1794/shot.png',
            status: 'added',
            sha: '2'.repeat(40),
            additions: 0,
            deletions: 0,
          },
        ],
      };
      const digest = computePatchDigest(compareFilesFromResponse(compareBody) ?? [], {
        expectedFileCount: 2,
      }).patchDigest;
      expect(digest).not.toBeNull();
      s.db
        .insert(gateVerdict)
        .values({
          stepId: review?.id ?? '',
          buildId,
          kind: 'review',
          perspective: 'code_reviewer',
          outcome: 'pass',
          patchDigest: digest,
          headSha: HEAD,
          expectedHeadSha: HEAD,
          createdAt: 3,
        })
        .run();
      s.db
        .insert(message)
        .values({
          id: 'msg-verdict',
          conversationId: buildId,
          role: 'system',
          content: JSON.stringify({
            kind: REVIEW_VERDICT_KIND,
            stepId: review?.id ?? '',
            verdict: {
              conclusion: 'No blocking findings',
              gateLoosening: false,
              evalRulerChange: false,
              findings: [],
            },
          }),
          createdAt: 3,
        })
        .run();
      s.db
        .insert(message)
        .values({
          id: 'msg-assistant-raw',
          conversationId: buildId,
          role: 'assistant',
          content: [
            'End with VERDICT: pass or VERDICT: block.',
            '',
            'VERDICT: pass',
            '',
            'No blocking findings.',
            '',
            'VERDICT: pass',
          ].join('\n'),
          createdAt: 3,
        })
        .run();
      const bound = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(bound?.blockers.map((b) => b.code)).not.toContain('independent-review-missing');
      expect(bound?.ready).toBe(false);
      expect(bound?.blockers.map((b) => b.code)).toEqual(
        expect.arrayContaining(['verify-missing', 'decision-missing']),
      );

      const runs = s.db
        .select()
        .from(message)
        .where(eq(message.conversationId, buildId))
        .all()
        .flatMap((row) => {
          let raw = row.content;
          if (typeof raw === 'string') {
            try {
              raw = JSON.parse(raw) as unknown;
            } catch {
              return [];
            }
          }
          if (
            raw !== null &&
            typeof raw === 'object' &&
            !Array.isArray(raw) &&
            (raw as { kind?: unknown }).kind === MERGE_GATE_RUN_KIND
          ) {
            return [raw as Record<string, unknown>];
          }
          return [];
        });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.modelId).toBe('gpt-5.4');
      expect(runs[0]?.action).toBe('auto-merge-off');
      expect(runs[0]?.parsedVerdict).toBe('pass');
      expect(runs[0]?.structuredOutcome).toBe('pass');
      expect(runs[0]?.mismatch).toBe(false);
      expect(String(runs[0]?.rawOutput)).toContain('VERDICT: pass');

      s.db
        .update(message)
        .set({
          content: JSON.stringify({
            kind: REVIEW_VERDICT_KIND,
            stepId: review?.id ?? '',
            verdict: {
              conclusion: 'Loosens the gate',
              gateLoosening: true,
              evalRulerChange: false,
              findings: [],
            },
          }),
        })
        .where(eq(message.id, 'msg-verdict'))
        .run();
      const loosened = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(loosened?.blockers.map((b) => b.code)).toContain('review-blocking');
    },
  );

  test('a dispatched verify step clears verify-missing once its passing verdict is bound to the patch', async () => {
    const { s, buildId, stepId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db.update(step).set({ status: 'done', finishedAt: 2 }).where(eq(step.id, stepId)).run();
    s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
    const todoRow = s.db.select().from(todo).where(eq(todo.id, 'todo-1794')).get()!;
    maybeEnqueueVerifyStep(s.svc, todoRow, buildId);
    const verify = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'verify');
    expect(verify?.status).toBe('pending');
    expect(parseVerifyPromptMeta(verify?.prompt ?? null)?.expectedHeadSha).toBe(HEAD);

    s.db
      .update(step)
      .set({ status: 'done', finishedAt: 3 })
      .where(eq(step.id, verify?.id ?? ''))
      .run();
    const open = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(open?.blockers.map((b) => b.code)).toContain('verify-missing');
    expect(open?.blockers.map((b) => b.code)).not.toContain('no-verifier');

    const digest = computePatchDigest(
      compareFilesFromResponse({
        files: [
          {
            filename: 'apps/server/src/services/merge-gate/readiness.ts',
            status: 'modified',
            sha: '1'.repeat(40),
            additions: 4,
            deletions: 1,
            patch: '@@ protected\n+gate\n',
          },
          {
            filename: 'docs/verify/1794/shot.png',
            status: 'added',
            sha: '2'.repeat(40),
            additions: 0,
            deletions: 0,
          },
        ],
      }) ?? [],
      { expectedFileCount: 2 },
    ).patchDigest;
    s.db
      .insert(gateVerdict)
      .values({
        stepId: verify?.id ?? '',
        buildId,
        kind: 'verify',
        perspective: null,
        outcome: 'pass',
        patchDigest: digest,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: 4,
      })
      .run();
    const verified = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(verified?.blockers.map((b) => b.code)).not.toContain('verify-missing');
  });

  test.each([
    { shape: 'no plan', plan: null, queued: true },
    { shape: 'plan without verification items', plan: 'no-items', queued: true },
    { shape: 'plan with verification items', plan: 'items', queued: true },
  ] as const)(
    'readiness shape: $shape on a GitHub PR build queues one verify step and clears verify-missing on a passing verdict',
    async ({ plan: planShape, queued }) => {
      const { s, buildId, stepId } = await world();
      if (planShape !== null) {
        s.db
          .insert(planTable)
          .values({
            id: 'plan-shape',
            buildId,
            version: 1,
            content:
              planShape === 'items'
                ? 'Kind: fix\n## Changes\n- a.ts\n\n## Verification\n- `pnpm test` passes\n'
                : '## Context\nNo checklist here.\n',
            createdAt: 1,
          })
          .run();
      }
      completeStep(s.svc, stepId, { hasChanges: true });
      s.db.update(step).set({ status: 'done', finishedAt: 2 }).where(eq(step.id, stepId)).run();
      s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
      const todoRow = s.db.select().from(todo).where(eq(todo.id, 'todo-1794')).get()!;
      maybeEnqueueVerifyStep(s.svc, todoRow, buildId);
      const verifies = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .filter((row) => row.kind === 'verify');
      expect(verifies.length > 0).toBe(queued);
      const before = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(before?.blockers.map((b) => b.code)).toContain('verify-missing');
      const verify = verifies[0];
      if (verify === undefined) return;
      s.db.update(step).set({ status: 'done', finishedAt: 3 }).where(eq(step.id, verify.id)).run();
      const digest = computePatchDigest(
        compareFilesFromResponse({
          files: [
            {
              filename: 'apps/server/src/services/merge-gate/readiness.ts',
              status: 'modified',
              sha: '1'.repeat(40),
              additions: 4,
              deletions: 1,
              patch: '@@ protected\n+gate\n',
            },
            {
              filename: 'docs/verify/1794/shot.png',
              status: 'added',
              sha: '2'.repeat(40),
              additions: 0,
              deletions: 0,
            },
          ],
        }) ?? [],
        { expectedFileCount: 2 },
      ).patchDigest;
      s.db
        .insert(gateVerdict)
        .values({
          stepId: verify.id,
          buildId,
          kind: 'verify',
          perspective: null,
          outcome: 'pass',
          patchDigest: digest,
          headSha: HEAD,
          expectedHeadSha: HEAD,
          createdAt: 4,
        })
        .run();
      const after = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(after?.blockers.map((b) => b.code)).not.toContain('verify-missing');
      expect(after?.blockers.map((b) => b.code)).not.toContain('no-verifier');
    },
  );

  test('D71 reviewer identity is the model the review step actually ran: a review that fell back off Codex does not count', async () => {
    const { s, buildId, stepId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
    const review = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    s.db
      .update(step)
      .set({
        status: 'done',
        finishedAt: 2,
        fallback: {
          model: { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
          tried: ['gpt-5.4'],
          zeroUsageRetried: false,
        },
      })
      .where(eq(step.id, review?.id ?? ''))
      .run();
    await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    const digest = computePatchDigest(
      compareFilesFromResponse({
        files: [
          {
            filename: 'apps/server/src/services/merge-gate/readiness.ts',
            status: 'modified',
            sha: '1'.repeat(40),
            additions: 4,
            deletions: 1,
            patch: '@@ protected\n+gate\n',
          },
          {
            filename: 'docs/verify/1794/shot.png',
            status: 'added',
            sha: '2'.repeat(40),
            additions: 0,
            deletions: 0,
          },
        ],
      }) ?? [],
      { expectedFileCount: 2 },
    ).patchDigest;
    s.db
      .insert(gateVerdict)
      .values({
        stepId: review?.id ?? '',
        buildId,
        kind: 'review',
        perspective: 'code_reviewer',
        outcome: 'pass',
        patchDigest: digest,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: 3,
      })
      .run();
    s.db
      .insert(message)
      .values({
        id: 'msg-verdict-fallback',
        conversationId: buildId,
        role: 'system',
        content: JSON.stringify({
          kind: REVIEW_VERDICT_KIND,
          stepId: review?.id ?? '',
          verdict: {
            conclusion: 'No blocking findings',
            gateLoosening: false,
            evalRulerChange: false,
            findings: [],
          },
        }),
        createdAt: 3,
      })
      .run();
    const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(result?.blockers.map((b) => b.code)).toContain('independent-review-missing');
  });

  test('a Codex review counts even when the build itself ran on Codex', async () => {
    const { s, buildId, stepId } = await world();
    s.db
      .update(step)
      .set({
        fallback: {
          model: { provider: 'codex', modelId: 'gpt-5.4' },
          tried: ['claude-opus-4-8'],
          zeroUsageRetried: false,
        },
      })
      .where(eq(step.id, stepId))
      .run();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
    const review = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    s.db
      .update(step)
      .set({ status: 'done', finishedAt: 2 })
      .where(eq(step.id, review?.id ?? ''))
      .run();
    await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    const digest = computePatchDigest(
      compareFilesFromResponse({
        files: [
          {
            filename: 'apps/server/src/services/merge-gate/readiness.ts',
            status: 'modified',
            sha: '1'.repeat(40),
            additions: 4,
            deletions: 1,
            patch: '@@ protected\n+gate\n',
          },
          {
            filename: 'docs/verify/1794/shot.png',
            status: 'added',
            sha: '2'.repeat(40),
            additions: 0,
            deletions: 0,
          },
        ],
      }) ?? [],
      { expectedFileCount: 2 },
    ).patchDigest;
    s.db
      .insert(gateVerdict)
      .values({
        stepId: review?.id ?? '',
        buildId,
        kind: 'review',
        perspective: 'code_reviewer',
        outcome: 'pass',
        patchDigest: digest,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: 3,
      })
      .run();
    s.db
      .insert(message)
      .values({
        id: 'msg-verdict-author-fallback',
        conversationId: buildId,
        role: 'system',
        content: JSON.stringify({
          kind: REVIEW_VERDICT_KIND,
          stepId: review?.id ?? '',
          verdict: {
            conclusion: 'No blocking findings',
            gateLoosening: false,
            evalRulerChange: false,
            findings: [],
          },
        }),
        createdAt: 3,
      })
      .run();
    const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(result?.blockers.map((b) => b.code)).not.toContain('independent-review-missing');
  });

  test('an oversize patch gets no size blocker and no extra size review (D68)', async () => {
    const { s, buildId, stepId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
    const reviewsOf = () =>
      s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .filter((row) => row.kind === 'review');
    const before = reviewsOf().length;
    for (const body of ['', '\n\n## Size\nThe gate and its callers must change together.\n']) {
      const readiness = await evaluateMergeGate(s.svc, buildId, {
        port: scriptedPort([], { additions: 900, body }),
      });
      expect(readiness?.blockers.map((b) => b.code) ?? []).not.toContain('size-cap');
    }
    expect(reviewsOf()).toHaveLength(before);
  });

  test('spoken safety answers bind by step id when reviews finish out of creation order', async () => {
    const { s, buildId, stepId, reviewerId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
    const firstReview = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    expect(firstReview).toBeDefined();
    const secondReviewId = 'step-review-second';
    s.db
      .insert(step)
      .values({
        id: secondReviewId,
        buildId,
        kind: 'review',
        status: 'done',
        prompt: firstReview?.prompt ?? `{"kind":"review","agentId":"${reviewerId}"}`,
        createdAt: (firstReview?.createdAt ?? 2) + 1,
        finishedAt: 10,
      })
      .run();
    s.db
      .update(step)
      .set({ status: 'done', finishedAt: 20 })
      .where(eq(step.id, firstReview?.id ?? ''))
      .run();
    const compareBody = {
      files: [
        {
          filename: 'apps/server/src/services/merge-gate/readiness.ts',
          status: 'modified',
          sha: '1'.repeat(40),
          additions: 4,
          deletions: 1,
          patch: '@@ protected\n+gate\n',
        },
        {
          filename: 'docs/verify/1794/shot.png',
          status: 'added',
          sha: '2'.repeat(40),
          additions: 0,
          deletions: 0,
        },
      ],
    };
    const digest = computePatchDigest(compareFilesFromResponse(compareBody) ?? [], {
      expectedFileCount: 2,
    }).patchDigest;
    expect(digest).not.toBeNull();
    for (const [id, at] of [
      [secondReviewId, 10],
      [firstReview?.id ?? '', 20],
    ] as const) {
      s.db
        .insert(gateVerdict)
        .values({
          stepId: id,
          buildId,
          kind: 'review',
          perspective: 'code_reviewer',
          outcome: 'pass',
          patchDigest: digest,
          headSha: HEAD,
          expectedHeadSha: HEAD,
          createdAt: at,
        })
        .run();
    }
    s.db
      .insert(message)
      .values([
        {
          id: 'msg-verdict-second-first',
          conversationId: buildId,
          role: 'system',
          content: JSON.stringify({
            kind: REVIEW_VERDICT_KIND,
            stepId: secondReviewId,
            verdict: {
              conclusion: 'Second review safe',
              gateLoosening: false,
              evalRulerChange: false,
              findings: [],
            },
          }),
          createdAt: 10,
        },
        {
          id: 'msg-verdict-first-later',
          conversationId: buildId,
          role: 'system',
          content: JSON.stringify({
            kind: REVIEW_VERDICT_KIND,
            stepId: firstReview?.id ?? '',
            verdict: {
              conclusion: 'First review loosens the gate',
              gateLoosening: true,
              evalRulerChange: false,
              findings: [],
            },
          }),
          createdAt: 20,
        },
      ])
      .run();
    const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(readiness?.blockers.map((b) => b.code)).toContain('review-blocking');
  });

  test('parsed VERDICT line disagreeing with structured outcome is a mismatch', () => {
    expect(gateRunMismatch('block', 'pass')).toBe(true);
    expect(gateRunMismatch('pass', 'block')).toBe(true);
    expect(gateRunMismatch('pass', 'pass')).toBe(false);
    expect(gateRunMismatch(null, 'pass')).toBe(false);
    expect(gateRunMismatch('pass', null)).toBe(false);
  });
});

test.each(['autonomy-paused', 'daily-cap'] as const)(
  '#1405 GitHub evaluation reads %s from current database policy',
  async (code) => {
    const w = await world();
    if (code === 'autonomy-paused')
      w.s.db.update(team).set({ autonomyPaused: true }).where(eq(team.id, w.s.team.id)).run();
    else {
      w.s.db.update(team).set({ maxAutonomousMergesPerDay: 0 }).run();
      const row = w.s.db.select().from(project).get();
      if (!row) throw new Error('missing project');
      w.s.db
        .update(project)
        .set({
          autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, ...row.autonomy },
        })
        .where(eq(project.id, row.id))
        .run();
    }
    const readiness = await evaluateMergeGate(w.s.svc, w.buildId, { port: scriptedPort([]) });
    expect(readiness?.blockers.map((b) => b.code)).toContain(code);
  },
);

test('an open GitHub marker blocks server readiness with autonomy-paused', async () => {
  const { s, buildId } = await world();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
  );
  const readiness = await evaluateMergeGate(
    { ...s.svc, box: s.secretBox, githubFetch: async () => Response.json([{ number: 7 }]) },
    buildId,
    { port: scriptedPort([]) },
  );
  expect(readiness?.blockers.map((blocker) => blocker.code)).toContain('autonomy-paused');
});

async function reviewPushWorld(policy: 'human' | 'autonomous') {
  const w = await world();
  const { s, buildId, stepId } = w;
  s.db
    .update(project)
    .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: policy } })
    .run();
  completeStep(s.svc, stepId, { hasChanges: true });
  const review = s.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .all()
    .find((row) => row.kind === 'review');
  if (!review) throw new Error('Missing review step');
  s.db.update(step).set({ status: 'done', finishedAt: 2 }).where(eq(step.id, review.id)).run();
  const port = scriptedPort([]);
  const raw = await port.compare(BASE, HEAD, { page: 1, perPage: 100 });
  if (raw.kind !== 'ok') throw new Error('Missing comparison fixture');
  const digest = computePatchDigest(compareFilesFromResponse(raw.body) ?? [], {
    expectedFileCount: 2,
  }).patchDigest;
  for (const kind of ['review', 'verify', 'decision'] as const) {
    s.db
      .insert(gateVerdict)
      .values({
        stepId: kind === 'review' ? review.id : `verdict-${kind}`,
        buildId,
        kind,
        perspective: kind === 'review' ? 'code_reviewer' : null,
        outcome: 'pass',
        patchDigest: digest,
        headSha: HEAD,
        expectedHeadSha: HEAD,
        createdAt: 3,
      })
      .run();
  }
  s.db
    .insert(message)
    .values({
      id: 'push-review-verdict',
      conversationId: buildId,
      role: 'system',
      content: JSON.stringify({
        kind: REVIEW_VERDICT_KIND,
        stepId: review.id,
        verdict: { conclusion: 'Safe', gateLoosening: false, evalRulerChange: false, findings: [] },
      }),
      createdAt: 3,
    })
    .run();
  s.db
    .insert(pushSubscription)
    .values({
      id: 'push-review-sub',
      userId: s.user.id,
      teamId: s.team.id,
      endpoint: 'https://push.example/sub',
      p256dh: 'key',
      auth: 'auth',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(gateState)
    .values({
      buildId,
      ready: false,
      policy,
      headSha: HEAD,
      patchDigest: digest,
      evaluatedAt: 1,
      blockers: [
        { code: 'phase-not-review', class: 'transient', label: 'Building', detail: [] },
        { code: 'required-check-pending', class: 'transient', label: 'Checks pending', detail: [] },
      ],
    })
    .run();
  return w;
}

test('review push follows fresh gate evaluation once per persisted review entry', async () => {
  const { s, buildId } = await reviewPushWorld('human');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, 'todo-1794', 'review');
  expect(send).not.toHaveBeenCalled();
  const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(readiness?.blockers.map((blocker) => blocker.code)).toEqual(['policy-human']);
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.db.select().from(pushDigestItem).all()).toHaveLength(0);
  expect(s.db.select().from(pushDelivery).all()).toEqual([
    expect.objectContaining({
      pushStatus: 'review-notified',
      userId: s.user.id,
      teamId: s.team.id,
    }),
  ]);
  await Promise.all([
    evaluateMergeGate({ ...s.svc }, buildId, { port: scriptedPort([]) }),
    evaluateMergeGate({ ...s.svc }, buildId, { port: scriptedPort([]) }),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  setTodoPhase(s.svc, 'todo-1794', 'planning');
  setTodoPhase(s.svc, 'todo-1794', 'confirm');
  setTodoPhase(s.svc, 'todo-1794', 'building');
  send.mockClear();
  setTodoPhase(s.svc, 'todo-1794', 'review');
  expect(send).not.toHaveBeenCalled();
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(send).toHaveBeenCalledTimes(1);
});

test('fresh machine blockers suppress review push until the gate becomes human-only', async () => {
  const { s, buildId } = await reviewPushWorld('human');
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, 'todo-1794', 'review');
  const pending = await evaluateMergeGate(s.svc, buildId, {
    port: scriptedPort([], { checksPending: true }),
  });
  expect(pending?.blockers.map((blocker) => blocker.code)).toContain('required-check-pending');
  expect(send).not.toHaveBeenCalled();
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(send).toHaveBeenCalledTimes(1);
});

test('an autonomous review pushes once when a human blocker first appears during later evaluation', async () => {
  const { s, buildId } = await reviewPushWorld('autonomous');
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, 'todo-1794', 'review');
  const ready = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(ready?.ready).toBe(true);
  expect(send).not.toHaveBeenCalled();
  const blocked = await evaluateMergeGate(s.svc, buildId, {
    port: scriptedPort([], { forked: true }),
  });
  expect(blocked?.blockers.some((blocker) => blocker.class === 'human')).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([], { forked: true }) });
  expect(send).toHaveBeenCalledTimes(1);
});

test('a human blocker waits for pending machine checks before the review push', async () => {
  const { s, buildId } = await reviewPushWorld('autonomous');
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, 'todo-1794', 'review');
  const mixed = await evaluateMergeGate(s.svc, buildId, {
    port: scriptedPort([], { forked: true, checksPending: true }),
  });
  expect(mixed?.blockers.some((blocker) => blocker.class === 'human')).toBe(true);
  expect(mixed?.blockers.some((blocker) => blocker.class === 'transient')).toBe(true);
  expect(send).not.toHaveBeenCalled();
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([], { forked: true }) });
  expect(send).toHaveBeenCalledTimes(1);
});

test('an evaluation started for a previous review entry cannot notify its replacement', async () => {
  const { s, buildId } = await reviewPushWorld('human');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const send = vi
    .spyOn(webpush, 'sendNotification')
    .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  setTodoPhase(s.svc, 'todo-1794', 'review');
  const port = scriptedPort([]);
  let release: (() => void) | undefined;
  const previous = evaluateMergeGate(s.svc, buildId, {
    port: {
      ...port,
      pull: async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return port.pull(...args);
      },
    },
  });
  await vi.waitFor(() => expect(release).toBeDefined());
  setTodoPhase(s.svc, 'todo-1794', 'planning');
  setTodoPhase(s.svc, 'todo-1794', 'confirm');
  setTodoPhase(s.svc, 'todo-1794', 'building');
  send.mockClear();
  setTodoPhase(s.svc, 'todo-1794', 'review');
  release?.();
  await previous;
  expect(send).not.toHaveBeenCalled();
  await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(send).toHaveBeenCalledTimes(1);
});

test.each(['before evaluation', 'during evaluation'] as const)(
  'archiving a review %s suppresses its deferred push without changing phase',
  async (when) => {
    const { s, buildId } = await reviewPushWorld('human');
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    setTodoPhase(s.svc, 'todo-1794', 'review');
    const archive = async () => {
      const response = await s.app.request('/api/todos/todo-1794/archive', { method: 'POST' });
      expect(response.status).toBe(200);
    };
    const port = scriptedPort([]);
    let release: (() => void) | undefined;
    if (when === 'before evaluation') await archive();
    const evaluation = evaluateMergeGate(s.svc, buildId, {
      port:
        when === 'before evaluation'
          ? port
          : {
              ...port,
              pull: async (...args) => {
                await new Promise<void>((resolve) => {
                  release = resolve;
                });
                return port.pull(...args);
              },
            },
    });
    if (when === 'during evaluation') {
      await vi.waitFor(() => expect(release).toBeDefined());
      await archive();
      release?.();
    }
    const readiness = await evaluation;
    expect(readiness?.blockers.map((blocker) => blocker.code)).toEqual(['policy-human']);
    expect(send).not.toHaveBeenCalled();
    expect(s.db.select().from(todo).where(eq(todo.id, 'todo-1794')).get()).toMatchObject({
      phase: 'review',
      archivedAt: expect.any(Number),
    });
    expect(s.db.select().from(pushDelivery).get()?.pushStatus).toBe('review-pending');
  },
);
