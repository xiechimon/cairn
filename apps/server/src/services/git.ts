import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  conversationBranch,
  type DiffFileContent,
  type DocumentDiffFile,
  type GithubRepoRef,
  gitHostedRepoPath,
  normalizedRepoRef,
  type ProjectBranchesResponse,
  type ProjectFileResponse,
  type ProjectFilesResponse,
  type ProjectRecord,
  parseGithubRepoRef,
  projectMergeConfigSchema,
  type SecretBox,
} from '@cairn/shared';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { parsePatch } from 'diff';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build as buildTable,
  hostedCleanupOutbox,
  project,
  todo as todoTable,
} from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { isSafeRepoPath, lsFilesRecursive, runGit, systemGitOps } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { githubBranches } from '../lib/github-branches.js';
import { githubReadToken } from './github-autonomous-token.js';

export type ProjectRow = typeof project.$inferSelect;

export interface RepoCtx {
  db: Db;
  reposDir: string;
  workspacesDir?: string | undefined;
}

export function slugifyRepoName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^[-.]+|[-.]+$/g, '');
  return slug === '' ? 'repo' : slug;
}

export async function uniqueRepoName(ctx: RepoCtx, teamId: string, base: string): Promise<string> {
  const existing = new Set(
    ctx.db
      .select({ repoName: project.repoName })
      .from(project)
      .where(eq(project.teamId, teamId))
      .all()
      .map((r) => r.repoName)
      .filter((v): v is string => v !== null),
  );
  for (const row of ctx.db
    .select({ repoName: hostedCleanupOutbox.repoName })
    .from(hostedCleanupOutbox)
    .where(and(eq(hostedCleanupOutbox.teamId, teamId), ne(hostedCleanupOutbox.state, 'done')))
    .all()) {
    existing.add(row.repoName);
  }
  let candidate = base;
  for (let i = 2; existing.has(candidate); i++) {
    candidate = `${base}-${i}`;
  }
  return candidate;
}

export function repoDirFor(reposDir: string, teamId: string, repoName: string): string {
  return join(reposDir, teamId, `${repoName}.git`);
}

export async function provisionHostedRepo(
  ctx: RepoCtx,
  teamId: string,
  repoName: string,
): Promise<string> {
  const dir = repoDirFor(ctx.reposDir, teamId, repoName);
  mkdirSync(join(ctx.reposDir, teamId), { recursive: true });
  await systemGitOps.initBareRepo(dir);
  await systemGitOps.seedInitialCommit(dir, `init ${repoName}`);
  return dir;
}

export function removeHostedRepoDir(reposDir: string, teamId: string, repoName: string): void {
  rmSync(repoDirFor(reposDir, teamId, repoName), { recursive: true, force: true });
}

export function projectOfTodo(
  db: Db,
  todoRow: { projectId: string; teamId: string },
): ProjectRow | undefined {
  return db
    .select()
    .from(project)
    .where(and(eq(project.id, todoRow.projectId), eq(project.teamId, todoRow.teamId)))
    .get();
}

export function hostedCloneUrl(origin: string, teamId: string, repoName: string): string {
  return `${origin}/git${gitHostedRepoPath(teamId, repoName)}`;
}

export function hasRepoBinding(row: ProjectRow | undefined): boolean {
  return projectRepoRef(row, '') !== null;
}

export function projectRepoRef(
  row: ProjectRow | undefined,
  origin: string,
): {
  kind: 'hosted' | 'github' | 'local';
  cloneUrl: string;
  localPath?: string;
  baseBranch?: string;
} | null {
  const base = row?.baseBranch != null ? { baseBranch: row.baseBranch } : {};
  if (row?.repoKind === 'hosted' && row.repoName !== null) {
    return { kind: 'hosted', cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName), ...base };
  }
  const githubRef = githubRepoOfProject(row);
  if (githubRef !== null) {
    return {
      kind: 'github',
      ...base,
      cloneUrl: githubCloneUrl(githubRef),
      ...(row?.localPath != null ? { localPath: row.localPath } : {}),
    };
  }
  if (row?.repoKind === 'local' && row.localPath !== null) {
    return { kind: 'local', cloneUrl: row.localPath, ...base };
  }
  return null;
}

