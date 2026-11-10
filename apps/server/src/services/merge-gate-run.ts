import {
  isBuildStepKind,
  type MergeReadiness,
  mergeReadinessSchema,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  REVIEW_VERDICT_KIND,
  type ReviewVerdict,
  reviewVerdictSchema,
  ticketDedupeKey,
  ticketDedupeMarker,
} from '@cairn/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  step,
  todo,
} from '../db/schema.js';
import { githubCreateIssue } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { autonomousMergePolicy } from './autonomous-merge.js';
import type { BuildDeps } from './builds.js';
import { isCorrectionTask, recordCorrectionGuard } from './correction.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import { readGithubAutonomyPause } from './github-autonomy-brake.js';
import { userTokenOrNull } from './github-connection.js';
import { createHarnessEvalCoordinator } from './harness-eval-coordinator.js';
import {
  DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS,
  productionHarnessEvalConfig,
} from './harness-eval-production.js';
import { correctionDoneCheck } from './merge-gate/correction.js';
import { computePatchDigest } from './merge-gate/digest.js';
import { planGateStatusWrite, writeGateStatus } from './merge-gate/gate-status.js';
import {
  type GateReadCache,
  newGateReadCache,
  readGateGithubFacts,
} from './merge-gate/github-facts.js';
import type { GateGithubPort } from './merge-gate/github-port.js';
import { type GateVerdictView, isFullSha, mergeReadiness } from './merge-gate/readiness.js';
import { hasVerifyRecording } from './merge-gate/recording-attachment.js';
import { type FinalVerdictLine, parseFinalVerdictLine } from './merge-gate/verdict-line.js';
import { githubGatePort } from './merge-gate-github.js';
import { effectiveModel } from './model-fallback.js';
import { reconcileOwners } from './owner.js';
import { projectMergeConfigOf } from './projects.js';
import { coordinatorProfile, profileForStep, routeForStep } from './routing-rules.js';
import { insertMessageRow } from './transcript.js';

export const MERGE_GATE_RUN_KIND = 'merge_gate_run';
export const MERGE_GATE_MISMATCH_KIND = 'merge_gate_mismatch_filed';

export type MergeGateRunAction = 'auto-merge-on' | 'auto-merge-off';

export interface MergeGateRunRecord {
  kind: typeof MERGE_GATE_RUN_KIND;
  rawOutput: string;
  parsedVerdict: FinalVerdictLine | null;
  structuredOutcome: 'pass' | 'block' | 'extraction_failed' | 'step_failed' | null;
  action: MergeGateRunAction;
  modelId: string | null;
  headSha: string | null;
  mismatch: boolean;
}

const readCaches = new Map<string, GateReadCache>();
const IN_FLIGHT = ['pending', 'claimed', 'waiting_quota'] as const;

export function readMergeGateState(
  db: Db,
  buildId: string,
): (MergeReadiness & { evaluatedAt: number }) | null {
  const row = db.select().from(gateState).where(eq(gateState.buildId, buildId)).get();
  if (row === undefined) return null;
  const parsed = mergeReadinessSchema.safeParse({
    ready: row.ready,
    headSha: row.headSha,
    patchDigest: row.patchDigest,
    policy: row.policy,
    blockers: row.blockers,
  });
  return parsed.success ? { ...parsed.data, evaluatedAt: row.evaluatedAt } : null;
}

export function gateRunMismatch(
  parsed: FinalVerdictLine | null,
  structured: MergeGateRunRecord['structuredOutcome'],
): boolean {
  if (parsed === null || structured === null) return false;
  if (structured !== 'pass' && structured !== 'block') return false;
  return parsed !== structured;
}

