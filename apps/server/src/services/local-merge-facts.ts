import {
  type CompareFile,
  MERGE_GATE_STATUS_CONTEXT,
  parseGithubIssueSourceRef,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { build, gateState, gateVerdict, step, todo } from '../db/schema.js';
import { systemGitOps } from '../lib/git.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { projectOfTodo } from './git.js';
import { createHarnessEvalCoordinator } from './harness-eval-coordinator.js';
import { judgeMergeReadinessWithHarnessEval } from './merge-gate/harness-eval-judge.js';
import { type GateInputs, mergeReadiness } from './merge-gate/readiness.js';
import { projectMergeConfigOf } from './projects.js';

export interface LocalGateFactsResult {
  node: string;
  inputs: GateInputs;
  readiness: ReturnType<typeof mergeReadiness>;
  ready: boolean;
  judgedBase: string | null;
  judgedHead: string | null;
  judgedDigest: string | null;
  verdicts: GateInputs['verdicts'];
  requiredChecks: string[];
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function localBoundaryShas(boundary: { base: string | null; head: string | null }): {
  baseSha: string | null;
  headSha: string | null;
} {
  if (
    boundary.base === null ||
    boundary.head === null ||
    !FULL_SHA.test(boundary.base) ||
    !FULL_SHA.test(boundary.head) ||
    boundary.base === boundary.head
  ) {
    return { baseSha: null, headSha: null };
  }
  return { baseSha: boundary.base, headSha: boundary.head };
}

export async function localGateFacts(
  deps: BuildDeps,
  buildId: string,
  defaultBranch: string,
  decorate?: (inputs: GateInputs) => GateInputs,
  declared?: { base: string | null; head: string | null },
): Promise<LocalGateFactsResult | null> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return null;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return null;
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow?.repoKind !== 'local') return null;
  const config = projectMergeConfigOf(projectRow);
  const required = [...config.localChecks];
  const rows = deps.db
    .select({ kind: step.kind, commit: step.checkpointCommit })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.status, 'done'),
        notInArray(step.kind, ['review', 'verify', 'merge']),
        isNotNull(step.checkpointCommit),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  const commits = rows
    .map((r) => r.commit)
    .filter((c): c is string => c !== null && FULL_SHA.test(c));
  const head = declared === undefined ? (commits.at(-1) ?? null) : declared.head;
  const base =
    declared === undefined ? (commits.find((c) => c !== commits.at(-1)) ?? null) : declared.base;
  const { baseSha, headSha } = localBoundaryShas({ base, head });
  const compareFiles: CompareFile[] | 'malformed' =
    baseSha === null || headSha === null || projectRow.localPath === null
      ? 'malformed'
      : await (deps.gitOps ?? systemGitOps)
          .localCompareFiles(projectRow.localPath, baseSha, headSha)
          .catch((): 'malformed' => 'malformed');
  const state = deps.db.select().from(gateState).where(eq(gateState.buildId, buildId)).get();
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .all();
  const persisted = deps.db
    .select()
    .from(gateVerdict)
    .where(eq(gateVerdict.buildId, buildId))
    .orderBy(asc(gateVerdict.createdAt))
    .all();
  const judgedDigest =
    state !== undefined && headSha !== null && state.headSha === headSha
      ? (state.patchDigest ?? null)
      : null;
  const verdicts: GateInputs['verdicts'] = persisted.map((v) => ({
    kind: v.kind,
    headSha: v.headSha,
    perspective: v.perspective,
    patchDigest: v.patchDigest,
    outcome: v.outcome,
  }));
  const source = todoRow.sourceRef === null ? null : parseGithubIssueSourceRef(todoRow.sourceRef);
  const ticketRef = String(source?.issueNumber ?? todoRow.seqNum);
  const perspectives = [
    ...new Set(
      verdicts.flatMap((v) =>
        v.kind === 'review' && v.perspective !== null ? [v.perspective] : [],
      ),
    ),
  ];
  const presented = new Set([...persisted.map((v) => v.patchDigest), judgedDigest]);
  const files = compareFiles;
  const compare =
    baseSha !== null && headSha !== null && files !== 'malformed'
      ? {
          headSha,
          files,
          commits: [{ sha: headSha, parents: [baseSha] }],
          totalCommits: 1,
        }
      : ('malformed' as const);
  const built: GateInputs = {
    author: null,
    policy: { mergePolicy: config.mergePolicy, autonomyPaused: false, dailyCapReached: false },
    build: {
      isGithubPr: false,
      repoKind: 'local',
      isCurrent: todoRow.latestBuildId === buildId,
      phase: todoRow.phase,
      stepsInFlight: inFlight.length,
    },
    repo: { owner: '', name: projectRow.name, defaultBranch },
    ticketRef,
    issueNumber: source?.issueNumber ?? null,
    pr: null,
    checks:
      headSha === null
        ? null
        : {
            headSha,
            statusSha: headSha,
            required,
            runs: [
              ...required
                .filter((name) => name.toLowerCase() !== MERGE_GATE_STATUS_CONTEXT)
                .map((name) => ({ name, headSha, status: 'completed', conclusion: 'success' })),
              { name: 'pr-evidence', headSha, status: 'completed', conclusion: 'success' },
            ],
            statuses: [{ context: MERGE_GATE_STATUS_CONTEXT, state: 'success' }],
            complete: true,
          },
    compare,
    evidence: [],
    verdicts,
    round: null,
    availability: {
      reviewerPerspectives: perspectives,
      verifier: verdicts.some((v) => v.kind === 'verify'),
      decider: judgedDigest !== null && presented.has(judgedDigest),
    },
  };
  const inputs = decorate === undefined ? built : decorate(built);
  const prNumber = buildRow.prNumber;
  if (deps.harnessEval !== undefined && prNumber !== null) {
    const harness = deps.harnessEval;
    const coordinator = createHarnessEvalCoordinator({
      db: deps.db,
      dispatch: harness.dispatch,
      now: harness.now ?? nowMs,
      attemptTimeoutMs: harness.attemptTimeoutMs ?? 60 * 60 * 1000,
    });
    const judged = await judgeMergeReadinessWithHarnessEval({
      inputs,
      coordinator,
      repo:
        inputs.repo.owner !== '' && inputs.repo.name !== ''
          ? `${inputs.repo.owner}/${inputs.repo.name}`
          : projectRow.name,
      pr: prNumber,
      dispatchAuthorized: harness.dispatchAuthorized !== false,
      now: (harness.now ?? nowMs)(),
    });
    return {
      node: buildId,
      inputs: judged.inputs,
      readiness: judged.readiness,
      ready: judged.readiness.ready,
      judgedBase: baseSha,
      judgedHead: judged.readiness.headSha,
      judgedDigest,
      verdicts,
      requiredChecks: required,
    };
  }
  const readiness = mergeReadiness(inputs);
  return {
    node: buildId,
    inputs,
    readiness,
    ready: readiness.ready,
    judgedBase: baseSha,
    judgedHead: readiness.headSha,
    judgedDigest,
    verdicts,
    requiredChecks: required,
  };
}
