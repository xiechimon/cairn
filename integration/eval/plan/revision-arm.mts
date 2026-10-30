import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { and, asc, eq } from 'drizzle-orm';
import {
  build as buildTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../../../apps/server/src/db/schema.js';
import { repoDirFor } from '../../../apps/server/src/services/git.js';
import { api, waitFor } from '../../test/helpers.js';
import type { SeededWorld, Stack } from '../chief-dispatch/stack.mts';

const PLAN_FILE_NAME = 'plan.md';

export interface RevisionArms {
  priorPlan: string;
  feedback: string;
}

export interface HarnessError extends Error {
  failure_class: 'harness_error';
}

function harnessError(reason: string): HarnessError {
  const error = new Error(reason) as HarnessError;
  error.failure_class = 'harness_error';
  return error;
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw harnessError(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function teamRepoPath(stack: Stack, projectId: string): string {
  const row = stack.server.db
    .select({ repoName: projectTable.repoName })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .get();
  if (!row?.repoName) throw harnessError(`project ${projectId} has no repoName`);
  return repoDirFor(stack.server.reposDir, stack.server.teamId, row.repoName);
}

export function planFileAt(repo: string, ref: string): string | null {
  const exists = spawnSync('git', ['cat-file', '-e', `${ref}:${PLAN_FILE_NAME}`], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (exists.status !== 0) return null;
  return git(repo, ['show', `${ref}:${PLAN_FILE_NAME}`]);
}

function usageOf(
  stack: Stack,
  buildId: string,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  return stack.server.db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.buildId, buildId))
    .all()
    .reduce(
      (acc, row) => ({
        input: acc.input + row.input,
        output: acc.output + row.output,
        cacheRead: acc.cacheRead + row.cacheRead,
        cacheWrite: acc.cacheWrite + row.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
}

export function planVersions(stack: Stack, buildId: string): number[] {
  return stack.server.db
    .select({ version: planTable.version })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(asc(planTable.version))
    .all()
    .map((row) => row.version);
}

export function latestPlanContent(stack: Stack, buildId: string): string | null {
  const rows = stack.server.db
    .select({ content: planTable.content })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(asc(planTable.version))
    .all();
  return rows.at(-1)?.content ?? null;
}

export interface RevisionStageRecord {
  planVersions: number[];
  planContent: string | null;
  branchPlan: string | null;
  stepStatus: string;
  prompt: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  wallMs: number;
}

export interface PlanRevisionArmResult {
  rejection: {
    phase: string;
    priorPlanVersion: number;
    stepStatus: string;
  };
  revision: RevisionStageRecord;
}

export interface DriveRevisionTurnOptions {
  projectId: string;
  buildId: string;
  arms: RevisionArms;
  timeoutMs?: number;
  withholdFeedback?: boolean;
}

function newPlanRowId(buildId: string, version: number): string {
  const hex = Buffer.from(`${buildId}:${version}`).toString('hex').slice(0, 24).padEnd(24, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32).padEnd(12, '0').slice(0, 12)}`;
}

export async function createPlanningBuild(
  stack: Stack,
  world: Pick<SeededWorld, 'projectId' | 'agentIds'>,
  todo: { title: string; spec: string },
): Promise<{ buildId: string; todoId: string }> {
  const agentId = Object.values(world.agentIds)[0];
  if (agentId === undefined) throw harnessError('the roster has no agent to assign the build to');
  const created = await api(stack.server.url, 'POST', `/api/projects/${world.projectId}/todos`, {
    ...todo,
  });
  if (created.status !== 201)
    throw harnessError(`create todo failed: ${created.status} ${JSON.stringify(created.body)}`);
  const todoId = (created.body as { id: string }).id;
  const started = await api(stack.server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  if (started.status !== 201)
    throw harnessError(`start build failed: ${started.status} ${JSON.stringify(started.body)}`);
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]?.id;
  if (buildId === undefined) throw harnessError('start build returned no build id');
  return { buildId, todoId };
}

export async function seedPriorPlan(
  stack: Stack,
  input: { projectId: string; buildId: string; priorPlan: string },
): Promise<void> {
  const db = stack.server.db;
  const buildRow = db.select().from(buildTable).where(eq(buildTable.id, input.buildId)).get();
  if (buildRow === undefined) throw harnessError(`build ${input.buildId} missing`);
  const todoRow = db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (todoRow === undefined) throw harnessError(`todo ${buildRow.todoId} missing`);
  const planStep = db
    .select()
    .from(stepTable)
    .where(and(eq(stepTable.buildId, input.buildId), eq(stepTable.kind, 'plan')))
    .get();
  if (planStep === undefined) throw harnessError(`build ${input.buildId} has no plan step`);

  const branch = conversationBranch(input.buildId);
  const bare = teamRepoPath(stack, input.projectId);
  const work = mkdtempSync(join(tmpdir(), 'cairn-plan-seed-'));
  try {
    git(work, ['clone', bare, '.']);
    git(work, ['checkout', '-B', branch, 'origin/main']);
    writeFileSync(join(work, PLAN_FILE_NAME), input.priorPlan);
    git(work, ['add', PLAN_FILE_NAME]);
    git(work, [
      '-c',
      'user.email=eval@cairn.local',
      '-c',
      'user.name=eval',
      'commit',
      '-m',
      `plan: ${todoRow.title}`,
    ]);
    git(work, ['push', 'origin', `${branch}:${branch}`]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const planId = newPlanRowId(input.buildId, 1);
  db.delete(planTable).where(eq(planTable.buildId, input.buildId)).run();
  db.insert(planTable)
    .values({
      id: planId,
      buildId: input.buildId,
      version: 1,
      content: input.priorPlan,
      stepId: planStep.id,
      createdAt: Date.now(),
    })
    .run();
  db.update(buildTable).set({ planDocId: planId }).where(eq(buildTable.id, input.buildId)).run();
  db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, todoRow.id)).run();
}

export async function driveRevisionTurn(
  stack: Stack,
  opts: DriveRevisionTurnOptions,
): Promise<PlanRevisionArmResult> {
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const db = stack.server.db;
  const buildRow = db.select().from(buildTable).where(eq(buildTable.id, opts.buildId)).get();
  if (buildRow === undefined) throw harnessError(`build ${opts.buildId} missing`);
  const todoRow = db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (todoRow === undefined) throw harnessError(`todo ${buildRow.todoId} missing`);
  const priorPlanVersion = planVersions(stack, opts.buildId).at(-1) ?? 0;
  if (priorPlanVersion === 0) throw harnessError(`build ${opts.buildId} has no prior plan`);

  const beforeSteps = new Set(
    db
      .select({ id: stepTable.id })
      .from(stepTable)
      .where(eq(stepTable.buildId, opts.buildId))
      .all()
      .map((row) => row.id),
  );
  const beforeUsage = usageOf(stack, opts.buildId);
  const t0 = Date.now();
  const sent = await api(stack.server.url, 'POST', `/api/builds/${opts.buildId}/steps`, {
    action: 'revision',
    side: 'plan',
    feedback: opts.withholdFeedback === true ? '' : opts.arms.feedback,
    clientMessageId: `${opts.buildId}-revision`,
  });
  if (sent.status !== 202) {
    throw harnessError(`revision not enqueued: ${sent.status} ${JSON.stringify(sent.body)}`);
  }

  await waitFor(() => {
    const rows = db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, opts.buildId))
      .all()
      .filter((row) => !beforeSteps.has(row.id));
    const settled = rows.some((row) => row.status === 'done' || row.status === 'failed');
    const pending = rows.some(
      (row) =>
        row.status === 'pending' || row.status === 'claimed' || row.status === 'waiting_quota',
    );
    return settled && !pending;
  }, timeoutMs);

  const revisionStep = db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, opts.buildId))
    .all()
    .filter((row) => !beforeSteps.has(row.id))
    .at(-1);
  if (revisionStep === undefined) throw harnessError('no revision step ran');
  const rejectionStep = db
    .select()
    .from(stepTable)
    .where(and(eq(stepTable.buildId, opts.buildId), eq(stepTable.kind, 'plan')))
    .all()
    .filter((row) => beforeSteps.has(row.id))
    .at(-1);
  const repo = teamRepoPath(stack, opts.projectId);
  const afterUsage = usageOf(stack, opts.buildId);
  return {
    rejection: {
      phase: todoRow.phase,
      priorPlanVersion,
      stepStatus: rejectionStep?.status ?? 'missing',
    },
    revision: {
      planVersions: planVersions(stack, opts.buildId),
      planContent: latestPlanContent(stack, opts.buildId),
      branchPlan: planFileAt(repo, conversationBranch(opts.buildId)),
      stepStatus: revisionStep.status,
      prompt: revisionStep.prompt,
      usage: {
        input: afterUsage.input - beforeUsage.input,
        output: afterUsage.output - beforeUsage.output,
        cacheRead: afterUsage.cacheRead - beforeUsage.cacheRead,
        cacheWrite: afterUsage.cacheWrite - beforeUsage.cacheWrite,
      },
      wallMs: Date.now() - t0,
    },
  };
}
