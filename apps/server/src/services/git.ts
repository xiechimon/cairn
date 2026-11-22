import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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
import { isSafeRepoPath, looksBinary, lsFilesRecursive, runGit, systemGitOps } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { githubBranches } from '../lib/github-branches.js';
import {
  type GithubRepoRead,
  listGithubProjectFiles,
  readGithubProjectFile,
} from '../lib/github-repo-files.js';
import { githubReadToken } from './github-autonomous-token.js';

export type ProjectRow = typeof project.$inferSelect;

export interface RepoCtx {
  db: Db;
  reposDir: string;
  workspacesDir?: string | undefined;
}

export interface RepoReadCtx extends RepoCtx {
  box?: SecretBox | undefined;
  githubFetch?: FetchLike | undefined;
  githubAppTokenSocket?: string | null | undefined;
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
  const taken = (name: string) =>
    existing.has(name) || existsSync(repoDirFor(ctx.reposDir, teamId, name));
  let candidate = base;
  for (let i = 2; taken(candidate); i++) {
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
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new HttpError(409, `repository ${repoName} already exists; try again`, 'repo-exists');
    }
    throw error;
  }
  try {
    await systemGitOps.initBareRepo(dir);
    await systemGitOps.seedInitialCommit(dir, `init ${repoName}`);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
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
    ...(row.modelOverrides !== null ? { modelOverrides: row.modelOverrides } : {}),
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
      localChecks: (row.autonomy as { localChecks?: unknown } | null)?.localChecks,
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

interface CheckoutProvenance {
  heads: Map<string, string>;
  tags: Map<string, string>;
  forMerge: string | null;
  tips: string[];
}

function parseFetchHeadProvenance(text: string, originUrl: string): CheckoutProvenance {
  const heads = new Map<string, string>();
  const tags = new Map<string, string>();
  const tips = new Set<string>();
  let forMerge: string | null = null;
  const want = normalizedRepoRef(originUrl).toLowerCase();
  for (const line of text.split('\n')) {
    const record = /^([0-9a-f]{40,64})\t(not-for-merge)?\t(.+)$/.exec(line);
    if (record === null) continue;
    const sha = record[1];
    const desc = record[3];
    if (sha === undefined || desc === undefined) continue;
    const fetched = /^(?:(branch|tag|head) )?'?([^'\n]+)'? of (.+)$/.exec(desc);
    if (fetched === null) continue;
    const kind = fetched[1];
    const name = fetched[2];
    const url = fetched[3];
    if (name === undefined || url === undefined) continue;
    if (normalizedRepoRef(url).toLowerCase() !== want) continue;
    tips.add(sha);
    if (record[2] === undefined) forMerge = sha;
    if (kind === 'branch') heads.set(name, sha);
    else if (kind === 'tag') tags.set(name, sha);
  }
  return { heads, tags, forMerge, tips: [...tips] };
}

async function checkoutProvenance(
  dir: string,
  ref: GithubRepoRef,
): Promise<CheckoutProvenance | null> {
  try {
    await requireGithubRepoIdentity(dir, ref);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return null;
    throw error;
  }
  const effective = await runGit(['ls-remote', '--get-url', 'origin'], {
    cwd: dir,
    timeoutMs: 15000,
  });
  const origin = effective.stdout.toString('utf8').trim();
  if (effective.code !== 0 || origin === '') return null;
  const gitPath = await runGit(['rev-parse', '--git-path', 'FETCH_HEAD'], {
    cwd: dir,
    timeoutMs: 15000,
  });
  if (gitPath.code !== 0) return null;
  const file = gitPath.stdout.toString('utf8').trim();
  let text: string;
  try {
    text = readFileSync(isAbsolute(file) ? file : join(dir, file), 'utf8');
  } catch {
    return null;
  }
  const proof = parseFetchHeadProvenance(text, origin);
  return proof.tips.length === 0 ? null : proof;
}

function projectRowOf(ctx: RepoCtx, projectId: string): ProjectRow {
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (!row) throw notFound(`project ${projectId}`);
  return row;
}

async function githubRepoCacheDir(ctx: RepoCtx, row: ProjectRow): Promise<string | null> {
  if (ctx.workspacesDir === undefined) return null;
  const ref = githubRepoOfProject(row);
  if (ref === null) throw new HttpError(409, 'invalid GitHub repository binding');
  if (!/^[A-Za-z0-9_-]+$/.test(row.id))
    throw new HttpError(409, 'invalid project repository identity');
  const cache = join(ctx.workspacesDir, row.id, 'repo');
  if (!existsSync(cache)) return null;
  const expected = join(realpathSync(ctx.workspacesDir), row.id, 'repo');
  if (realpathSync(cache) !== expected)
    throw new HttpError(403, 'project repository cache escapes its root');
  await requireGithubRepoIdentity(cache, ref);
  return cache;
}

