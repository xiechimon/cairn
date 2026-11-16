import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey, build, project, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { DEFAULT_HEAD_BRANCH, systemGitOps } from '../lib/git.js';
import { stepIdOfGitKey } from './credentials.js';
import { provisionHostedRepo, type RepoCtx, slugifyRepoName, uniqueRepoName } from './git.js';

type ProjectRow = typeof project.$inferSelect;

export const PERSONAL_SPACE_NAME = '我的空间';

export function personalSpaceId(teamId: string, userId: string): string {
  return `space-${teamId}-${userId}`;
}

export function isPersonalSpace(row: Pick<ProjectRow, 'personalOwnerId'>): boolean {
  return row.personalOwnerId !== null;
}

export function listedProjects(teamId: string) {
  return and(eq(project.teamId, teamId), isNull(project.personalOwnerId));
}

const creating = new Map<string, Promise<ProjectRow>>();

export function ensurePersonalSpace(
  ctx: RepoCtx,
  teamId: string,
  userId: string,
): Promise<ProjectRow> {
  const id = personalSpaceId(teamId, userId);
  const inFlight = creating.get(id);
  if (inFlight !== undefined) return inFlight;
  const run = createPersonalSpace(ctx, teamId, userId, id).finally(() => creating.delete(id));
  creating.set(id, run);
  return run;
}

async function createPersonalSpace(
  ctx: RepoCtx,
  teamId: string,
  userId: string,
  id: string,
): Promise<ProjectRow> {
  const existing = ctx.db.select().from(project).where(eq(project.id, id)).get();
  if (existing !== undefined) return checkedSpace(existing, teamId, userId);
  const repoName = await uniqueRepoName(ctx, teamId, `space-${slugifyRepoName(userId)}`);
  const dir = await provisionHostedRepo(ctx, teamId, repoName);
  await systemGitOps.denyPushTo(dir, DEFAULT_HEAD_BRANCH);
  ctx.db
    .insert(project)
    .values({
      id,
      name: PERSONAL_SPACE_NAME,
      teamId,
      repoKind: 'hosted',
      repoName,
      personalOwnerId: userId,
    })
    .onConflictDoNothing({ target: project.id })
    .run();
  const row = ctx.db.select().from(project).where(eq(project.id, id)).get();
  if (row === undefined) throw new Error(`personal space ${id} missing after insert`);
  return checkedSpace(row, teamId, userId);
}

function checkedSpace(row: ProjectRow, teamId: string, userId: string): ProjectRow {
  if (
    row.teamId !== teamId ||
    row.personalOwnerId !== userId ||
    row.repoKind !== 'hosted' ||
    row.repoName === null
  ) {
    throw new HttpError(
      409,
      `personal space ${row.id} is unavailable`,
      'personal-space-unavailable',
    );
  }
  return row;
}

export function spaceGitAllowed(db: Db, space: ProjectRow, apiKeyId: string): boolean {
  const key = db.select({ name: apiKey.name }).from(apiKey).where(eq(apiKey.id, apiKeyId)).get();
  const stepId = stepIdOfGitKey(key?.name ?? null);
  if (stepId === null) return false;
  const running = db
    .select({ projectId: todo.projectId })
    .from(step)
    .innerJoin(build, eq(build.id, step.buildId))
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(and(eq(step.id, stepId), eq(step.status, 'claimed')))
    .get();
  return running?.projectId === space.id;
}
