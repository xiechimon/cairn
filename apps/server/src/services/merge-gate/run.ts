import type { MergeGateRun, MergeReadiness } from '@cairn/shared';
import { mergeReadinessSchema } from '@cairn/shared/merge-gate';
import { auditMergedGate, type GateAuditIssuePort } from './audit.js';
import { computePatchDigest } from './digest.js';
import { planGateStatusWrite, writeGateStatus } from './gate-status.js';
import { type GateReadCache, newGateReadCache, readGateGithubFacts } from './github-facts.js';
import type { GateGithubPort } from './github-port.js';
import { type GateVerdictView, isFullSha, mergeReadiness } from './readiness.js';
import type { GateRuntimePort } from './runtime-port.js';
import { reviewVerdictFacts, verificationItemsForPlan, verifyVerdictFacts } from './verdict.js';

const readCaches = new Map<string, GateReadCache>();
const IN_FLIGHT = ['pending', 'claimed', 'waiting_quota'] as const;

export function readMergeGateState(
  runtime: Pick<GateRuntimePort, 'readState'>,
  buildId: string,
): (MergeReadiness & { evaluatedAt: number }) | null {
  const row = runtime.readState(buildId);
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
  runtime: GateRuntimePort,
  buildId: string,
  opts: {
    port?: GateGithubPort;
    now?: number;
    auditPort?: GateAuditIssuePort;
    requireAudit?: boolean;
  } = {},
): Promise<MergeReadiness | null> {
  const unavailable = (): null => {
    if (opts.requireAudit) throw new Error('Merged PR audit prerequisites unavailable');
    return null;
  };
  const buildRow = runtime.readBuild(buildId);
  if (buildRow?.prNumber == null) return unavailable();
  const todoRow = runtime.readTodo(buildRow.todoId);
  if (todoRow === undefined) return unavailable();
  const projectRow = runtime.readProject(todoRow);
  const repo = runtime.projectRepo(projectRow);
  if (repo === null || projectRow === undefined) return unavailable();
  let port = opts.port ?? null;
  if (port === null) port = await runtime.githubPort(todoRow.teamId, repo);
  if (port === null) return unavailable();
  const linked = todoRow.sourceRef !== null ? runtime.parseIssueRef(todoRow.sourceRef) : null;
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
      now: opts.now ?? runtime.now(),
    },
    cache,
  );
  const head = facts.pr !== null && isFullSha(facts.pr.headSha) ? facts.pr.headSha : null;
  if (opts.requireAudit && (!facts.pr?.merged || head === null || !runtime.hasAuditStorage)) {
    throw new Error('Merged PR audit requires readable merged facts and durable storage');
  }
  const digest =
    head !== null && typeof facts.compare === 'object'
      ? computePatchDigest(facts.compare.files, {
          expectedFileCount: facts.pr?.changedFiles ?? null,
        })
      : null;
  const steps = runtime.readSteps(buildId);
  const agents = new Map(runtime.readAgents(todoRow.teamId).map((row) => [row.id, row]));
  const stored = runtime.readVerdicts(buildId);
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
      runtime.bindVerdictDigest(row.stepId, digest.patchDigest);
      row.patchDigest = digest.patchDigest;
    }
  }
  const perspectiveOf = (prompt: string | null): string => {
    const id = runtime.parseReviewMeta(prompt)?.agentId;
    return (id !== undefined ? agents.get(id)?.persona : null) ?? 'review';
  };
  const verificationItems = verificationItemsForPlan(
    runtime.readPlanContent(buildId),
    buildRow.withPlan,
  );
  const views: GateVerdictView[] = stored.map((row) => {
    const reviewStep = steps.find((item) => item.id === row.stepId);
    const completed = reviewStep?.status === 'done';
    const answer =
      completed && row.kind !== 'verify' ? runtime.parseReviewVerdict(row.payload) : null;
    const verifyAnswer =
      completed && row.kind === 'verify' ? runtime.parseVerifyVerdict(row.payload) : null;
    const payload =
      row.kind === 'verify'
        ? verifyVerdictFacts(verifyAnswer ?? undefined, verificationItems)
        : reviewVerdictFacts(answer ?? undefined);
    const outcome = ['pass', 'block', 'extraction_failed'].includes(row.outcome)
      ? !payload.extracted
        ? 'extraction_failed'
        : payload.blocked
          ? 'block'
          : row.outcome
      : row.outcome;
    return {
      kind: row.kind,
      perspective: row.perspective ?? (reviewStep ? perspectiveOf(reviewStep.prompt) : null),
      outcome,
      patchDigest: row.patchDigest,
      headSha: row.headSha,
      reviewerId: row.reviewerAgentId,
      reviewerModel: row.reviewerModelId,
      gateLoosening: answer?.gateLoosening ?? null,
      evalRulerChange: answer?.evalRulerChange ?? null,
    };
  });
  const perspectives = [
    ...new Set(
      steps
        .filter(
          (item) =>
            item.kind === 'review' && runtime.parseReviewMeta(item.prompt)?.purpose !== 'decision',
        )
        .map((item) => perspectiveOf(item.prompt)),
    ),
  ];
  const buildSteps = steps
    .filter((item) => item.kind === 'build' && item.status === 'done')
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt));
  const authorStep = buildSteps.at(-1);
  const chiefRow = runtime.readChief(todoRow.teamId);
  const verifier =
    todoRow.assignment?.verify?.agentId != null ||
    [...agents.values()].some((item) => item.persona === 'verifier');
  const readiness = mergeReadiness({
    author:
      authorStep !== undefined
        ? {
            id: authorStep.fallback?.execution?.agentId ?? '',
            model:
              authorStep.fallback?.execution?.modelId ?? authorStep.fallback?.model?.modelId ?? '',
          }
        : null,
    policy: {
      mergePolicy: runtime.projectPolicy(projectRow),
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
  if (
    readiness.headSha !== null &&
    readiness.patchDigest !== null &&
    readiness.blockers.length === 1 &&
    readiness.blockers[0]?.code === 'decision-missing' &&
    chiefRow?.agentId != null &&
    agents.has(chiefRow.agentId) &&
    !steps.some(
      (item) =>
        item.kind === 'review' &&
        runtime.parseReviewMeta(item.prompt)?.purpose === 'decision' &&
        runtime.parseReviewMeta(item.prompt)?.expectedHeadSha === readiness.headSha &&
        runtime.parseReviewMeta(item.prompt)?.expectedPatchDigest === readiness.patchDigest,
    )
  ) {
    const report = stored
      .filter((verdict) => verdict.patchDigest === readiness.patchDigest)
      .map((verdict) =>
        JSON.stringify({
          stepId: verdict.stepId,
          kind: verdict.kind,
          modelId: verdict.reviewerModelId,
          verdict: verdict.payload,
        }),
      );
    runtime.enqueueReview(
      buildId,
      todoRow.teamId,
      runtime.reviewPrompt({
        agentId: chiefRow.agentId,
        gate: 'review',
        purpose: 'decision',
        expectedPatchDigest: readiness.patchDigest,
        expectedHeadSha: readiness.headSha,
        checkout: true,
        planText: todoRow.spec,
        focus: [
          'Produce the chief go/no-go decision for this exact patch after independent review and verification.',
          `Head: ${readiness.headSha}. Patch digest: ${readiness.patchDigest}.`,
          'Read the diff and the reports below. Remain read-only. Do not request or execute a merge.',
          'Return the structured review verdict. Any blocking finding means no-go; no blocking findings means go.',
          ...report,
        ].join('\n\n'),
      }),
    );
  }
  const evaluatedAt = opts.now ?? runtime.now();
  if (digest?.patchDigest != null && head !== null) {
    runtime.insertDigest({
      buildId,
      headSha: head,
      patchDigest: digest.patchDigest,
      countedFiles: digest.countedFiles,
      countedLines: digest.countedLines,
      keptFiles: digest.kept.length,
      keptLines: digest.kept.reduce((n, file) => n + file.additions + file.deletions, 0),
      createdAt: evaluatedAt,
    });
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
    const rounds = runtime.readRounds(buildId);
    const existing = rounds.find((row) => row.patchDigest === digest.patchDigest);
    if (existing === undefined) {
      const roundNo = rounds.reduce((n, row) => Math.max(n, row.round), 0) + 1;
      runtime.insertRound({
        id: runtime.newId(),
        buildId,
        patchDigest: digest.patchDigest,
        round: roundNo,
        fixRound: 0,
        state: open || !closed ? 'open' : 'closed',
        perspectives,
        timedOut: [],
        dispatches,
        startedAt: evaluatedAt,
      });
    } else {
      runtime.updateRound(existing.id, {
        state: open || !closed ? 'open' : 'closed',
        perspectives,
        dispatches,
      });
    }
  }
  runtime.saveState({
    buildId,
    ready: readiness.ready,
    headSha: readiness.headSha,
    patchDigest: readiness.patchDigest,
    policy: readiness.policy,
    blockers: readiness.blockers,
    evaluatedAt,
  });
  const plan = planGateStatusWrite({
    policy: readiness.policy,
    readiness,
    checksHeadSha: facts.checks?.headSha ?? null,
    current: facts.ownStatus,
  });
  const statusResult = plan.write ? await writeGateStatus(port, plan) : null;
  if (runtime.hasAuditStorage) {
    let mismatchIssue: number | null = null;
    if (facts.pr?.merged && readiness.headSha !== null) {
      let auditPort = opts.auditPort;
      if (auditPort === undefined)
        auditPort = (await runtime.auditPort(todoRow.teamId, repo, buildRow.prNumber)) ?? undefined;
      if (auditPort === undefined) throw new Error('Merged PR audit issue port unavailable');
      mismatchIssue = await auditMergedGate(
        runtime.readRuns,
        {
          buildId,
          prNumber: buildRow.prNumber,
          headSha: readiness.headSha,
          merged: true,
        },
        auditPort,
      );
    }
    const reviewers: MergeGateRun['reviewers'] = stored.map((verdict, index) => ({
      stepId: verdict.stepId,
      kind: verdict.kind,
      modelId: verdict.reviewerModelId,
      rawOutput: runtime.readSession(verdict.stepId),
      verdict:
        verdict.kind === 'verify'
          ? runtime.parseVerifyVerdict(verdict.payload)
          : runtime.parseReviewVerdict(verdict.payload),
      outcome: views[index]?.outcome ?? verdict.outcome,
    }));
    runtime.appendRun({
      id: runtime.newId(),
      buildId,
      at: evaluatedAt,
      headSha: readiness.headSha,
      patchDigest: readiness.patchDigest,
      ready: readiness.ready,
      blockerCodes: readiness.blockers.map((item) => item.code),
      merged: facts.pr?.merged ?? false,
      mismatchIssue,
      reviewers,
      action: {
        status: plan.write
          ? statusResult?.kind === 'ok'
            ? 'written'
            : 'failed'
          : plan.reason === 'unchanged'
            ? 'unchanged'
            : 'not-requested',
        autoMerge: 'not-requested',
      },
    });
  }
  return readiness;
}