async function githubRepoReader(ctx: RepoReadCtx, row: ProjectRow): Promise<GithubRepoRead> {
  const repository = githubRepoOfProject(row);
  if (repository === null) throw new HttpError(409, 'invalid GitHub repository binding');
  const token = await githubReadToken(
    {
      db: ctx.db,
      box: ctx.box,
      githubFetch: ctx.githubFetch,
      githubAppTokenSocket: ctx.githubAppTokenSocket,
    },
    row.teamId,
    repository,
  );
  return { fetchImpl: ctx.githubFetch ?? fetch, token, repository };
}

export async function requireRepoReadDir(ctx: RepoCtx, projectId: string): Promise<string> {
  const row = projectRowOf(ctx, projectId);
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    return repoDirFor(ctx.reposDir, row.teamId, row.repoName);
  }
  if (row.repoKind === 'github') {
    const cache = await githubRepoCacheDir(ctx, row);
    if (cache !== null) return cache;
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

type RepoReadDir =
  | { dir: string; kind: 'dir' }
  | { dir: string; kind: 'cache' }
  | { dir: string; kind: 'checkout'; proof: CheckoutProvenance; binding: GithubRepoRef };

async function* githubReadDirs(ctx: RepoCtx, row: ProjectRow): AsyncGenerator<RepoReadDir> {
  const binding = githubRepoOfProject(row);
  if (binding === null) throw new HttpError(409, 'invalid GitHub repository binding');
  if (
    row.localPath !== null &&
    existsSync(row.localPath) &&
    (await systemGitOps.isGitRepo(row.localPath))
  ) {
    const proof = await checkoutProvenance(row.localPath, binding);
    if (proof !== null) yield { dir: row.localPath, kind: 'checkout', proof, binding };
  }
  const cache = await githubRepoCacheDir(ctx, row);
  if (cache !== null) yield { dir: cache, kind: 'cache' };
}

async function provenCommit(
  dir: string,
  proof: CheckoutProvenance,
  commit: string,
): Promise<boolean> {
  for (const tip of proof.tips) {
    if (await systemGitOps.isAncestor(dir, commit, tip)) return true;
  }
  return false;
}

async function resolveCheckoutCommit(
  dir: string,
  proof: CheckoutProvenance,
  ref: string,
): Promise<string | null> {
  const shortName = !ref.startsWith('refs/') && ref !== 'HEAD' && !/^[0-9a-f]{40,64}$/i.test(ref);
  const candidates: string[] = [];
  if (ref === 'HEAD' && proof.forMerge !== null) candidates.push(proof.forMerge);
  if (shortName || ref.startsWith('refs/tags/')) {
    const tag = ref.replace(/^refs\/tags\//, '');
    const proven = proof.tags.get(tag);
    if (proven !== undefined) candidates.push(proven);
    candidates.push(`refs/tags/${tag}`);
  }
  if (shortName) {
    const proven = proof.heads.get(ref);
    if (proven !== undefined) candidates.push(proven);
    candidates.push(`refs/remotes/origin/${ref}`);
  }
  if (ref.startsWith('refs/heads/') || ref.startsWith('refs/remotes/origin/')) {
    const name = ref.replace(/^refs\/(?:heads|remotes\/origin)\//, '');
    const proven = proof.heads.get(name);
    if (proven !== undefined) candidates.push(proven);
  }
  candidates.push(ref);
  for (const candidate of candidates) {
    const commit = await systemGitOps.resolveCommit(dir, candidate);
    if (commit !== null && (await provenCommit(dir, proof, commit))) return commit;
  }
  return null;
}

async function resolveReadCommit(
  ctx: RepoCtx,
  projectId: string,
  source: RepoReadDir,
  ref: string,
): Promise<string | null> {
  if (source.kind === 'dir') return systemGitOps.resolveCommit(source.dir, ref);
  if (source.kind === 'checkout') {
    const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
    const binding = githubRepoOfProject(row);
    if (
      binding === null ||
      binding.owner !== source.binding.owner ||
      binding.repo !== source.binding.repo
    ) {
      return null;
    }
    return resolveCheckoutCommit(source.dir, source.proof, ref);
  }
  const dir = source.dir;
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
  source: RepoReadDir,
  ref: string,
): Promise<string> {
  const commit = await resolveReadCommit(ctx, projectId, source, ref);
  if (commit === null) throw notFound(`ref ${ref}`);
  return commit;
}

async function remoteDefaultRef(dir: string, message: string): Promise<string> {
  const head = await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
    cwd: dir,
    timeoutMs: 15000,
  });
  const target = head.stdout.toString('utf8').trim();
  if (head.code !== 0 || target === '') throw new HttpError(409, message);
  if ((await systemGitOps.resolveCommit(dir, target)) === null) throw new HttpError(409, message);
  return target;
}

export const PROJECT_FILES_DEFAULT_LIMIT = 2000;
export const PROJECT_FILES_MAX_LIMIT = 5000;

function filesLimit(limitParam: string | undefined): number {
  const parsed = limitParam === undefined || limitParam === '' ? NaN : Number(limitParam);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), PROJECT_FILES_MAX_LIMIT)
    : PROJECT_FILES_DEFAULT_LIMIT;
}

