import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewStepPrompt, parseReviewPromptMeta, REVIEW_VERDICT_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build,
  chief,
  chiefMessage,
  chiefThread,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  machine,
  message,
  plan,
  project,
  step,
  todo,
} from '../src/db/schema.js';
import { completeStep } from '../src/services/builds.js';
import { claimStep } from '../src/services/machine-claim.js';
import {
  evaluateProductGate as evaluateMergeGate,
  machineGatePort,
} from '../src/services/machine-gate-port.js';
import { readGateRuns } from '../src/services/machine-gate-storage.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import { evaluateMergeGate as evaluateCoreGate } from '../src/services/merge-gate/run.js';
import { bootServer, issueApiKey, postProject, type TestServer } from './helpers.js';

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
      fallback: {
        model: null,
        tried: [],
        zeroUsageRetried: false,
        execution: { agentId: authorId, modelId: 'claude-opus-4-8' },
      },
      createdAt: 1,
    })
    .run();
  return { s, buildId, stepId, reviewerId, authorId };
}

function completeReview(
  s: TestServer,
  stepId: string,
  outcome: Parameters<typeof completeStep>[2],
): void {
  const current = s.db.select().from(step).where(eq(step.id, stepId)).get();
  const agentId =
    current?.kind === 'verify'
      ? 'agent-verifier'
      : (parseReviewPromptMeta(current?.prompt ?? null)?.agentId ?? '');
  const reviewer = s.db.select().from(agentTable).where(eq(agentTable.id, agentId)).get();
  s.db
    .update(step)
    .set({
      fallback: {
        model: null,
        tried: [],
        zeroUsageRetried: false,
        execution: { agentId, modelId: reviewer?.modelId ?? null },
      },
    })
    .where(eq(step.id, stepId))
    .run();
  completeStep(s.svc, stepId, {
    verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] },
    ...outcome,
  });
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

  test('evaluation persists the gate snapshot, and a protected path stays blocked until an independent review is bound', async () => {
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
      .set({
        status: 'done',
        finishedAt: 2,
        fallback: {
          model: null,
          tried: [],
          zeroUsageRetried: false,
          execution: { agentId: 'agent-reviewer', modelId: 'gpt-5.4' },
        },
      })
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
        payload: {
          conclusion: 'Stored pass',
          gateLoosening: false,
          evalRulerChange: false,
          findings: [],
        },
        reviewerAgentId: 'agent-reviewer',
        reviewerModelId: 'gpt-5.4',
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
          stepId: review?.id,
          modelId: 'gpt-5.4',
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
    const bound = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(bound?.blockers.map((b) => b.code)).not.toContain('independent-review-missing');
    expect(bound?.ready).toBe(false);
    expect(bound?.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(['verify-missing', 'decision-missing']),
    );

    s.db
      .update(message)
      .set({
        content: JSON.stringify({
          kind: REVIEW_VERDICT_KIND,
          stepId: review?.id,
          modelId: 'gpt-5.4',
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
    s.db
      .update(gateVerdict)
      .set({
        payload: {
          conclusion: 'Stored gate loosening',
          gateLoosening: true,
          evalRulerChange: false,
          findings: [],
        },
      })
      .where(eq(gateVerdict.stepId, review?.id ?? ''))
      .run();
    const loosened = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(loosened?.blockers.map((b) => b.code)).toContain('review-blocking');
  });

  test.each(['reverse-completion', 'cancelled-predecessor', 'legacy-unbound'])(
    'review safety answers fail closed with %s',
    async (scenario) => {
      const { s, buildId, stepId, reviewerId } = await world();
      completeStep(s.svc, stepId, { hasChanges: true });
      const current = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .find((row) => row.kind === 'review');
      expect(current).toBeDefined();
      const currentId = current?.id ?? '';
      s.db
        .update(step)
        .set({
          status: 'done',
          createdAt: 20,
          finishedAt: 30,
          fallback: {
            model: null,
            tried: [],
            zeroUsageRetried: false,
            execution: { agentId: reviewerId, modelId: 'gpt-5.4' },
          },
        })
        .where(eq(step.id, currentId))
        .run();
      s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
      const oldHead = 'c'.repeat(40);
      s.db
        .insert(step)
        .values({
          id: 'old-review',
          buildId,
          kind: 'review',
          status: scenario === 'cancelled-predecessor' ? 'stopped' : 'done',
          createdAt: 10,
          finishedAt: 40,
          prompt: buildReviewStepPrompt({
            agentId: reviewerId,
            gate: 'review',
            planText: '',
            changes: [],
            checkout: true,
            expectedHeadSha: oldHead,
          }),
        })
        .run();
      s.db
        .insert(gateVerdict)
        .values({
          stepId: currentId,
          buildId,
          kind: 'review',
          perspective: 'code_reviewer',
          outcome: 'pass',
          payload:
            scenario === 'legacy-unbound'
              ? null
              : {
                  conclusion: 'Current stored gate change',
                  gateLoosening: true,
                  evalRulerChange: false,
                  findings: [],
                },
          reviewerAgentId: reviewerId,
          reviewerModelId: 'gpt-5.4',
          headSha: HEAD,
          expectedHeadSha: HEAD,
          createdAt: 30,
        })
        .run();
      s.db
        .insert(message)
        .values({
          id: 'current-answer',
          conversationId: buildId,
          role: 'system',
          createdAt: 30,
          content: JSON.stringify({
            kind: REVIEW_VERDICT_KIND,
            ...(scenario === 'legacy-unbound' ? {} : { stepId: currentId }),
            modelId: 'gpt-5.4',
            verdict: {
              conclusion: 'Current patch changes the gate',
              gateLoosening: true,
              evalRulerChange: false,
              findings: [],
            },
          }),
        })
        .run();
      if (scenario !== 'cancelled-predecessor') {
        s.db
          .insert(message)
          .values({
            id: 'old-answer',
            conversationId: buildId,
            role: 'system',
            createdAt: 40,
            content: JSON.stringify({
              kind: REVIEW_VERDICT_KIND,
              stepId: 'old-review',
              modelId: 'gpt-5.4',
              verdict: {
                conclusion: 'Old patch is safe',
                gateLoosening: false,
                evalRulerChange: false,
                findings: [],
              },
            }),
          })
          .run();
      }
      const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      const codes = result?.blockers.map((item) => item.code);
      if (scenario === 'legacy-unbound') expect(codes).toContain('independent-review-missing');
      else expect(codes).toContain('review-blocking');
    },
  );

  test('review completion records its step identity with the structured verdict', async () => {
    const { s, buildId, stepId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    const current = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    completeReview(s, current?.id ?? '', {
      findings: {
        conclusion: 'No blocking findings',
        gateLoosening: false,
        evalRulerChange: false,
        findings: [],
      },
    });
    const recorded = s.db
      .select()
      .from(message)
      .where(eq(message.conversationId, buildId))
      .all()
      .map((row) => {
        try {
          return JSON.parse(String(row.content));
        } catch {
          return null;
        }
      })
      .find((row) => row?.kind === REVIEW_VERDICT_KIND);
    expect(recorded?.stepId).toBe(current?.id);
    expect(recorded?.modelId).toBe('gpt-5.4');
  });

  test.each(['go', 'block', 'drift', 'missing-head', 'missing', 'safety', 'missing-safety'])(
    'the chief decision is a separate patch-bound step (%s)',
    async (scenario) => {
      const blocked = scenario === 'block';
      const { s, buildId, stepId } = await world();
      completeStep(s.svc, stepId, { hasChanges: true });
      const review = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .find((row) => row.kind === 'review');
      completeReview(s, review?.id ?? '', {
        findings: {
          conclusion: 'Independent review passed',
          gateLoosening: false,
          evalRulerChange: false,
          findings: [],
        },
      });
      s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
      const first = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(first?.blockers.map((item) => item.code)).toContain('verify-missing');
      expect(
        s.db
          .select()
          .from(step)
          .where(eq(step.buildId, buildId))
          .all()
          .filter((row) => row.prompt?.includes('"purpose":"decision"')),
      ).toHaveLength(0);
      s.db
        .insert(step)
        .values({
          id: 'verify-step',
          buildId,
          kind: 'verify',
          status: 'claimed',
          prompt: JSON.stringify({ kind: 'verify', expectedHeadSha: HEAD }),
          createdAt: 100,
        })
        .run();
      completeReview(s, 'verify-step', {
        verifyVerdict: {
          passed: true,
          conclusion: 'Verification passed',
          evidence: [{ path: 'docs/verify/1794/shot.png' }],
        },
        verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] },
      });
      await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      const decisions = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .filter((row) => row.prompt?.includes('"purpose":"decision"'));
      expect(decisions).toHaveLength(1);
      const decision = decisions[0];
      expect(parseReviewPromptMeta(decision?.prompt ?? null)?.agentId).toBe('agent-chief');
      expect(decision?.prompt).toContain(HEAD);
      expect(decision?.prompt).toContain('Independent review passed');
      await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(
        s.db
          .select()
          .from(step)
          .where(eq(step.buildId, buildId))
          .all()
          .filter((row) => row.prompt?.includes('"purpose":"decision"')),
      ).toHaveLength(1);
      completeReview(
        s,
        decision?.id ?? '',
        scenario === 'missing'
          ? { verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] } }
          : {
              findings: {
                conclusion: blocked ? 'No-go' : 'Go',
                ...(scenario === 'missing-safety'
                  ? {}
                  : {
                      gateLoosening: scenario === 'safety',
                      evalRulerChange: false,
                    }),
                findings: blocked
                  ? [{ id: 'chief-block', severity: 'blocking', summary: 'Needs more evidence' }]
                  : [],
              },
              ...(scenario === 'drift'
                ? {
                    verdictReport: {
                      reportedHeadSha: 'd'.repeat(40),
                      driftedHeads: ['d'.repeat(40)],
                    },
                  }
                : scenario === 'missing-head'
                  ? { verdictReport: { reportedHeadSha: null, driftedHeads: [] } }
                  : { verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] } }),
            },
      );
      const verdict = s.db
        .select()
        .from(gateVerdict)
        .where(eq(gateVerdict.stepId, decision?.id ?? ''))
        .get();
      expect(verdict?.kind).toBe('decision');
      if (scenario === 'safety' || scenario === 'missing-safety')
        s.db
          .update(gateVerdict)
          .set({ outcome: 'pass' })
          .where(eq(gateVerdict.stepId, decision?.id ?? ''))
          .run();
      const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(result?.ready).toBe(scenario === 'go');
      if (blocked || scenario === 'safety')
        expect(result?.blockers.map((item) => item.code)).toContain('decision-no-go');
      if (scenario === 'missing' || scenario === 'missing-safety')
        expect(result?.blockers.map((item) => item.code)).toContain('decision-extraction-failed');
      if (scenario === 'drift' || scenario === 'missing-head')
        expect(result?.blockers.map((item) => item.code)).toContain('decision-missing');
      expect(verdict?.headSha).toBe(
        scenario === 'missing-head' ? null : scenario === 'drift' ? 'd'.repeat(40) : HEAD,
      );
      expect(
        s.db
          .select()
          .from(gateVerdict)
          .where(eq(gateVerdict.stepId, decision?.id ?? ''))
          .get()?.patchDigest,
      ).toBe(scenario === 'drift' || scenario === 'missing-head' ? null : result?.patchDigest);
    },
  );

  test('production evaluation records its action and audits a blocked merged head', async () => {
    const { s, buildId, stepId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    const review = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    const reviewId = review?.id ?? '';
    completeReview(s, reviewId, {
      findings: {
        conclusion: 'Gate loosening detected',
        gateLoosening: true,
        evalRulerChange: false,
        findings: [],
      },
    });
    const sessions = join(s.attachmentsDir, 'step-sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, `${reviewId}.jsonl`),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'gpt-5.4',
          content: 'VERDICT: block',
        },
      }),
    );
    const deps = { ...s.svc, attachmentsDir: s.attachmentsDir };
    await evaluateMergeGate(deps, buildId, { port: scriptedPort([]) });
    const recorded = readGateRuns(s.attachmentsDir, buildId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.action.status).toBe('written');
    expect(recorded[0]?.reviewers[0]).toMatchObject({
      stepId: reviewId,
      modelId: 'gpt-5.4',
      verdict: { gateLoosening: true },
    });
    expect(recorded[0]?.reviewers[0]?.rawOutput).toContain('VERDICT: block');
    const port = scriptedPort([]);
    const pull = port.pull;
    port.pull = async (number, options) => {
      const response = await pull(number, options);
      if (response.kind !== 'ok') return response;
      return { ...response, body: { ...(response.body as object), state: 'closed', merged: true } };
    };
    const issues: { number: number; body: string }[] = [];
    const auditPort = {
      readIssuePage: async () => ({ issues, hasMore: false }),
      createIssue: async (input: { title: string; body: string }) => {
        issues.push({ number: 91, body: input.body });
        return 91;
      },
    };
    await evaluateMergeGate(deps, buildId, { port, auditPort });
    await evaluateMergeGate(deps, buildId, { port, auditPort });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.body).toContain('review-blocking');
    expect(readGateRuns(s.attachmentsDir, buildId).at(-1)?.mismatchIssue).toBe(91);
  });

  test('review independence uses the completed run model after agent settings change', async () => {
    const { s, buildId, stepId, reviewerId } = await world();
    completeStep(s.svc, stepId, { hasChanges: true });
    const review = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    completeReview(s, review?.id ?? '', {
      findings: {
        conclusion: 'Reviewed with GPT',
        gateLoosening: false,
        evalRulerChange: false,
        findings: [],
      },
    });
    s.db
      .update(agentTable)
      .set({ modelId: 'claude-opus-4-8' })
      .where(eq(agentTable.id, reviewerId))
      .run();
    const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(result?.blockers.map((item) => item.code)).not.toContain('independent-review-missing');
  });

  test.each(['snapshot', 'fallback', 'unknown'])(
    'review independence cannot be changed by author settings (%s)',
    async (source) => {
      const { s, buildId, stepId, authorId, reviewerId } = await world();
      if (source !== 'snapshot')
        s.db
          .update(step)
          .set({
            fallback:
              source === 'fallback'
                ? {
                    model: { provider: 'anthropic', modelId: 'claude-opus-4-8' },
                    tried: [],
                    zeroUsageRetried: false,
                  }
                : null,
          })
          .where(eq(step.id, stepId))
          .run();
      completeStep(s.svc, stepId, { hasChanges: true });
      s.db.update(agentTable).set({ modelId: 'gpt-5.4' }).where(eq(agentTable.id, authorId)).run();
      s.db
        .update(agentTable)
        .set({ modelId: 'claude-opus-4-8' })
        .where(eq(agentTable.id, reviewerId))
        .run();
      const review = s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .find((row) => row.kind === 'review');
      completeReview(s, review?.id ?? '', {
        findings: {
          conclusion: 'Reviewed',
          gateLoosening: false,
          evalRulerChange: false,
          findings: [],
        },
      });
      const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
      expect(result?.blockers.map((item) => item.code)).toContain('independent-review-missing');
    },
  );

  test('server claim snapshots the effective model without replacing fallback state', async () => {
    const { s, stepId, authorId } = await world();
    s.db
      .insert(machine)
      .values({
        id: 'model-machine',
        teamId: s.team.id,
        name: 'worker',
        online: true,
        enabledRuntimes: ['pi'],
      })
      .run();
    s.db
      .update(agentTable)
      .set({ machineId: 'model-machine', provider: 'anthropic' })
      .where(eq(agentTable.id, authorId))
      .run();
    const fallback = {
      model: { provider: 'openai', modelId: 'gpt-5.4' },
      tried: ['anthropic/claude-opus-4-8'],
      zeroUsageRetried: true,
    };
    s.db.update(step).set({ status: 'pending', fallback }).where(eq(step.id, stepId)).run();
    const claimed = await claimStep(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      'model-machine',
      s.team.id,
      0,
      'http://localhost',
    );
    expect(claimed?.step.id).toBe(stepId);
    expect(claimed?.agent?.modelId).toBe('gpt-5.4');
    expect(s.db.select().from(step).where(eq(step.id, stepId)).get()?.fallback).toEqual({
      ...fallback,
      execution: { agentId: authorId, modelId: 'gpt-5.4' },
    });
  });

  test('legacy author assignment changes cannot make the actual author an independent reviewer', async () => {
    const { s, buildId, stepId, authorId } = await world();
    s.db
      .update(step)
      .set({
        fallback: {
          model: { provider: 'anthropic', modelId: 'claude-opus-4-8' },
          tried: [],
          zeroUsageRetried: false,
        },
      })
      .where(eq(step.id, stepId))
      .run();
    completeStep(s.svc, stepId, { hasChanges: true });
    s.db
      .update(todo)
      .set({ assignment: { plan: null, build: { agentId: 'agent-chief' } } })
      .where(eq(todo.id, 'todo-1794'))
      .run();
    s.db.update(agentTable).set({ modelId: 'gpt-5.4' }).where(eq(agentTable.id, authorId)).run();
    const review = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((row) => row.kind === 'review');
    const reviewId = review?.id ?? '';
    s.db
      .update(step)
      .set({
        prompt: buildReviewStepPrompt({
          agentId: authorId,
          gate: 'review',
          expectedHeadSha: HEAD,
          planText: '',
          checkout: true,
        }),
      })
      .where(eq(step.id, reviewId))
      .run();
    completeReview(s, reviewId, {
      findings: {
        conclusion: 'Author reviewed own work',
        gateLoosening: false,
        evalRulerChange: false,
        findings: [],
      },
    });
    const result = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(result?.blockers.map((item) => item.code)).toContain('independent-review-missing');
  });
});

