import { parseReviewPromptMeta, REVIEW_VERDICT_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build,
  chief,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  project,
  step,
  todo,
} from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import {
  evaluateMergeGate,
  gateRunMismatch,
  MERGE_GATE_RUN_KIND,
} from '../src/services/merge-gate-run.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OWNER = 'xiechimon';
const REPO = 'cairn';
const servers: TestServer[] = [];

afterEach(() => {
  for (const s of servers) s.dispose();
  servers.length = 0;
});

function ok(body: unknown): GateRaw {
  return { kind: 'ok', status: 200, etag: null, link: null, body };
}

function scriptedPort(
  statuses: { sha: string; state: string; description: string }[],
): GateGithubPort {
  const shot = 'docs/verify/1794/shot.png';
  const pull = {
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    changed_files: 2,
    mergeable_state: 'clean',
    body: `evidence: https://raw.githubusercontent.com/${OWNER}/${REPO}/${HEAD}/${shot}`,
    head: { sha: HEAD, ref: 'lane/1794', repo: { full_name: `${OWNER}/${REPO}` } },
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
        additions: 4,
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
      status: 'completed',
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

async function world(): Promise<{
  s: TestServer;
  buildId: string;
  stepId: string;
  reviewerId: string;
  authorId: string;
}> {
  const s = bootServer();
  servers.push(s);
  const projectId = await postProject(s.app, 'gate', { mergePolicy: 'autonomous' });
  s.db
    .update(project)
    .set({ repoKind: 'github', githubRepo: `${OWNER}/${REPO}` })
    .where(eq(project.id, projectId))
    .run();
  const authorId = 'agent-author';
  const reviewerId = 'agent-reviewer';
  const chiefId = 'agent-chief';
  s.db
    .insert(agentTable)
    .values([
      {
        id: authorId,
        teamId: s.team.id,
        displayName: 'Builder',
        persona: 'implementer',
        modelId: 'claude-opus-4-8',
      },
      {
        id: reviewerId,
        teamId: s.team.id,
        displayName: 'Reviewer',
        persona: 'code_reviewer',
        modelId: 'gpt-5.4',
      },
      {
        id: 'agent-verifier',
        teamId: s.team.id,
        displayName: 'Verifier',
        persona: 'verifier',
        modelId: 'claude-verifier',
      },
      {
        id: chiefId,
        teamId: s.team.id,
        displayName: 'Chief',
        modelId: 'claude-chief',
      },
    ])
    .run();
  s.db
    .insert(chief)
    .values({
      id: 'chief-1794',
      userId: s.user.id,
      teamId: s.team.id,
      agentId: chiefId,
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
      assignment: { plan: null, build: { agentId: authorId }, review: null, verify: null },
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
      kind: 'build',
      status: 'claimed',
      checkpointCommit: HEAD,
      createdAt: 1,
    })
    .run();
  return { s, buildId, stepId, reviewerId, authorId };
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

  test('evaluation persists the gate snapshot, records a gate run, and a protected path stays blocked until an independent review is bound', async () => {
    const { s, buildId, stepId } = await world();
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
    expect(s.db.select().from(gateDigest).where(eq(gateDigest.buildId, buildId)).all().length).toBe(
      1,
    );
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
