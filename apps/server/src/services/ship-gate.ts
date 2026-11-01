import type { MergeBlockerCode, MergeReadiness } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { build, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { githubPull } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { autonomousMergePolicy } from './autonomous-merge.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { pauseTeamGithubRepos } from './github-autonomy-brake.js';
import { teamGithubToken } from './github-connection.js';
import { localGateFacts } from './local-merge-facts.js';
import { upsertMessage } from './machine-deps.js';
import { evaluateMergeGate } from './merge-gate-run.js';
import { sendMustReachAlert } from './push-alerts.js';

const INSTRUCTION_PREFIX = 'Ship gate verdict: ';
const instructionSchema = z
  .object({ buildId: z.string().min(1), judgedHead: z.string().min(1) })
  .strict();
export type ShipGateInstruction = z.infer<typeof instructionSchema>;

export const CUSTOM_NEEDS_PR =
  'the custom ship route needs a GitHub pull request so the landing can be verified; local projects use local-merge';

const USER_APPROVAL_BLOCKERS: readonly MergeBlockerCode[] = ['policy-human'];
const OWN_STEP_BLOCKERS: readonly MergeBlockerCode[] = [
  ...USER_APPROVAL_BLOCKERS,
  'work-in-flight',
];

export function appendShipGateInstruction(
  prompt: string,
  instruction: ShipGateInstruction,
): string {
  const pin = `Merge only the judged commit ${instruction.judgedHead}. Push nothing to the pull request first. With gh, pass --match-head-commit ${instruction.judgedHead} to gh pr merge, or send sha=${instruction.judgedHead} to the merge API. If the head differs, stop and report instead of merging.`;
  return `${prompt}\n${pin}\n${INSTRUCTION_PREFIX}${JSON.stringify(instruction)}`;
}

export function parseShipGateInstruction(prompt: string | null): ShipGateInstruction | null {
  const line = prompt?.split('\n').find((value) => value.startsWith(INSTRUCTION_PREFIX));
  if (line === undefined) return null;
  try {
    const result = instructionSchema.safeParse(JSON.parse(line.slice(INSTRUCTION_PREFIX.length)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function hasGithubPr(deps: BuildDeps, buildId: string): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!buildRow || !todoRow) return false;
  return (
    githubRepoOfProject(projectOfTodo(deps.db, todoRow)) !== null && buildRow.prNumber !== null
  );
}

async function readinessOf(deps: BuildDeps, buildId: string): Promise<MergeReadiness | null> {
  if (deps.mergeVerdict !== undefined) return deps.mergeVerdict(buildId);
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return null;
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow === undefined) return null;
  if (githubRepoOfProject(projectRow) !== null) return evaluateMergeGate(deps, buildId);
  if (projectRow.repoKind !== 'local' || projectRow.localPath === null) return null;
  const defaultBranch =
    projectRow.baseBranch ??
    (await (deps.gitOps ?? systemGitOps).listBranches(projectRow.localPath).catch(() => null))
      ?.defaultBranch ??
    null;
  if (defaultBranch === null) return null;
  return (await localGateFacts(deps, buildId, defaultBranch))?.readiness ?? null;
}

async function refusalOf(
  deps: BuildDeps,
  buildId: string,
  ignored: readonly MergeBlockerCode[],
): Promise<{ reason: string } | { headSha: string }> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return { reason: 'build or task missing' };
  const brake = autonomousMergePolicy(
    deps.db,
    todoRow.teamId,
    { mergePolicy: 'autonomous', localChecks: [] },
    nowMs(),
    buildId,
  );
  if (brake.autonomyPaused) return { reason: 'autonomy-paused: merging is paused for this team' };
  if (brake.dailyCapReached) return { reason: 'daily-cap: the daily merge cap is reached' };
  const readiness = await readinessOf(deps, buildId);
  if (readiness === null) {
    return { reason: 'the merge gate has no verdict for this build (no PR or local gate facts)' };
  }
  const blocking = readiness.blockers.filter((b) => !ignored.includes(b.code));
  if (blocking.length > 0) {
    return { reason: `merge gate blocks this ship: ${blocking.map((b) => b.label).join('; ')}` };
  }
  if (readiness.headSha === null) return { reason: 'the merge gate has no head to judge' };
  return { headSha: readiness.headSha };
}

export async function judgeShip(deps: BuildDeps, buildId: string): Promise<{ headSha: string }> {
  const outcome = await refusalOf(deps, buildId, USER_APPROVAL_BLOCKERS);
  if ('reason' in outcome) throw new HttpError(409, outcome.reason);
  return outcome;
}

export async function reverifyShip(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
): Promise<string | null> {
  const instruction = parseShipGateInstruction(stepRow.prompt);
  if (instruction === null) return null;
  if (instruction.buildId !== stepRow.buildId) return 'ship gate verdict belongs to another build';
  if (!hasGithubPr(deps, stepRow.buildId)) return CUSTOM_NEEDS_PR;
  const outcome = await refusalOf(deps, stepRow.buildId, OWN_STEP_BLOCKERS).catch(
    (err: unknown) => ({ reason: `merge gate could not be evaluated: ${String(err)}` }),
  );
  if ('reason' in outcome) return outcome.reason;
  return outcome.headSha === instruction.judgedHead
    ? null
    : `head moved from ${instruction.judgedHead.slice(0, 7)} to ${outcome.headSha.slice(0, 7)} after the gate verdict`;
}

async function raiseUnjudgedLanding(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  teamId: string,
  reason: string,
): Promise<void> {
  await pauseTeamGithubRepos(deps, teamId).catch(() => undefined);
  upsertMessage(deps, {
    id: `ship-unjudged-${stepRow.id}`,
    conversationId: stepRow.buildId,
    role: 'system',
    content: `Autonomy paused: ${reason}`,
    createdAt: nowMs(),
  });
  void sendMustReachAlert(deps.db, deps.vapidKeys ?? null, deps.user.id, teamId, {
    title: 'Unjudged code was merged',
    body: reason,
    href: '/app',
    tag: `ship-unjudged-${stepRow.id}`,
  }).catch(() => undefined);
}

type LandingInspection =
  | { kind: 'ok' }
  | { kind: 'not-merged' }
  | { kind: 'unverifiable' | 'head-moved'; reason: string }
  | { kind: 'unjudged'; reason: string; teamId: string };

async function inspectShipLanding(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
): Promise<LandingInspection> {
  const instruction = parseShipGateInstruction(stepRow.prompt);
  if (instruction === null) return { kind: 'ok' };
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!buildRow || !todoRow) {
    return { kind: 'unverifiable', reason: 'cannot verify the landing: build or task missing' };
  }
  const repo = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  if (repo === null || buildRow.prNumber === null) return { kind: 'ok' };
  const access = await teamGithubToken(deps, todoRow.teamId);
  if (!('token' in access)) {
    return { kind: 'unverifiable', reason: 'cannot verify the landing: no GitHub connection' };
  }
  const page = await githubPull(
    deps.githubFetch ?? fetch,
    access.token,
    repo.owner,
    repo.repo,
    buildRow.prNumber,
  );
  const pull = page?.pull ?? null;
  if (pull === null || pull.headSha === null) {
    return {
      kind: 'unverifiable',
      reason: 'cannot verify the landing: the pull request could not be read',
    };
  }
  if (pull.headSha === instruction.judgedHead) {
    return pull.merged ? { kind: 'ok' } : { kind: 'not-merged' };
  }
  const moved = `pull request head ${pull.headSha.slice(0, 7)} differs from the judged head ${instruction.judgedHead.slice(0, 7)}`;
  if (!pull.merged) return { kind: 'head-moved', reason: `head-moved: ${moved}` };
  return { kind: 'unjudged', reason: `unjudged code was merged: ${moved}`, teamId: todoRow.teamId };
}

export async function verifyShipLanding(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reportedStatus: 'success' | 'failed' | 'stopped',
): Promise<string | null> {
  const found = await inspectShipLanding(deps, stepRow);
  if (found.kind === 'ok') return null;
  if (found.kind === 'not-merged') {
    return reportedStatus === 'success'
      ? 'custom ship reported success but the PR is not merged'
      : null;
  }
  if (found.kind === 'unjudged') {
    await raiseUnjudgedLanding(deps, stepRow, found.teamId, found.reason);
  }
  return found.reason;
}

export async function settleAbandonedShip(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
): Promise<string | null> {
  const found = await inspectShipLanding(deps, stepRow).catch(
    (): LandingInspection => ({ kind: 'ok' }),
  );
  if (found.kind !== 'unjudged') return null;
  await raiseUnjudgedLanding(deps, stepRow, found.teamId, found.reason);
  return found.reason;
}