describe('merged terminal audit certainty', () => {
  test.each(['github-port', 'pull-facts', 'storage', 'audit-port', 'still-open'])(
    'refuses terminal reconciliation without %s',
    async (missing) => {
      const { s, buildId } = await world();
      const port = scriptedPort([]);
      const originalPull = port.pull;
      port.pull = async (...args) => {
        if (missing === 'pull-facts') return { kind: 'failed', failure: { kind: 'network' } };
        const raw = await originalPull(...args);
        return raw.kind === 'ok'
          ? {
              ...raw,
              body: { ...(raw.body as object), merged: missing !== 'still-open', state: 'closed' },
            }
          : raw;
      };
      const runtime = {
        ...machineGatePort(s.svc),
        githubPort: async () => (missing === 'github-port' ? null : port),
        hasAuditStorage: missing !== 'storage',
        auditPort: async () =>
          missing === 'audit-port'
            ? null
            : {
                readIssuePage: async () => ({ issues: [], hasMore: false }),
                createIssue: async () => 99,
              },
        readRuns: () => [],
        appendRun: () => {},
      };
      await expect(evaluateCoreGate(runtime, buildId, { requireAudit: true })).rejects.toThrow(
        'audit',
      );
    },
  );
});

test('a stored passing review cannot hide blocking findings in its bound message', async () => {
  const { s, buildId, stepId } = await world();
  completeStep(s.svc, stepId, { hasChanges: true });
  const review = s.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .all()
    .find((row) => row.kind === 'review');
  const reviewId = review?.id ?? '';
  s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, 'todo-1794')).run();
  completeReview(s, reviewId, {
    findings: {
      conclusion: 'No-go',
      gateLoosening: false,
      evalRulerChange: false,
      findings: [{ id: 'blocking', severity: 'blocking', summary: 'Missing authorization' }],
    },
  });
  s.db.update(gateVerdict).set({ outcome: 'pass' }).where(eq(gateVerdict.stepId, reviewId)).run();
  const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(readiness?.blockers.map((blocker) => blocker.code)).toContain('review-blocking');
});