export async function readFiles(
  ctx: RepoReadCtx,
  projectId: string,
  refParam?: string,
  limitParam?: string,
): Promise<ProjectFilesResponse> {
  const row = projectRowOf(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const limit = filesLimit(limitParam);
  if (row.repoKind === 'github') {
    for await (const source of githubReadDirs(ctx, row)) {
      const commit = await resolveReadCommit(ctx, projectId, source, ref);
      if (commit === null) {
        if (source.kind === 'checkout') continue;
        throw notFound(`ref ${ref}`);
      }
      const all = await lsFilesRecursive(source.dir, commit);
      const files = all.slice(0, limit).map((e) => ({ path: e.path, type: e.type, size: e.size }));
      return { ref, commit, truncated: all.length > files.length, files };
    }
    return listGithubProjectFiles(await githubRepoReader(ctx, row), refParam, limit);
  }
  const dir = await requireRepoReadDir(ctx, projectId);
  const commit = await resolveCommitOr404(ctx, projectId, { dir, kind: 'dir' }, ref);
  const all = await lsFilesRecursive(dir, commit);
  const files = all.slice(0, limit).map((e) => ({ path: e.path, type: e.type, size: e.size }));
  return { ref, commit, truncated: all.length > files.length, files };
}

async function readCommittedFile(
  dir: string,
  commit: string,
  path: string,
  ref: string,
  options: { maxBytes?: number },
): Promise<ProjectFileResponse> {
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

export async function readFile(
  ctx: RepoReadCtx,
  projectId: string,
  path: string,
  refParam?: string,
  options: { defaultBranch?: boolean; maxBytes?: number } = {},
): Promise<ProjectFileResponse> {
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const row = projectRowOf(ctx, projectId);
  if (row.repoKind === 'github') {
    for await (const source of githubReadDirs(ctx, row)) {
      let ref = refParam ?? 'HEAD';
      if (refParam === undefined) {
        if (row.baseBranch != null) {
          ref = `refs/remotes/origin/${row.baseBranch}`;
        } else if (source.kind === 'cache') {
          ref = await remoteDefaultRef(
            source.dir,
            'project repository cache default branch is missing; re-prepare the project to refresh it or configure baseBranch',
          );
        }
      }
      const commit = await resolveReadCommit(ctx, projectId, source, ref);
      if (commit === null) {
        if (source.kind === 'checkout') continue;
        throw notFound(`ref ${ref}`);
      }
      return readCommittedFile(source.dir, commit, path, ref, options);
    }
    return readGithubProjectFile(
      await githubRepoReader(ctx, row),
      path,
      refParam ?? row.baseBranch ?? undefined,
      options,
    );
  }
  const dir = await requireRepoReadDir(ctx, projectId);
  let ref = refParam ?? 'HEAD';
  if (refParam === undefined && options.defaultBranch === true) {
    if (row.baseBranch != null) {
      ref = `refs/heads/${row.baseBranch}`;
    } else if (row.repoKind !== 'hosted') {
      ref = await remoteDefaultRef(
        dir,
        'repository default branch is unknown; configure baseBranch or supply ref',
      );
    }
  }
  const commit = await resolveCommitOr404(ctx, projectId, { dir, kind: 'dir' }, ref);
  return readCommittedFile(dir, commit, path, ref, options);
}

export async function readBranches(
  ctx: RepoReadCtx,
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