export function githubRepoOfProject(
  row: Pick<ProjectRow, 'repoKind' | 'githubRepo'> | undefined,
): GithubRepoRef | null {
  if (row?.repoKind !== 'github' || row.githubRepo === null) return null;
  return parseGithubRepoRef(row.githubRepo);
}

export function githubCloneUrl(ref: GithubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

export function expandHomePath(rawPath: string, homeDir: string = homedir()): string {
  if (rawPath === '~') return homeDir;
  if (rawPath.startsWith('~/')) return join(homeDir, rawPath.slice(2));
  return rawPath;
}

export async function validateLocalRepoPath(rawPath: string | null | undefined): Promise<string> {
  const raw = rawPath?.trim() ?? '';
  if (raw === '') {
    throw new HttpError(400, 'invalid body at localPath: required for kind "local"');
  }
  const expanded = expandHomePath(raw);
  if (!isAbsolute(expanded)) {
    throw new HttpError(
      400,
      `invalid body at localPath: expected absolute path, got "${raw}"`,
      'not_absolute',
    );
  }
  return expanded;
}

export function validateGithubLocalSlotPath(rawPath: string | null | undefined): string | null {
  const raw = rawPath?.trim() ?? '';
  if (raw === '') return null;
  if (!isAbsolute(raw)) {
    throw new HttpError(
      400,
      `invalid body at localPath: expected absolute path, got "${raw}"`,
      'not_absolute',
    );
  }
  return raw;
}

export function toProjectRecord(row: ProjectRow, origin?: string): ProjectRecord {
  const githubRef = githubRepoOfProject(row);
  return {
    id: row.id,
    name: row.name,
    group: row.group,
    teamId: row.teamId,
    splitPolicy: row.splitPolicy,
    evidenceStore: row.evidenceStore,
    baseBranch: row.baseBranch,
    ...(row.icon !== null ? { icon: row.icon } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
    archivedAt: row.archivedAt,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.instructions !== null ? { instructions: row.instructions } : {}),
    ...(row.maxConcurrent !== null ? { maxConcurrent: row.maxConcurrent } : {}),
    ...(row.repoKind !== null ? { repoKind: row.repoKind } : {}),
    ...(row.repoName !== null ? { repoName: row.repoName } : {}),
    ...(row.githubRepo !== null ? { githubRepo: row.githubRepo } : {}),
    ...(row.localPath !== null ? { localPath: row.localPath } : {}),
    ...projectMergeConfigSchema.parse({
      planAutoApproveEnabled: (row.autonomy as { planAutoApproveEnabled?: unknown } | null)
        ?.planAutoApproveEnabled,
      mergePolicy: (row.autonomy as { mergePolicy?: unknown } | null)?.mergePolicy,
      localChecks: (row.autonomy as { localChecks?: unknown } | null)?.localChecks,
      requireUpToDate: (row.autonomy as { requireUpToDate?: unknown } | null)?.requireUpToDate,
    }),
    ...(row.repoKind === 'hosted' && row.repoName !== null && origin !== undefined
      ? { cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName) }
      : {}),
    ...(githubRef !== null ? { cloneUrl: githubCloneUrl(githubRef) } : {}),
  };
}

export { isGithubRepoRef } from '@cairn/shared';

async function requireGithubRepoIdentity(dir: string, ref: GithubRepoRef): Promise<void> {
  const origin = await runGit(['config', '--local', '--get', 'remote.origin.url'], {
    cwd: dir,
    timeoutMs: 15000,
  });
  if (
    origin.code !== 0 ||
    normalizedRepoRef(origin.stdout.toString('utf8')).toLowerCase() !==
      normalizedRepoRef(githubCloneUrl(ref)).toLowerCase()
  ) {
    throw new HttpError(409, 'project repository identity mismatch');
  }
}