test('a stored passing verification cannot hide a failing verdict in its bound message', async () => {
  const { s, buildId, stepId } = await world();
  completeStep(s.svc, stepId, { hasChanges: true });
  s.db
    .insert(step)
    .values({
      id: 'failing-verify',
      buildId,
      kind: 'verify',
      status: 'claimed',
      prompt: JSON.stringify({ kind: 'verify', expectedHeadSha: HEAD }),
      createdAt: 100,
    })
    .run();
  completeReview(s, 'failing-verify', {
    verifyVerdict: { passed: false, conclusion: 'Verification failed', evidence: [] },
    verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] },
  });
  s.db
    .update(gateVerdict)
    .set({ outcome: 'pass' })
    .where(eq(gateVerdict.stepId, 'failing-verify'))
    .run();
  const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(readiness?.blockers.map((blocker) => blocker.code)).toContain('verify-failed');
});

test('empty caller criteria cannot hide evidence missing from the server plan', async () => {
  const { s, buildId, stepId } = await world();
  completeStep(s.svc, stepId, { hasChanges: true });
  s.db
    .insert(plan)
    .values({
      id: 'server-plan',
      buildId,
      version: 1,
      content: '## Verification\n- `pnpm test first`\n- `pnpm test second`',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'partial-verify',
      buildId,
      kind: 'verify',
      status: 'claimed',
      prompt: JSON.stringify({ kind: 'verify', expectedHeadSha: HEAD }),
      createdAt: 100,
    })
    .run();
  completeReview(s, 'partial-verify', {
    verifyVerdict: {
      passed: true,
      conclusion: 'Claimed pass',
      evidence: [{ path: 'docs/verify/1794/shot.png', item: 1 }],
    },
    verdictReport: { reportedHeadSha: HEAD, driftedHeads: [] },
  });
  const record = s.db
    .select()
    .from(message)
    .where(eq(message.conversationId, buildId))
    .all()
    .find((row) => String(row.content).includes('"stepId":"partial-verify"'));
  const payload = JSON.parse(String(record?.content));
  s.db
    .update(message)
    .set({ content: JSON.stringify({ ...payload, verificationItems: [] }) })
    .where(eq(message.id, record?.id ?? ''))
    .run();
  s.db
    .update(gateVerdict)
    .set({ outcome: 'pass' })
    .where(eq(gateVerdict.stepId, 'partial-verify'))
    .run();
  const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(readiness?.blockers.map((blocker) => blocker.code)).toContain('verify-failed');
});

