import { ATTACHMENT_MAX_BYTES } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey, build, project, step, todo } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import {
  blobEntryAt,
  commitTree,
  DEFAULT_HEAD_BRANCH,
  diffTreeChanges,
  fileHistory,
  type GitFileVersion,
  type GitTreeChange,
  isSafeRepoPath,
  swapBranchRef,
  systemGitOps,
  treeWithBlob,
} from '../lib/git.js';
import { stepIdOfGitKey } from './credentials.js';
import {
  provisionHostedRepo,
  type RepoCtx,
  removeHostedRepoDir,
  repoDirFor,
  slugifyRepoName,
  uniqueRepoName,
} from './git.js';

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

const SPACE_PUSH_DENIED_REFS = [`refs/heads/${DEFAULT_HEAD_BRANCH}`, 'refs/replace'];

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
  let row: ProjectRow | undefined;
  try {
    await systemGitOps.denyPushes(dir, SPACE_PUSH_DENIED_REFS);
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
    row = ctx.db.select().from(project).where(eq(project.id, id)).get();
  } finally {
    if (row?.repoName !== repoName) removeHostedRepoDir(ctx.reposDir, teamId, repoName);
  }
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

export const SPACE_MAX_FILE_BYTES = ATTACHMENT_MAX_BYTES;

const INSTRUCTION_FILES = new Set(['agents.md', 'claude.md']);
const INSTRUCTION_DIRS = new Set([
  '.git',
  '.claude',
  '.agents',
  '.cursor',
  '.github',
  '.githooks',
  '.husky',
]);
const REGULAR_FILE_MODES = new Set(['100644', '100755']);

export type SpaceRefusalReason = 'instruction' | 'not-regular' | 'too-large';

export interface SpaceRefusal {
  path: string;
  reason: SpaceRefusalReason;
}

export const SPACE_REFUSAL_TEXT: Record<SpaceRefusalReason, string> = {
  instruction: '个人空间不放会被 Agent 当成指令的文件（AGENTS.md）。规则请让我存进记忆。',
  'not-regular': '个人空间只放普通文件，不放链接或子模块。',
  'too-large': '这个文件超过 10 MB，空间里放不下。',
};

export type SpaceLanding =
  | { outcome: 'landed'; commit: string; files: string[] }
  | { outcome: 'base-moved' }
  | { outcome: 'refused'; refused: SpaceRefusal[] };

function spaceRefusalOf(
  change: Pick<GitTreeChange, 'path' | 'status' | 'mode' | 'size'>,
): SpaceRefusalReason | null {
  const segments = change.path.toLowerCase().split('/');
  if (
    INSTRUCTION_FILES.has(segments.at(-1) ?? '') ||
    segments.slice(0, -1).some((segment) => INSTRUCTION_DIRS.has(segment))
  ) {
    return 'instruction';
  }
  if (change.status === 'D') return null;
  if (!REGULAR_FILE_MODES.has(change.mode)) return 'not-regular';
  if (change.size === null || change.size > SPACE_MAX_FILE_BYTES) return 'too-large';
  return null;
}

function spaceRepoDir(ctx: RepoCtx, space: ProjectRow): string {
  if (!isPersonalSpace(space) || space.repoKind !== 'hosted' || space.repoName === null) {
    throw new Error(`project ${space.id} is not a personal space`);
  }
  return repoDirFor(ctx.reposDir, space.teamId, space.repoName);
}

export async function landSpaceCommit(
  ctx: RepoCtx,
  space: ProjectRow,
  landing: { base: string; commit: string; message: string },
): Promise<SpaceLanding> {
  const dir = spaceRepoDir(ctx, space);
  const { base, commit } = landing;
  const head = await systemGitOps.resolveCommit(dir, commit);
  if (head !== commit || !(await systemGitOps.isAncestor(dir, base, commit))) {
    throw conflict(`space landing refused: ${commit} does not descend from ${base}`);
  }
  const changes = await diffTreeChanges(dir, base, commit);
  const refused = changes.flatMap((change) => {
    const reason = spaceRefusalOf(change);
    return reason === null ? [] : [{ path: change.path, reason }];
  });
  if (refused.length > 0) return { outcome: 'refused', refused };
  const tip = await systemGitOps.resolveCommit(dir, `refs/heads/${DEFAULT_HEAD_BRANCH}`);
  if (tip !== base) return { outcome: 'base-moved' };
  if (changes.length === 0) return { outcome: 'landed', commit: base, files: [] };
  const landed = await commitTree(dir, `${commit}^{tree}`, base, landing.message);
  if (!(await swapBranchRef(dir, DEFAULT_HEAD_BRANCH, landed, base))) {
    return { outcome: 'base-moved' };
  }
  return { outcome: 'landed', commit: landed, files: changes.map((change) => change.path) };
}

export async function restoreSpaceFile(
  ctx: RepoCtx,
  space: ProjectRow,
  restore: { path: string; version: string; expectedTip: string },
): Promise<string> {
  const dir = spaceRepoDir(ctx, space);
  const { path, version, expectedTip } = restore;
  if (!isSafeRepoPath(path) || !/^[0-9a-f]{40,64}$/.test(version)) {
    throw notFound(`space file ${path}`);
  }
  const tip = await systemGitOps.resolveCommit(dir, `refs/heads/${DEFAULT_HEAD_BRANCH}`);
  if (tip === null || tip !== expectedTip) throw conflict('space changed since it was read');
  if (!(await systemGitOps.isAncestor(dir, version, tip))) {
    throw notFound(`space file ${path} at ${version}`);
  }
  const entry = await blobEntryAt(dir, version, path);
  if (entry === null || spaceRefusalOf({ path, status: 'M', ...entry }) !== null) {
    throw notFound(`space file ${path} at ${version}`);
  }
  const tree = await treeWithBlob(dir, tip, path, entry);
  const restored = await commitTree(dir, tree, tip, `restore ${path} from ${version}`);
  if (!(await swapBranchRef(dir, DEFAULT_HEAD_BRANCH, restored, tip))) {
    throw conflict('space changed since it was read');
  }
  return restored;
}

export function spaceFileHistory(
  ctx: RepoCtx,
  space: ProjectRow,
  path: string,
): Promise<GitFileVersion[]> {
  if (!isSafeRepoPath(path)) throw notFound(`space file ${path}`);
  return fileHistory(spaceRepoDir(ctx, space), DEFAULT_HEAD_BRANCH, path);
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