export async function requireRepoReadDir(ctx: RepoCtx, projectId: string): Promise<string> {
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (!row) throw notFound(`project ${projectId}`);
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    return repoDirFor(ctx.reposDir, row.teamId, row.repoName);
  }
  if (row.repoKind === 'github' && ctx.workspacesDir !== undefined) {
    const ref = githubRepoOfProject(row);
    if (ref === null) throw new HttpError(409, 'invalid GitHub repository binding');
    if (!/^[A-Za-z0-9_-]+$/.test(row.id))
      throw new HttpError(409, 'invalid project repository identity');
    const cache = join(ctx.workspacesDir, row.id, 'repo');
    if (existsSync(cache)) {
      const expected = join(realpathSync(ctx.workspacesDir), row.id, 'repo');
      if (realpathSync(cache) !== expected)
        throw new HttpError(403, 'project repository cache escapes its root');
      await requireGithubRepoIdentity(cache, ref);
      return cache;
    }
  }
  if (row.repoKind === 'github') {
    throw new HttpError(404, 'github repository cache unavailable on this server');
  }
  if (row.repoKind === 'local') {
    if (row.localPath === null) {
      throw notFound(`local repo for project ${projectId}`);
    }
    if (!existsSync(row.localPath)) {
      throw new HttpError(404, `local repo path not found: ${row.localPath}`, 'not_found');
    }
    if (!(await systemGitOps.isGitRepo(row.localPath))) {
      throw new HttpError(
        404,
        `local repo path is not a git repository: ${row.localPath}`,
        'not_git',
      );
    }
    return row.localPath;
  }
  throw notFound(`repository binding for project ${projectId}`);
}

async function resolveReadCommit(
  ctx: RepoCtx,
  projectId: string,
  dir: string,
  ref: string,
): Promise<string | null> {
  if (ctx.workspacesDir === undefined || dir !== join(ctx.workspacesDir, projectId, 'repo')) {
    return systemGitOps.resolveCommit(dir, ref);
  }
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (row?.repoKind !== 'github') return systemGitOps.resolveCommit(dir, ref);
  const binding = githubRepoOfProject(row);
  if (binding === null) throw new HttpError(409, 'project repository binding changed during read');
  const prefix = repositoryCacheRefPrefix(githubCloneUrl(binding));
  const verified = await runGit(
    ['for-each-ref', '--count=1', '--format=%(refname)', `${prefix}/`],
    { cwd: dir, timeoutMs: 15000 },
  );
  if (verified.code !== 0 || verified.stdout.toString('utf8').trim() === '') {
    throw new HttpError(
      403,
      'repository cache not verified yet; restart the daemon to run cache verification and check daemon logs if it fails',
    );
  }
  const shortName = !ref.startsWith('refs/') && ref !== 'HEAD' && !/^[0-9a-f]{40,64}$/i.test(ref);
  const candidates: string[] = [];
  if (shortName || ref.startsWith('refs/tags/')) {
    const tag = ref.replace(/^refs\/tags\//, '');
    candidates.push(`${prefix}/tags/${tag}`, `refs/tags/${tag}`);
  }
  if (shortName || ref.startsWith('refs/heads/') || ref.startsWith('refs/remotes/origin/')) {
    candidates.push(`${prefix}/heads/${ref.replace(/^refs\/(?:heads|remotes\/origin)\//, '')}`);
  }
  let commit: string | null = null;
  for (const candidate of [...candidates, ref]) {
    commit = await systemGitOps.resolveCommit(dir, candidate);
    if (commit !== null) break;
  }
  if (commit === null) return null;
  const reachable = await runGit(
    ['for-each-ref', `--contains=${commit}`, '--format=%(refname)', `${prefix}/`],
    { cwd: dir, timeoutMs: 15000 },
  );
  if (reachable.code !== 0 || reachable.stdout.toString('utf8').trim() === '') {
    throw new HttpError(403, 'commit is not reachable from the current repository verified refs');
  }
  return commit;
}

async function resolveCommitOr404(
  ctx: RepoCtx,
  projectId: string,
  dir: string,
  ref: string,
): Promise<string> {
  const commit = await resolveReadCommit(ctx, projectId, dir, ref);
  if (commit === null) throw notFound(`ref ${ref}`);
  return commit;
}

export const PROJECT_FILES_DEFAULT_LIMIT = 2000;
export const PROJECT_FILES_MAX_LIMIT = 5000;

export async function readFiles(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
  limitParam?: string,
): Promise<ProjectFilesResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(ctx, projectId, dir, ref);
  const parsed = limitParam === undefined || limitParam === '' ? NaN : Number(limitParam);
  const limit = Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), PROJECT_FILES_MAX_LIMIT)
    : PROJECT_FILES_DEFAULT_LIMIT;
  const all = await lsFilesRecursive(dir, commit);
  const files = all.slice(0, limit).map((e) => ({ path: e.path, type: e.type, size: e.size }));
  return { ref, commit, truncated: all.length > files.length, files };
}

