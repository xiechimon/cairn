import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  conversationBranch,
  type DiffFileContent,
  type DocumentDiffFile,
  type GithubRepoRef,
  gitHostedRepoPath,
  type ProjectBranchesResponse,
  type ProjectCommitDetailResponse,
  type ProjectCommitsResponse,
  type ProjectFileResponse,
  type ProjectFilesResponse,
  type ProjectRecord,
  type ProjectTreeResponse,
  parseGithubRepoRef,
  projectMergeConfigSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build as buildTable, project, todo as todoTable } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { isSafeRepoPath, lsFilesRecursive, runGit, systemGitOps } from '../lib/git.js';

export type ProjectRow = typeof project.$inferSelect;

export interface RepoCtx {
  db: Db;
  reposDir: string;
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
): { kind: 'hosted' | 'github' | 'local'; cloneUrl: string; localPath?: string } | null {
  if (row?.repoKind === 'hosted' && row.repoName !== null) {
    return { kind: 'hosted', cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName) };
  }
  const githubRef = githubRepoOfProject(row);
  if (githubRef !== null) {
    return {
      kind: 'github',
      cloneUrl: githubCloneUrl(githubRef),
      ...(row?.localPath != null ? { localPath: row.localPath } : {}),
    };
  }
  if (row?.repoKind === 'local' && row.localPath !== null) {
    return { kind: 'local', cloneUrl: row.localPath };
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
    teamId: row.teamId,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.repoKind !== null ? { repoKind: row.repoKind } : {}),
    ...(row.repoName !== null ? { repoName: row.repoName } : {}),
    ...(row.githubRepo !== null ? { githubRepo: row.githubRepo } : {}),
    ...(row.localPath !== null ? { localPath: row.localPath } : {}),
    ...projectMergeConfigSchema.parse({
      mergePolicy: (row.autonomy as { mergePolicy?: unknown } | null)?.mergePolicy,
      localChecks: (row.autonomy as { localChecks?: unknown } | null)?.localChecks,
    }),
    ...(row.repoKind === 'hosted' && row.repoName !== null && origin !== undefined
      ? { cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName) }
      : {}),
    ...(githubRef !== null ? { cloneUrl: githubCloneUrl(githubRef) } : {}),
  };
}

export { isGithubRepoRef } from '@cairn/shared';

export async function requireRepoReadDir(ctx: RepoCtx, projectId: string): Promise<string> {
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (!row) throw notFound(`project ${projectId}`);
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    return repoDirFor(ctx.reposDir, row.teamId, row.repoName);
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
  throw notFound(`hosted repo for project ${projectId}`);
}

async function resolveCommitOr404(dir: string, ref: string): Promise<string> {
  const commit = await systemGitOps.resolveCommit(dir, ref);
  if (commit === null) throw notFound(`ref ${ref}`);
  return commit;
}

export async function readTree(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
  pathParam?: string,
): Promise<ProjectTreeResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(dir, ref);
  const subPath = pathParam !== undefined && pathParam !== '' ? pathParam : undefined;
  const entries = await systemGitOps.lsTree(dir, commit, subPath);
  return { ref, commit, path: subPath ?? '', entries };
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
  const commit = await resolveCommitOr404(dir, ref);
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
): Promise<ProjectFileResponse> {
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(dir, ref);
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
  ctx: RepoCtx,
  projectId: string,
): Promise<ProjectBranchesResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  return systemGitOps.listBranches(dir);
}

const COMMITS_LIMIT = 50;

export async function readCommitHistory(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
): Promise<ProjectCommitsResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const ref = refParam ?? defaultBranch ?? 'HEAD';
  const commit = await systemGitOps.resolveCommit(dir, ref);
  if (commit === null) return { ref, commits: [] };
  const r = await runGit(
    ['log', `--max-count=${COMMITS_LIMIT}`, '--format=%H%x00%h%x00%aI%x00%an%x00%s', commit],
    { cwd: dir, timeoutMs: 30_000 },
  );
  if (r.code !== 0) return { ref, commits: [] };
  const commits = r.stdout
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, shortSha, at, authorName, message] = line.split('\0');
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        message: message ?? '',
        authorName: authorName ?? '',
        at: Date.parse(at ?? '') || 0,
      };
    });
  return { ref, commits };
}

export async function readCommitDetail(
  ctx: RepoCtx,
  projectId: string,
  sha: string,
): Promise<ProjectCommitDetailResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const commit = await resolveCommitOr404(dir, sha);
  const r = await runGit(
    ['show', '--format=%H%x00%h%x00%aI%x00%an%x00%s', '--patch', '--first-parent', commit],
    { cwd: dir, timeoutMs: 30_000 },
  );
  if (r.code !== 0) throw notFound(`commit ${sha}`);
  const text = r.stdout.toString('utf8');
  const [fullSha, shortSha, at, authorName, message] = (text.split('\n')[0] ?? '').split('\0');
  if (fullSha === undefined || fullSha === '') throw notFound(`commit ${sha}`);
  return {
    sha: fullSha,
    shortSha: shortSha ?? '',
    message: message ?? '',
    authorName: authorName ?? '',
    at: Date.parse(at ?? '') || 0,
    files: parseUnifiedDiff(text),
  };
}

export function parseUnifiedDiff(text: string): DocumentDiffFile[] {
  const files: DocumentDiffFile[] = [];
  let current: DocumentDiffFile | null = null;
  let hunk: { header: string; lines: string[] } | null = null;
  const lines = text.replace(/\n$/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('diff --git ')) {
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p !== '/dev/null') current.path = p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      if (current.path === '' && p !== '/dev/null') current.path = p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: `${line.split(' @@')[0] ?? ''} @@`, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk === null) continue;
    if (line.startsWith('\\')) continue;
    if (line === '') continue;
    hunk.lines.push(line);
    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  return files.filter((f) => f.path !== '' && f.hunks.length > 0);
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
  const base = defaultBranch ?? 'main';
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