async function claimedMachineReview(sameVendor = false, gateLoosening = false, blocking = false) {
  const { s, buildId, stepId, reviewerId } = await world();
  const key = await issueApiKey(s);
  const enrollment = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'gate-payload-worker', cliVersion: '0.1.0' }),
  });
  expect(enrollment.status).toBe(200);
  const { token, machineId } = (await enrollment.json()) as { token: string; machineId: string };
  s.db
    .update(agentTable)
    .set({
      machineId,
      provider: sameVendor ? 'anthropic' : 'openai',
      modelId: sameVendor ? 'claude-opus-4-8' : 'gpt-5.4',
    })
    .where(eq(agentTable.id, reviewerId))
    .run();
  completeStep(s.svc, stepId, { hasChanges: true });
  const review = s.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .all()
    .find((row) => row.kind === 'review');
  const reviewId = review?.id ?? '';
  const claimed = await claimStep(
    { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
    machineId,
    s.team.id,
    0,
    'http://localhost',
  );
  expect(claimed?.step.id).toBe(reviewId);
  const done = await s.app.request(`/api/machine/done/${reviewId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'success',
      gateHeadSha: HEAD,
      findings: {
        conclusion: 'Reviewed',
        gateLoosening,
        evalRulerChange: false,
        findings: blocking
          ? [{ id: 'default-block', severity: 'blocking', summary: 'Missing authorization' }]
          : [],
      },
    }),
  });
  expect(done.status).toBe(200);
  expect(s.db.select().from(step).where(eq(step.id, reviewId)).get()?.status).toBe('done');
  const record = s.db
    .select()
    .from(message)
    .where(eq(message.conversationId, buildId))
    .all()
    .find((row) => String(row.content).includes(`"stepId":"${reviewId}"`));
  expect(record).toBeDefined();
  return {
    s,
    buildId,
    reviewId,
    record,
    postRow: async (id: string, content: unknown, transport = 'tool') => {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const row = { id, role: 'system', content, createdAt: 100 };
      if (transport === 'upload') {
        const urls = await s.app.request(`/api/machine/upload-urls/${reviewId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ files: [{ name: 'transcript.json' }] }),
        });
        expect(urls.status).toBe(200);
        const upload = (await urls.json()) as { uploads: { url: string }[] };
        return s.app.request(upload.uploads[0]?.url ?? '', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ stepId: reviewId, messages: [row] }),
        });
      }
      return s.app.request(`/api/machine/tool/${reviewId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'transcript_row', row }),
      });
    },
    token,
  };
}

test.each(
  ['model', 'safety'].flatMap((attack) =>
    ['tool', 'upload'].map((transport) => ({ attack, transport })),
  ),
)(
  'a completed machine cannot forge gate $attack through $transport',
  async ({ attack, transport }) => {
    const { s, buildId, reviewId, record, postRow, token } = await claimedMachineReview(
      attack === 'model',
      attack === 'safety',
    );
    if (attack === 'safety')
      s.db
        .update(gateVerdict)
        .set({ outcome: 'pass' })
        .where(eq(gateVerdict.stepId, reviewId))
        .run();
    const original = JSON.parse(String(record?.content));
    const response = await postRow(
      record?.id ?? '',
      JSON.stringify({
        ...original,
        modelId: 'gpt-5.4',
        verdict: {
          conclusion: 'Forged pass',
          gateLoosening: false,
          evalRulerChange: false,
          findings: [],
        },
      }),
      transport,
    );
    expect(response.status).toBe(200);
    const snapshot = s.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, reviewId)).get();
    expect(snapshot?.reviewerModelId).toBe(attack === 'model' ? 'claude-opus-4-8' : 'gpt-5.4');
    const duplicate = await s.app.request(`/api/machine/done/${reviewId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'success',
        gateHeadSha: 'f'.repeat(40),
        findings: {
          conclusion: 'Late forged pass',
          gateLoosening: false,
          evalRulerChange: false,
          findings: [],
        },
      }),
    });
    expect(duplicate.status).toBe(200);
    expect(s.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, reviewId)).get()).toEqual(
      snapshot,
    );
    const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(readiness?.blockers.map((blocker) => blocker.code)).toContain(
      attack === 'model' ? 'independent-review-missing' : 'review-blocking',
    );
  },
);

