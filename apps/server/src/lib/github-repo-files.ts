import type { GithubRepoRef, ProjectFileResponse, ProjectFilesResponse } from '@cairn/shared';
import { z } from 'zod';
import { HttpError, notFound } from './errors.js';
import { looksBinary } from './git.js';
import type { FetchLike } from './github.js';
import { githubApiBaseUrl } from './github-api-base.js';
import { githubTokenFetch } from './github-token.js';

const FETCH_TIMEOUT_MS = 15_000;

const commitSchema = z.object({ sha: z.string().min(1) });
const commitListSchema = z.array(commitSchema);
const contentsSchema = z.object({
  type: z.string(),
  size: z.number().int().nonnegative().optional(),
  sha: z.string().min(1).optional(),
  encoding: z.string().optional(),
  content: z.string().optional(),
});
const blobSchema = z.object({
  encoding: z.string(),
  content: z.string(),
  size: z.number().int().nonnegative(),
});
const treeSchema = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(
    z.object({
      path: z.string().min(1),
      type: z.string(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

export interface GithubRepoRead {
  fetchImpl: FetchLike;
  token: string | null;
  repository: GithubRepoRef;
}

function repositoryUrl(reader: GithubRepoRead, suffix: string): string {
  const { owner, repo } = reader.repository;
  return `${githubApiBaseUrl()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${suffix}`;
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function readFailure(reader: GithubRepoRead, status: number, what: string): HttpError {
  const { owner, repo } = reader.repository;
  if (status === 404) return notFound(`${what} of ${owner}/${repo}`);
  if (status === 401 || status === 403) {
    return new HttpError(
      status,
      `GitHub refused to read ${what} of ${owner}/${repo} (status ${status}); connect the project to a GitHub account or app that can read it`,
    );
  }
  return new HttpError(502, `GitHub read of ${what} of ${owner}/${repo} failed (status ${status})`);
}

async function readJson(
  reader: GithubRepoRead,
  url: string,
  what: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'cairn-server',
    ...(reader.token !== null ? { authorization: `Bearer ${reader.token}` } : {}),
  };
  let response: Awaited<ReturnType<FetchLike>>;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    response = await githubTokenFetch(reader.fetchImpl, reader.token)(url, {
      headers,
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(502, `GitHub read failed: ${url}`);
  }
  if (!response.ok) throw readFailure(reader, response.status, what);
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, `GitHub returned an unreadable response: ${url}`);
  }
}

function shortRef(ref: string): string {
  return ref
    .replace(/^refs\/remotes\/origin\//, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/tags\//, '');
}

async function resolveCommit(
  reader: GithubRepoRead,
  ref: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const noRef = ref === undefined || ref === 'HEAD';
  const what = noRef ? 'the default branch' : `ref ${ref}`;
  const url = noRef
    ? repositoryUrl(reader, 'commits?per_page=1')
    : repositoryUrl(reader, `commits/${encodeURIComponent(shortRef(ref))}`);
  const body = await readJson(reader, url, what, signal);
  if (noRef) {
    const list = commitListSchema.safeParse(body);
    const sha = list.success ? list.data[0]?.sha : undefined;
    if (sha === undefined)
      throw notFound(`${what} of ${reader.repository.owner}/${reader.repository.repo}`);
    return sha;
  }
  const commit = commitSchema.safeParse(body);
  if (!commit.success) {
    throw new HttpError(
      502,
      `GitHub returned no commit for ${what} of ${reader.repository.owner}/${reader.repository.repo}`,
    );
  }
  return commit.data.sha;
}

function toFileResponse(
  path: string,
  ref: string,
  commit: string,
  bytes: Buffer,
): ProjectFileResponse {
  const binary = looksBinary(bytes);
  return {
    ref,
    commit,
    path,
    size: bytes.byteLength,
    encoding: binary ? 'base64' : 'utf-8',
    content: binary ? bytes.toString('base64') : new TextDecoder().decode(bytes),
  };
}

async function readGithubProjectFileAtCommit(
  reader: GithubRepoRead,
  commit: string,
  path: string,
  ref: string,
  options: { maxBytes?: number; signal?: AbortSignal } = {},
): Promise<ProjectFileResponse> {
  const contents = contentsSchema.safeParse(
    await readJson(
      reader,
      repositoryUrl(reader, `contents/${encodedPath(path)}?ref=${encodeURIComponent(commit)}`),
      `file ${path} at ref ${ref}`,
      options.signal,
    ),
  );
  if (!contents.success || contents.data.type !== 'file') {
    throw notFound(`file ${path} at ref ${ref}`);
  }
  const { size, encoding, content, sha } = contents.data;
  const missing = notFound(`file ${path} at ref ${ref}`);
  if (size === undefined) throw missing;
  if (options.maxBytes !== undefined && size > options.maxBytes) {
    throw new HttpError(
      413,
      `repository document too large: ${size} bytes exceeds limit ${options.maxBytes}`,
    );
  }
  if (encoding === 'base64' && content !== undefined) {
    return toFileResponse(path, ref, commit, Buffer.from(content, 'base64'));
  }
  if (sha === undefined) throw missing;
  const blob = blobSchema.safeParse(
    await readJson(
      reader,
      repositoryUrl(reader, `git/blobs/${encodeURIComponent(sha)}`),
      `file ${path} at ref ${ref}`,
      options.signal,
    ),
  );
  if (!blob.success || blob.data.encoding !== 'base64') throw missing;
  return toFileResponse(path, ref, commit, Buffer.from(blob.data.content, 'base64'));
}

export async function readGithubProjectFile(
  reader: GithubRepoRead,
  path: string,
  refParam: string | undefined,
  options: { maxBytes?: number; signal?: AbortSignal } = {},
): Promise<ProjectFileResponse> {
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommit(reader, refParam, options.signal);
  return readGithubProjectFileAtCommit(reader, commit, path, ref, options);
}

export async function readGithubProjectFileCandidates(
  reader: GithubRepoRead,
  paths: readonly string[],
  refParam: string | undefined,
  options: { maxBytes?: number; signal?: AbortSignal } = {},
): Promise<ProjectFileResponse | null> {
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommit(reader, refParam, options.signal);
  for (const path of paths) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      const file = await readGithubProjectFileAtCommit(reader, commit, path, ref, options);
      if (file.encoding === 'utf-8') return file;
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 404 &&
        error.message.includes(`file ${path}`)
      ) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function listGithubProjectFiles(
  reader: GithubRepoRead,
  refParam: string | undefined,
  limit: number,
): Promise<ProjectFilesResponse> {
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommit(reader, refParam);
  const tree = treeSchema.safeParse(
    await readJson(
      reader,
      repositoryUrl(reader, `git/trees/${encodeURIComponent(commit)}?recursive=1`),
      `the file list at ref ${ref}`,
    ),
  );
  if (!tree.success) {
    throw new HttpError(
      502,
      `GitHub returned no file list for ${ref} of ${reader.repository.owner}/${reader.repository.repo}`,
    );
  }
  if (tree.data.truncated === true) {
    throw new HttpError(
      413,
      `GitHub truncated the file list of ${reader.repository.owner}/${reader.repository.repo}; read files by path instead of listing them`,
    );
  }
  const entries = tree.data.tree.filter((entry) => entry.type === 'blob' || entry.type === 'tree');
  const files = entries.slice(0, limit).map((entry) => ({
    path: entry.path,
    type: entry.type as 'blob' | 'tree',
    size: entry.type === 'blob' ? (entry.size ?? null) : null,
  }));
  return { ref, commit, truncated: entries.length > files.length, files };
}
