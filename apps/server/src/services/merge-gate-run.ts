import {
  type MergeReadiness,
  mergeReadinessSchema,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  REVIEW_VERDICT_KIND,
  type ReviewVerdict,
  reviewVerdictSchema,
} from '@cairn/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  chief,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  step,
  todo,
} from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { agentForStep } from './dispatch-eligibility.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { computePatchDigest } from './merge-gate/digest.js';
import { planGateStatusWrite, writeGateStatus } from './merge-gate/gate-status.js';
import {
  type GateReadCache,
  newGateReadCache,
  readGateGithubFacts,
} from './merge-gate/github-facts.js';
import type { GateGithubPort } from './merge-gate/github-port.js';
import { type GateVerdictView, isFullSha, mergeReadiness } from './merge-gate/readiness.js';
import { githubGatePort } from './merge-gate-github.js';
import { projectMergeConfigOf } from './projects.js';

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
    const access = await teamGithubToken(deps, todoRow.teamId);
    if (!('token' in access)) return null;
    port = githubGatePort(deps.githubFetch ?? fetch, access.token, repo.owner, repo.repo, 10_000);
  }
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const ticketRef = String(linked?.issueNumber ?? todoRow.seqNum);
  let cache = readCaches.get(todoRow.teamId);
  if (cache === undefined) {
    cache = newGateReadCache();
    readCaches.set(todoRow.teamId, cache);
  }
  const facts = await readGateGithubFacts(
    port,
    {
      owner: repo.owner,
      repo: repo.repo,
      prNumber: buildRow.prNumber,
      ticketRef,
      now: opts.now ?? nowMs(),
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
  const steps = deps.db.select().from(step).where(eq(step.buildId, buildId)).all();
  const agents = new Map(
    deps.db
      .select()
      .from(agent)
      .where(eq(agent.teamId, todoRow.teamId))
      .all()
      .map((row) => [row.id, row]),
  );
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
  const spoken = deps.db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .orderBy(asc(message.createdAt))
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
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const record = raw as { kind?: unknown; verdict?: unknown };
      if (record.kind !== REVIEW_VERDICT_KIND) return [];
      const parsed = reviewVerdictSchema.safeParse(record.verdict);
      return parsed.success ? [parsed.data] : [];
    });
  let spokenAt = 0;
  for (const row of steps
    .filter((item) => item.kind === 'review')
    .sort((a, b) => a.createdAt - b.createdAt)) {
    const recorded = stored.find((item) => item.stepId === row.id);
    if (recorded?.outcome === 'step_failed') continue;
    const verdict = spoken[spokenAt];
    if (verdict === undefined) break;
    spokenAt += 1;
    answers.set(row.id, verdict);
  }
  const perspectiveOf = (prompt: string | null): string => {
    const id = parseReviewPromptMeta(prompt)?.agentId;
    return (id !== undefined ? agents.get(id)?.persona : null) ?? 'review';
  };
  const views: GateVerdictView[] = stored.map((row) => {
    const reviewStep = steps.find((item) => item.id === row.stepId);
    const reviewerId =
      reviewStep?.kind === 'review'
        ? (parseReviewPromptMeta(reviewStep.prompt)?.agentId ?? null)
        : null;
    const answer = answers.get(row.stepId);
    return {
      kind: row.kind,
      perspective: row.perspective ?? (reviewStep ? perspectiveOf(reviewStep.prompt) : null),
      outcome: row.outcome,
      patchDigest: row.patchDigest,
      headSha: row.headSha,
      reviewerId,
      reviewerModel: reviewerId !== null ? (agents.get(reviewerId)?.modelId ?? null) : null,
      gateLoosening: answer?.gateLoosening ?? null,
      evalRulerChange: answer?.evalRulerChange ?? null,
    };
  });
  const perspectives = [
    ...new Set(
      steps.filter((item) => item.kind === 'review').map((item) => perspectiveOf(item.prompt)),
    ),
  ];
  const buildSteps = steps
    .filter((item) => item.kind === 'build' && item.status === 'done')
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
  const authorStep = buildSteps.at(-1);
  const authorAgent =
    authorStep !== undefined ? agentForStep(deps.db, todoRow, 'build', authorStep.prompt) : null;
  const chiefRow = deps.db.select().from(chief).where(eq(chief.teamId, todoRow.teamId)).get();
  const verifier =
    todoRow.assignment?.verify?.agentId != null ||
    [...agents.values()].some((item) => item.persona === 'verifier');
  const readiness = mergeReadiness({
    author: authorAgent !== null ? { id: authorAgent.id, model: authorAgent.modelId ?? '' } : null,
    policy: {
      mergePolicy: projectMergeConfigOf(projectRow).mergePolicy,
      autonomyPaused: false,
      dailyCapReached: false,
    },
    build: {
      isGithubPr: true,
      repoKind: projectRow.repoKind === 'local' ? 'local' : 'github',
      isCurrent: todoRow.latestBuildId === buildId,
      phase: todoRow.phase,
      stepsInFlight: steps.filter((item) => (IN_FLIGHT as readonly string[]).includes(item.status))
        .length,
    },
    repo: { owner: repo.owner, name: repo.repo, defaultBranch: facts.defaultBranch },
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
      decider: chiefRow?.agentId != null,
    },
    harnessEvalText: facts.harnessEvalText,
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
        .map((item) => [perspectiveOf(item.prompt), { count: 1, lastAt: item.createdAt }]),
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
  const plan = planGateStatusWrite({
    policy: readiness.policy,
    readiness,
    checksHeadSha: facts.checks?.headSha ?? null,
    current: facts.ownStatus,
  });
  if (plan.write) await writeGateStatus(port, plan);
  return readiness;
}