function looksBinary(buf: Uint8Array): boolean {
  const window = buf.subarray(0, 8000);
  return window.includes(0);
}

export async function readFile(
  ctx: RepoCtx,
  projectId: string,
  path: string,
  refParam?: string,
  options: { defaultBranch?: boolean; maxBytes?: number } = {},
): Promise<ProjectFileResponse> {
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const dir = await requireRepoReadDir(ctx, projectId);
  let ref = refParam ?? 'HEAD';
  if (ctx.workspacesDir !== undefined && dir === join(ctx.workspacesDir, projectId, 'repo')) {
    const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
    if (refParam === undefined && row?.baseBranch != null) {
      ref = `refs/remotes/origin/${row.baseBranch}`;
    } else if (refParam === undefined) {
      const head = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: dir,
        timeoutMs: 15000,
      });
      if (head.code !== 0)
        throw new HttpError(409, 'project repository cache has no default remote branch');
      ref = head.stdout.toString('utf8').trim();
    }
  }
  if (
    refParam === undefined &&
    options.defaultBranch === true &&
    !(ctx.workspacesDir !== undefined && dir === join(ctx.workspacesDir, projectId, 'repo'))
  ) {
    const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
    if (row?.baseBranch != null) {
      ref = `refs/heads/${row.baseBranch}`;
    } else if (row?.repoKind !== 'hosted') {
      const remoteHead = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: dir,
        timeoutMs: 15000,
      });
      if (remoteHead.code === 0) {
        ref = remoteHead.stdout.toString('utf8').trim();
      } else {
        throw new HttpError(
          409,
          'repository default branch is unknown; configure baseBranch or supply ref',
        );
      }
    }
  }
  const commit = await resolveCommitOr404(ctx, projectId, dir, ref);
  if (options.maxBytes !== undefined) {
    const sizeResult = await runGit(['cat-file', '-s', `${commit}:${path}`], {
      cwd: dir,
      timeoutMs: 15000,
    });
    if (sizeResult.code !== 0) throw notFound(`file ${path} at ref ${ref}`);
    const size = Number(sizeResult.stdout.toString('utf8').trim());
    if (!Number.isSafeInteger(size) || size < 0)
      throw new HttpError(409, 'invalid repository blob size');
    if (size > options.maxBytes)
      throw new HttpError(
        413,
        `repository document too large: ${size} bytes exceeds limit ${options.maxBytes}`,
      );
  }
  const file = await systemGitOps.readFileAt(dir, commit, path);
  if (file === null) throw notFound(`file ${path} at ref ${ref}`);
  const binary = looksBinary(file.content);
  return {
    ref,
    commit,
    path,
    size: file.size,
    encoding: binary ? 'base64' : 'utf-8',
    content: binary
      ? Buffer.from(file.content).toString('base64')
      : new TextDecoder().decode(file.content),
  };
}

export async function readBranches(
  ctx: RepoCtx & { box?: SecretBox; githubFetch?: FetchLike },
  projectId: string,
): Promise<ProjectBranchesResponse> {
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  const ref = githubRepoOfProject(row);
  if (row && ref) {
    const token = await githubReadToken(ctx, row.teamId, ref);
    return githubBranches(ctx.githubFetch ?? fetch, token, ref);
  }
  const dir = await requireRepoReadDir(ctx, projectId);
  return systemGitOps.listBranches(dir);
}