export async function evaluateMergeGate(
  deps: BuildDeps,
  buildId: string,
  opts: { port?: GateGithubPort; now?: number } = {},
): Promise<MergeReadiness | null> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow?.prNumber == null) return null;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow === undefined) return null;
  const projectRow = projectOfTodo(deps.db, todoRow);
  const repo = githubRepoOfProject(projectRow);
  if (repo === null || projectRow === undefined) return null;
  let port = opts.port ?? null;
  if (port === null) {
    const token = await autonomousToken(deps, todoRow.teamId, repo);
    if (token === null) return null;
    port = githubGatePort(deps.githubFetch ?? fetch, token, repo.owner, repo.repo, 10_000, () =>
      userTokenOrNull(deps, todoRow.teamId),
    );
  }
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const ticketRef = String(linked?.issueNumber ?? todoRow.seqNum);
  let cache = readCaches.get(todoRow.teamId);
  if (cache === undefined) {
    cache = newGateReadCache();
    readCaches.set(todoRow.teamId, cache);
  }
  const markerToken = await autonomousToken(deps, todoRow.teamId, repo);
  const githubPaused =
    markerToken !== null
      ? await readGithubAutonomyPause(
          deps.githubFetch ?? fetch,
          markerToken,
          `${repo.owner}/${repo.repo}`,
          cache,
          opts.now ?? nowMs(),
        )
      : false;
  const harness = deps.harnessEval ?? productionHarnessEvalConfig();
  const facts = await readGateGithubFacts(
    port,
    {
      owner: repo.owner,
      repo: repo.repo,
      prNumber: buildRow.prNumber,
      ticketRef,
      evidenceStore: buildRow.evidenceStore,
      now: opts.now ?? nowMs(),
      harnessEval: {
        coordinator: createHarnessEvalCoordinator({
          db: deps.db,
          dispatch: harness.dispatch,
          now: harness.now ?? nowMs,
          attemptTimeoutMs: harness.attemptTimeoutMs ?? DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS,
        }),
        dispatchAuthorized: harness.dispatchAuthorized !== false,
      },
    },
    cache,
  );
  const head = facts.pr !== null && isFullSha(facts.pr.headSha) ? facts.pr.headSha : null;
  const digest =
    head !== null && typeof facts.compare === 'object'
      ? computePatchDigest(facts.compare.files, {
          expectedFileCount: facts.pr?.changedFiles ?? null,
        })
      : null;
  if (isCorrectionTask(deps.db, todoRow.id) && head !== null) {
    recordCorrectionGuard(
      deps.db,
      buildId,
      head,
      digest?.patchDigest != null &&
        typeof facts.compare === 'object' &&
        facts.compare.headSha === head
        ? correctionDoneCheck(
            facts.compare.files.map((file) => ({
              path: file.filename,
              additions: file.additions,
              status: file.status,
            })),
          )
        : null,
    );
  }
  const steps = deps.db.select().from(step).where(eq(step.buildId, buildId)).all();
  const stored = deps.db.select().from(gateVerdict).where(eq(gateVerdict.buildId, buildId)).all();
  if (digest?.patchDigest != null && head !== null) {
    for (const row of stored) {
      if (
        row.patchDigest !== null ||
        row.headSha !== head ||
        row.expectedHeadSha !== head ||
        (row.outcome !== 'pass' && row.outcome !== 'block')
      ) {
        continue;
      }
      deps.db
        .update(gateVerdict)
        .set({ patchDigest: digest.patchDigest })
        .where(and(eq(gateVerdict.stepId, row.stepId), isNull(gateVerdict.patchDigest)))
        .run();
      row.patchDigest = digest.patchDigest;
    }
  }
  const answers = new Map<string, ReviewVerdict>();
  const reviewStepIds = new Set(
    steps.filter((item) => item.kind === 'review').map((item) => item.id),
  );
  for (const row of deps.db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .orderBy(asc(message.createdAt))
    .all()) {
    let raw = row.content;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        continue;
      }
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as { kind?: unknown; verdict?: unknown; stepId?: unknown };
    if (record.kind !== REVIEW_VERDICT_KIND) continue;
    if (typeof record.stepId !== 'string' || !reviewStepIds.has(record.stepId)) continue;
    const recorded = stored.find((item) => item.stepId === record.stepId);
    if (recorded?.outcome === 'step_failed') continue;
    const parsed = reviewVerdictSchema.safeParse(record.verdict);
    if (!parsed.success) continue;
    answers.set(record.stepId, parsed.data);
  }
  const reviewModelOf = (reviewStep: typeof step.$inferSelect): string | null => {
    const reviewer = profileForStep(deps.db, todoRow, 'review');
    return reviewer === null ? null : effectiveModel(reviewer, reviewStep).modelId;
  };
  const perspectiveOfStep = (stepId: string): string =>
    stored.find((row) => row.stepId === stepId)?.perspective ?? 'review';
  const views: GateVerdictView[] = stored.map((row) => {
    const reviewStep = steps.find((item) => item.id === row.stepId);
    const meta = reviewStep?.kind === 'review' ? parseReviewPromptMeta(reviewStep.prompt) : null;
    const reviewerId = meta?.agentId ?? null;
    const answer = answers.get(row.stepId);
    return {
      kind: row.kind,
      perspective: row.perspective ?? (reviewStep ? 'review' : null),
      outcome: row.outcome,
      patchDigest: row.patchDigest,
      headSha: row.headSha,
      recordingAttached:
        buildRow.evidenceStore === 'attachments' &&
        row.kind === 'verify' &&
        row.headSha === row.expectedHeadSha &&
        row.outcome === 'pass' &&
        row.patchDigest !== null &&
        row.patchDigest === digest?.patchDigest &&
        reviewStep?.kind === 'verify' &&
        hasVerifyRecording(deps, {
          stepId: row.stepId,
          todoId: todoRow.id,
          teamId: todoRow.teamId,
        }),
      reviewerId,
      reviewerModel: reviewStep?.kind === 'review' ? reviewModelOf(reviewStep) : null,
      gateLoosening: answer?.gateLoosening ?? null,
      evalRulerChange: answer?.evalRulerChange ?? null,
    };
  });
  const perspectives = [
    ...new Set(
      steps.filter((item) => item.kind === 'review').map((item) => perspectiveOfStep(item.id)),
    ),
  ];
  const buildSteps = steps
    .filter((item) => isBuildStepKind(item.kind) && item.status === 'done')
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
  const authorStep = buildSteps.at(-1);
  const authorAgent =
    authorStep !== undefined
      ? profileForStep(deps.db, todoRow, authorStep.kind, authorStep.id)
      : null;
  const verifier = routeForStep(deps.db, todoRow, 'session') !== null;
  const policy = autonomousMergePolicy(
    deps.db,
    todoRow.teamId,
    projectMergeConfigOf(projectRow),
    opts.now ?? nowMs(),
  );
  const readiness = mergeReadiness({
    evidenceStore: buildRow.evidenceStore,
    correction: isCorrectionTask(deps.db, todoRow.id),
    author:
      authorAgent !== null && authorStep !== undefined
        ? { id: authorAgent.id, model: effectiveModel(authorAgent, authorStep).modelId ?? '' }
        : null,
    policy: {
      mergePolicy: projectMergeConfigOf(projectRow).mergePolicy,
      requireUpToDate: projectMergeConfigOf(projectRow).requireUpToDate,
      ...policy,
      autonomyPaused: policy.autonomyPaused || githubPaused,
    },
    build: {
      isGithubPr: true,
      repoKind: projectRow.repoKind === 'local' ? 'local' : 'github',
      isCurrent: todoRow.latestBuildId === buildId,
      phase: todoRow.phase,
      stepsInFlight: steps.filter((item) => (IN_FLIGHT as readonly string[]).includes(item.status))
        .length,
    },
    repo: {
      owner: repo.owner,
      name: repo.repo,
      defaultBranch: projectRow.baseBranch ?? facts.defaultBranch,
    },
    ticketRef,
    issueNumber: linked?.issueNumber ?? null,
    pr: facts.pr,
    checks: facts.checks,
    compare: facts.compare,
    evidence: facts.evidence,
    verdicts: views,
    round: {
      perspectives,
      timedOut: [],
      fixRoundsExhausted: false,
      fixNoChange: false,
      gateRoundsExhausted: false,
    },
    availability: {
      reviewerPerspectives: perspectives,
      verifier,
      decider: coordinatorProfile(deps.db, todoRow.teamId) !== null,
    },
    harnessEvalText: facts.harnessEvalText,
    ...(facts.harnessEval !== null ? { harnessEval: facts.harnessEval } : {}),
  });
  const evaluatedAt = opts.now ?? nowMs();
  if (digest?.patchDigest != null && head !== null) {
    deps.db
      .insert(gateDigest)
      .values({
        buildId,
        headSha: head,
        patchDigest: digest.patchDigest,
        countedFiles: digest.countedFiles,
        countedLines: digest.countedLines,
        keptFiles: digest.kept.length,
        keptLines: digest.kept.reduce((n, file) => n + file.additions + file.deletions, 0),
        createdAt: evaluatedAt,
      })
      .onConflictDoNothing()
      .run();
    const open = steps.some(
      (item) => item.kind === 'review' && (IN_FLIGHT as readonly string[]).includes(item.status),
    );
    const closed = views.some(
      (item) =>
        item.kind === 'review' &&
        item.patchDigest === digest.patchDigest &&
        (item.outcome === 'pass' || item.outcome === 'block'),
    );
    const dispatches = Object.fromEntries(
      steps
        .filter((item) => item.kind === 'review')
        .map((item) => [perspectiveOfStep(item.id), { count: 1, lastAt: item.createdAt }]),
    );
    const existing = deps.db
      .select()
      .from(gateRound)
      .where(and(eq(gateRound.buildId, buildId), eq(gateRound.patchDigest, digest.patchDigest)))
      .get();
    if (existing === undefined) {
      const roundNo =
        deps.db
          .select({ round: gateRound.round })
          .from(gateRound)
          .where(eq(gateRound.buildId, buildId))
          .all()
          .reduce((n, row) => Math.max(n, row.round), 0) + 1;
      deps.db
        .insert(gateRound)
        .values({
          id: newRecordId(),
          buildId,
          patchDigest: digest.patchDigest,
          round: roundNo,
          fixRound: 0,
          state: open || !closed ? 'open' : 'closed',
          perspectives,
          timedOut: [],
          dispatches,
          startedAt: evaluatedAt,
        })
        .run();
    } else {
      deps.db
        .update(gateRound)
        .set({
          state: open || !closed ? 'open' : 'closed',
          perspectives,
          dispatches,
        })
        .where(eq(gateRound.id, existing.id))
        .run();
    }
  }
  deps.db
    .insert(gateState)
    .values({
      buildId,
      ready: readiness.ready,
      headSha: readiness.headSha,
      patchDigest: readiness.patchDigest,
      policy: readiness.policy,
      blockers: readiness.blockers,
      evaluatedAt,
    })
    .onConflictDoUpdate({
      target: gateState.buildId,
      set: {
        ready: readiness.ready,
        headSha: readiness.headSha,
        patchDigest: readiness.patchDigest,
        policy: readiness.policy,
        blockers: readiness.blockers,
        evaluatedAt,
      },
    })
    .run();
  reconcileOwners(deps, [todoRow.id]);
  const plan = planGateStatusWrite({
    policy: readiness.policy,
    readiness,
    checksHeadSha: facts.checks?.headSha ?? null,
    current: facts.ownStatus,
  });
  if (plan.write) await writeGateStatus(port, plan);

  const reviewSteps = steps
    .filter((item) => item.kind === 'review')
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
  const latestReview = reviewSteps.at(-1);
  if (latestReview !== undefined && latestReview.status === 'done') {
    const modelId = reviewModelOf(latestReview);
    const reviewRowPrefix = `msg-${latestReview.id}-`;
    const rawOutput = deps.db
      .select()
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, 'assistant'),
          eq(sql`substr(${message.id}, 1, ${reviewRowPrefix.length})`, reviewRowPrefix),
        ),
      )
      .orderBy(asc(message.createdAt))
      .all()
      .map((row) => (typeof row.content === 'string' ? row.content : JSON.stringify(row.content)))
      .join('\n');
    const storedReview = stored.find((item) => item.stepId === latestReview.id);
    const structuredOutcome =
      storedReview?.outcome === 'pass' ||
      storedReview?.outcome === 'block' ||
      storedReview?.outcome === 'extraction_failed' ||
      storedReview?.outcome === 'step_failed'
        ? storedReview.outcome
        : null;
    const parsedVerdict = parseFinalVerdictLine(rawOutput);
    const action: MergeGateRunAction =
      readiness.ready && parsedVerdict !== 'block' ? 'auto-merge-on' : 'auto-merge-off';
    const mismatch = gateRunMismatch(parsedVerdict, structuredOutcome);
    const run: MergeGateRunRecord = {
      kind: MERGE_GATE_RUN_KIND,
      rawOutput,
      parsedVerdict,
      structuredOutcome,
      action,
      modelId,
      headSha: head,
      mismatch,
    };
    const prior = deps.db
      .select()
      .from(message)
      .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
      .all()
      .find((row) => {
        let raw = row.content;
        if (typeof raw === 'string') {
          try {
            raw = JSON.parse(raw) as unknown;
          } catch {
            return false;
          }
        }
        return (
          raw !== null &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          (raw as { kind?: unknown }).kind === MERGE_GATE_RUN_KIND &&
          (raw as { headSha?: unknown }).headSha === head
        );
      });
    if (prior === undefined) {
      insertMessageRow(deps, buildId, {
        id: newRecordId(),
        role: 'system',
        content: JSON.stringify(run),
        createdAt: evaluatedAt,
      });
    } else {
      deps.db
        .update(message)
        .set({ content: JSON.stringify(run) })
        .where(eq(message.id, prior.id))
        .run();
    }
    if (mismatch) {
      const filed = deps.db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
        .all()
        .some((row) => {
          let raw = row.content;
          if (typeof raw === 'string') {
            try {
              raw = JSON.parse(raw) as unknown;
            } catch {
              return false;
            }
          }
          return (
            raw !== null &&
            typeof raw === 'object' &&
            !Array.isArray(raw) &&
            (raw as { kind?: unknown }).kind === MERGE_GATE_MISMATCH_KIND &&
            (raw as { headSha?: unknown }).headSha === head
          );
        });
      if (!filed) {
        const token = await autonomousToken(deps, todoRow.teamId, repo);
        if (token !== null) {
          const key = ticketDedupeKey({
            category: `merge-gate-mismatch:${buildId}:${head ?? 'none'}`,
            paths: [],
          });
          const created = await githubCreateIssue(
            deps.githubFetch ?? fetch,
            token,
            repo.owner,
            repo.repo,
            {
              title: `merge-gate mismatch on PR #${buildRow.prNumber}`,
              body: [
                ticketDedupeMarker(key),
                `Build ${buildId} head ${head ?? '(none)'}.`,
                `Parsed VERDICT line: ${parsedVerdict ?? '(none)'}.`,
                `Structured gate outcome: ${structuredOutcome ?? '(none)'}.`,
                'The parsed verdict and the recorded gate outcome disagree; do not trust auto-merge for this head.',
              ].join('\n\n'),
              labels: ['correction', 'enhancement', 'needs-triage'],
            },
          );
          insertMessageRow(deps, buildId, {
            id: newRecordId(),
            role: 'system',
            content: JSON.stringify({
              kind: MERGE_GATE_MISMATCH_KIND,
              headSha: head,
              issueNumber: created.number,
            }),
            createdAt: nowMs(),
          });
        }
      }
    }
  }

  return readiness;
}