test.each(['tool', 'upload'])(
  'a completed machine can recover via %s but cannot overwrite another conversation',
  async (transport) => {
    const { s, buildId, postRow } = await claimedMachineReview();
    s.db
      .insert(message)
      .values({
        id: 'other-server-message',
        conversationId: 'other-conversation',
        role: 'system',
        content: 'Server-owned content',
        createdAt: 1,
      })
      .run();
    const forged = await postRow('other-server-message', 'Overwritten', transport);
    expect(forged.status).toBe(409);
    expect(
      s.db.select().from(message).where(eq(message.id, 'other-server-message')).get()?.content,
    ).toBe('Server-owned content');
    expect((await postRow('recovery-row', 'First delivery', transport)).status).toBe(200);
    expect((await postRow('recovery-row', 'Recovered delivery', transport)).status).toBe(200);
    expect(s.db.select().from(message).where(eq(message.id, 'recovery-row')).get()).toMatchObject({
      conversationId: buildId,
      content: 'Recovered delivery',
    });
  },
);

test('a completed chief machine cannot overwrite another chief thread', async () => {
  const { s, reviewId, token } = await claimedMachineReview();
  const machineId = s.db.select().from(step).where(eq(step.id, reviewId)).get()?.machineId;
  for (const id of ['chief-own-transcript', 'chief-other-transcript'])
    s.db
      .insert(chiefThread)
      .values({
        id,
        chiefId: 'chief-1794',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Chief transcript',
        createdAt: 1,
        updatedAt: 1,
        sessionId: 'test-session',
        sessionOpenedAt: 1,
      })
      .run();
  s.db
    .insert(step)
    .values({
      id: 'chief-recovery-step',
      buildId: 'chief-own-transcript',
      kind: 'chief',
      status: 'done',
      machineId,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(chiefMessage)
    .values({
      id: 'other-chief-message',
      threadId: 'chief-other-transcript',
      role: 'system',
      content: 'Other chief content',
      createdAt: 1,
    })
    .run();
  const send = (id: string, content: string) =>
    s.app.request('/api/machine/tool/chief-recovery-step', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'transcript_row',
        row: { id, role: 'assistant', content, createdAt: 100 },
      }),
    });
  expect((await send('other-chief-message', 'Forged chief content')).status).toBe(409);
  expect(
    s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'other-chief-message')).get()
      ?.content,
  ).toBe('Other chief content');
  expect((await send('own-chief-message', 'Initial chief content')).status).toBe(200);
  expect((await send('own-chief-message', 'Recovered chief content')).status).toBe(200);
  expect(
    s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'own-chief-message')).get()?.content,
  ).toBe('Recovered chief content');
});

