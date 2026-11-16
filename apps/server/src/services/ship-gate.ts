import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { build, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { githubPull, hasPullFields, isFullSha, isOwnPull } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, lastPushedCheckpoint } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { pauseTeamAutonomy } from './github-autonomy-brake.js';
import { upsertMessage } from './machine-deps.js';
import { assertMergeRequiredChecks } from './merge-required-checks.js';
import { sendMustReachAlert } from './push-alerts.js';

const INSTRUCTION_PREFIX = 'Ship gate verdict: ';
const instructionSchema = z
  .object({ buildId: z.string().min(1), judgedHead: z.string().min(1) })
  .strict();
export type ShipGateInstruction = z.infer<typeof instructionSchema>;

export const CUSTOM_NEEDS_PR =
  'the custom ship route needs a GitHub pull request so the landing can be verified; local projects use local-merge';

export function appendShipGateInstruction(
  prompt: string,
  instruction: ShipGateInstruction,
): string {
  const pin = `The user explicitly requested this merge. Merge only the delivered commit ${instruction.judgedHead}. Push nothing to the pull request first. With gh, pass --match-head-commit ${instruction.judgedHead} to gh pr merge, or send sha=${instruction.judgedHead} to the merge API. If the head differs, stop and report instead of merging.`;
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

async function refusalOf(
  deps: BuildDeps,
  buildId: string,
): Promise<{ reason: string } | { headSha: string }> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!buildRow || !todoRow) return { reason: 'build or task missing' };
  if (
    todoRow.latestBuildId !== buildId ||
    todoRow.archivedAt !== null ||
    !['done', 'review', 'failed'].includes(todoRow.phase)
  )
    return { reason: 'the current delivery is no longer eligible for merging' };
  const projectRow = projectOfTodo(deps.db, todoRow);
  const repo = githubRepoOfProject(projectRow);
  if (repo === null || buildRow.prNumber === null) return { reason: CUSTOM_NEEDS_PR };
  const token = await githubReadToken(deps, todoRow.teamId, repo);
  if (token === null) return { reason: 'Connect GitHub before requesting a merge' };
  const fetchImpl = deps.githubFetch ?? fetch;
  const page = await githubPull(fetchImpl, token, repo.owner, repo.repo, buildRow.prNumber);
  const pull = page?.pull;
  const head = lastPushedCheckpoint(deps, buildId, { mergeSteps: false });
  if (!pull || !hasPullFields(pull) || !isOwnPull(pull, conversationBranch(buildId)))
    return { reason: 'Cannot read the pull request belonging to this delivery' };
  if (head === null || !isFullSha(head) || pull.headSha !== head)
    return { reason: 'The pull request head differs from the delivered commit' };
  if (pull.state !== 'open' || pull.merged)
    return { reason: 'The pull request is already closed or merged' };
  if (pull.baseRef !== (projectRow?.baseBranch ?? pull.defaultBranch))
    return { reason: 'The pull request target differs from the project base' };
  await assertMergeRequiredChecks(fetchImpl, token, repo, pull.baseRef, head);
  const current = deps.db.select().from(todo).where(eq(todo.id, todoRow.id)).get();
  if (
    current?.latestBuildId !== buildId ||
    current.archivedAt !== null ||
    !['done', 'review', 'failed'].includes(current.phase) ||
    current.projectId !== todoRow.projectId
  )
    return { reason: 'The delivery changed while checking the merge target' };
  const currentProject = projectOfTodo(deps.db, current);
  if (
    currentProject?.repoKind !== projectRow?.repoKind ||
    currentProject?.githubRepo !== projectRow?.githubRepo ||
    currentProject?.baseBranch !== projectRow?.baseBranch ||
    lastPushedCheckpoint(deps, buildId, { mergeSteps: false }) !== head
  )
    return { reason: 'The delivery or merge target changed while checking the merge target' };
  return { headSha: head };
}

export async function judgeShip(deps: BuildDeps, buildId: string): Promise<{ headSha: string }> {
  const outcome = await refusalOf(deps, buildId);
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
  const outcome = await refusalOf(deps, stepRow.buildId).catch((err: unknown) => ({
    reason: `Cannot verify the merge target: ${String(err)}`,
  }));
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
  await pauseTeamAutonomy(deps, teamId, {
    source: 'unjudged-landing',
    reason: `Unjudged landing: ${reason}`,
    requestKey: `unjudged-landing:${stepRow.id}`,
  }).catch(() => undefined);
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
  const token = await githubReadToken(deps, todoRow.teamId, repo);
  if (token === null) {
    return { kind: 'unverifiable', reason: 'cannot verify the landing: no GitHub connection' };
  }
  const page = await githubPull(
    deps.githubFetch ?? fetch,
    token,
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
