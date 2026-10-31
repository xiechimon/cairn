import type { MergeBlockerCode, MergeReadiness } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { build, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { nowMs } from '../lib/ids.js';
import { autonomousMergePolicy } from './autonomous-merge.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { localGateFacts } from './local-merge-facts.js';
import { evaluateMergeGate } from './merge-gate-run.js';

const INSTRUCTION_PREFIX = 'Ship gate verdict: ';
const instructionSchema = z
  .object({ buildId: z.string().min(1), judgedHead: z.string().min(1) })
  .strict();
export type ShipGateInstruction = z.infer<typeof instructionSchema>;

const USER_APPROVAL_BLOCKERS: readonly MergeBlockerCode[] = ['policy-human'];
const OWN_STEP_BLOCKERS: readonly MergeBlockerCode[] = [
  ...USER_APPROVAL_BLOCKERS,
  'work-in-flight',
];

export function appendShipGateInstruction(
  prompt: string,
  instruction: ShipGateInstruction,
): string {
  return `${prompt}\n${INSTRUCTION_PREFIX}${JSON.stringify(instruction)}`;
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
  const outcome = await refusalOf(deps, stepRow.buildId, OWN_STEP_BLOCKERS).catch(
    (err: unknown) => ({ reason: `merge gate could not be evaluated: ${String(err)}` }),
  );
  if ('reason' in outcome) return outcome.reason;
  return outcome.headSha === instruction.judgedHead
    ? null
    : `head moved from ${instruction.judgedHead.slice(0, 7)} to ${outcome.headSha.slice(0, 7)} after the gate verdict`;
}