test('a default review records NoGo successfully while its build still waits for CI', async () => {
  const { s, buildId, reviewId } = await claimedMachineReview(false, false, true);
  expect(s.db.select().from(todo).where(eq(todo.id, 'todo-1794')).get()?.phase).toBe('building');
  expect(
    s.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, reviewId)).get()?.outcome,
  ).toBe('block');
  expect(
    s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .filter((row) => row.kind === 'plan'),
  ).toHaveLength(0);
  const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
  expect(readiness?.blockers.map((blocker) => blocker.code)).toContain('review-blocking');
});

test.each(['kind', 'agent', 'model', 'prompt-agent'])(
  'a verdict cannot replace its queued kind or claim identity (%s)',
  async (attack) => {
    const { s, buildId, reviewId } = await claimedMachineReview(attack === 'model');
    if (attack === 'prompt-agent') {
      const prompt = s.db.select().from(step).where(eq(step.id, reviewId)).get()?.prompt ?? '';
      const newline = prompt.indexOf('\n');
      const meta = JSON.parse(prompt.slice(0, newline));
      s.db
        .update(step)
        .set({
          prompt: JSON.stringify({ ...meta, agentId: 'forged-agent' }) + prompt.slice(newline),
        })
        .where(eq(step.id, reviewId))
        .run();
    } else {
      s.db
        .update(gateVerdict)
        .set(
          attack === 'kind'
            ? { kind: 'decision' }
            : attack === 'agent'
              ? { reviewerAgentId: 'forged-agent' }
              : { reviewerModelId: 'gpt-5.4' },
        )
        .where(eq(gateVerdict.stepId, reviewId))
        .run();
    }
    const readiness = await evaluateMergeGate(s.svc, buildId, { port: scriptedPort([]) });
    expect(readiness?.blockers.map((blocker) => blocker.code)).toContain(
      attack === 'kind' ? 'decision-missing' : 'independent-review-missing',
    );
  },
);