export function parseUnifiedDiff(text: string): DocumentDiffFile[] {
  return parsePatch(text).flatMap((patch) => {
    const name = patch.newFileName === '/dev/null' ? patch.oldFileName : patch.newFileName;
    if (name === undefined || name === '/dev/null' || patch.hunks.length === 0) return [];
    const hunks = patch.hunks.map((hunk) => ({
      header: `@@ -${hunk.oldStart - (hunk.oldLines === 0 ? 1 : 0)}${hunk.oldLines === 1 ? '' : `,${hunk.oldLines}`} +${hunk.newStart - (hunk.newLines === 0 ? 1 : 0)}${hunk.newLines === 1 ? '' : `,${hunk.newLines}`} @@`,
      lines: hunk.lines.filter((line) => !line.startsWith('\\')),
    }));
    const lines = hunks.flatMap((hunk) => hunk.lines);
    return [
      {
        path: name.replace(/^[ab]\//, ''),
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        hunks,
      },
    ];
  });
}

export function diffTextNamesAFile(text: string): boolean {
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) return true;
  }
  return false;
}

export async function readBuildChanges(
  ctx: RepoCtx,
  buildId: string,
): Promise<{ files: DocumentDiffFile[]; reported: boolean; changed?: boolean }> {
  const buildRow = ctx.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
  if (!buildRow) throw notFound(`build ${buildId}`);
  const todoRow = ctx.db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
  const projRow = projectOfTodo(ctx.db, todoRow);
  if (projRow?.repoKind !== 'hosted' || projRow.repoName === null) {
    const stored = buildRow.changes;
    if (stored == null) return { files: [], reported: false };
    if (Array.isArray(stored)) {
      return { files: stored, reported: true, changed: stored.length > 0 };
    }
    return { files: stored.files, reported: true, changed: true };
  }
  const dir = repoDirFor(ctx.reposDir, projRow.teamId, projRow.repoName);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const base = projRow.baseBranch ?? defaultBranch ?? 'main';
  const baseSha = await systemGitOps.resolveCommit(dir, `refs/heads/${base}`);
  const headSha = await systemGitOps.resolveCommit(
    dir,
    `refs/heads/${conversationBranch(buildId)}`,
  );
  if (baseSha === null || headSha === null) return { files: [], reported: false };
  const r = await runGit(['diff', `${baseSha}...${headSha}`], { cwd: dir, timeoutMs: 30_000 });
  if (r.code !== 0) return { files: [], reported: false };
  const text = r.stdout.toString('utf8');
  return { files: parseUnifiedDiff(text), reported: true, changed: diffTextNamesAFile(text) };
}

const DIFF_FILE_MAX_BYTES = 1024 * 1024;

export async function readBuildChangeFile(
  ctx: RepoCtx,
  buildId: string,
  path: string,
): Promise<DiffFileContent> {
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const buildRow = ctx.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
  if (!buildRow) throw notFound(`build ${buildId}`);
  const todoRow = ctx.db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
  const projRow = projectOfTodo(ctx.db, todoRow);
  if (projRow?.repoKind !== 'hosted' || projRow.repoName === null) {
    throw notFound(`hosted repo for build ${buildId}`);
  }
  const dir = repoDirFor(ctx.reposDir, projRow.teamId, projRow.repoName);
  const ref = conversationBranch(buildId);
  const commit = await systemGitOps.resolveCommit(dir, `refs/heads/${ref}`);
  if (commit === null) throw notFound(`ref ${ref}`);
  const sizeRes = await runGit(['cat-file', '-s', `${commit}:${path}`], {
    cwd: dir,
    timeoutMs: 15_000,
  });
  if (sizeRes.code !== 0) throw notFound(`file ${path} at ref ${ref}`);
  const size = Number.parseInt(sizeRes.stdout.toString('utf8').trim(), 10);
  if (size > DIFF_FILE_MAX_BYTES) {
    throw new HttpError(413, `file ${path} too large: ${size} > ${DIFF_FILE_MAX_BYTES} bytes`);
  }
  const file = await systemGitOps.readFileAt(dir, commit, path);
  if (file === null) throw notFound(`file ${path} at ref ${ref}`);
  const binary = looksBinary(file.content);
  return {
    ref,
    commit,
    path,
    size: file.size,
    encoding: binary ? 'base64' : 'utf-8',
    content: binary
      ? Buffer.from(file.content).toString('base64')
      : new TextDecoder().decode(file.content),
  };
}
