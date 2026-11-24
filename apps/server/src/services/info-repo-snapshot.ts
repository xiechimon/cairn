import type { step, todo } from '../db/schema.js';
import { runGit } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { githubAccessHint, githubNoTokenHint } from '../lib/github-access-hint.js';
import { githubApiBaseUrl } from '../lib/github-api-base.js';
import { githubTokenFetch } from '../lib/github-token.js';
import { githubRepoOfProject, projectOfTodo, repoDirFor } from './git.js';
import { githubAppRegistration } from './github-app-registration.js';
import { githubReadTokenAccess } from './github-autonomous-token.js';
import { refreshingGithubFetch } from './github-connection.js';
import { githubConnectionInstallUrl } from './github-connection-device.js';
import type { MachineDeps } from './machine-deps.js';
import { requestRepoArchive } from './machine-repo-archive.js';
import { profileForStep } from './routing-rules.js';

export const INFO_SNAPSHOT_MAX_BYTES = 6 * 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 60_000;

function isAllowedSnapshotRedirect(location: string, requestUrl: string): string | null {
  let target: URL;
  let apiBase: URL;
  try {
    target = new URL(location, requestUrl);
    apiBase = new URL(`${githubApiBaseUrl()}/`);
  } catch {
    return null;
  }
  if (target.username !== '' || target.password !== '') return null;
  if (target.origin === apiBase.origin && target.pathname.startsWith(apiBase.pathname)) {
    return target.href;
  }
  if (target.protocol !== 'https:') return null;
  const host = target.hostname.toLowerCase();
  if (
    host === 'codeload.github.com' ||
    host === 'api.github.com' ||
    host === 'github.com' ||
    host.endsWith('.githubusercontent.com')
  ) {
    return target.href;
  }
  return null;
}

async function cancelBody(response: Awaited<ReturnType<FetchLike>>): Promise<void> {
  const body = (response as { body?: { cancel?: () => Promise<unknown> } | null }).body;
  if (body && typeof body.cancel === 'function') {
    await body.cancel().catch(() => {});
  }
}

async function readBoundedTarball(
  response: Awaited<ReturnType<FetchLike>>,
  maxBytes: number,
): Promise<Buffer | null> {
  const rawLength = response.headers.get('content-length');
  const declaredLength =
    rawLength !== null && rawLength.trim() !== '' ? Number(rawLength) : Number.NaN;
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response);
    return null;
  }
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } finally {
      reader.releaseLock();
    }
  }
  const arrayBufferFn = (response as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  const bytes =
    typeof arrayBufferFn === 'function'
      ? Buffer.from(await arrayBufferFn.call(response))
      : Buffer.from(await response.text(), 'binary');
  return bytes.length > maxBytes ? null : bytes;
}

type TodoRow = typeof todo.$inferSelect;
type StepRow = typeof step.$inferSelect;

export function infoRepoOffered(deps: Pick<MachineDeps, 'db'>, todoRow: TodoRow): boolean {
  const project = projectOfTodo(deps.db, todoRow);
  return (
    project !== undefined &&
    ((project.repoKind === 'hosted' && project.repoName !== null) ||
      (project.repoKind === 'local' && project.localPath !== null) ||
      githubRepoOfProject(project) !== null)
  );
}

export async function infoRepoSnapshot(
  deps: MachineDeps,
  todoRow: TodoRow,
  stepRow: StepRow,
  signal: AbortSignal | undefined,
): Promise<{ tarGz: Buffer } | { reason: string } | null> {
  const project = projectOfTodo(deps.db, todoRow);
  if (project === undefined) return null;
  if (project.repoKind === 'local' && project.localPath !== null) {
    const ref = project.baseBranch ?? 'HEAD';
    if (ref.startsWith('-')) return { reason: 'the default branch name is not valid' };
    const holder = profileForStep(deps.db, todoRow, stepRow.kind, stepRow.id)?.machineId ?? null;
    if (holder === null) return { reason: 'no Runner is set for this project' };
    return requestRepoArchive(
      deps,
      holder,
      {
        stepId: stepRow.id,
        directory: project.localPath,
        ref,
        maxBytes: INFO_SNAPSHOT_MAX_BYTES,
      },
      signal,
    );
  }
  if (project.repoKind === 'hosted' && project.repoName !== null) {
    if (deps.reposDir === undefined) return { reason: 'hosted repositories are not configured' };
    const dir = repoDirFor(deps.reposDir, project.teamId, project.repoName);
    const ref = project.baseBranch ?? 'HEAD';
    if (ref.startsWith('-')) return { reason: 'the default branch name is not valid' };
    const verified = await runGit(
      ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
      {
        cwd: dir,
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
      },
    );
    if (verified.code !== 0) return { reason: 'the default branch does not exist' };
    const ran = await runGit(
      ['archive', '--format=tar.gz', verified.stdout.toString('utf8').trim()],
      {
        cwd: dir,
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
      },
    );
    if (ran.code !== 0) return { reason: ran.stderr.trim().slice(0, 300) || 'git archive failed' };
    return ran.stdout.length > INFO_SNAPSHOT_MAX_BYTES
      ? { reason: `the snapshot is larger than ${INFO_SNAPSHOT_MAX_BYTES} bytes` }
      : { tarGz: ran.stdout };
  }
  const github = githubRepoOfProject(project);
  if (github === null) return null;
  const access = await githubReadTokenAccess(deps, project.teamId, github);
  if (access.token === null) return { reason: githubNoTokenHint(access.reason) };
  const baseFetch = deps.githubBaseFetch ?? deps.githubFetch ?? fetch;
  const fetchImpl = githubTokenFetch(
    refreshingGithubFetch(deps, baseFetch, project.teamId),
    access.token,
    github,
  );
  const timeout = AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const url = `${githubApiBaseUrl()}/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/tarball/${encodeURIComponent(project.baseBranch ?? 'HEAD')}`;
  let response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${access.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cairn-server',
    },
    redirect: 'manual',
    signal: requestSignal,
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    await cancelBody(response);
    const redirectUrl = location !== null ? isAllowedSnapshotRedirect(location, url) : null;
    if (redirectUrl === null) {
      return { reason: 'GitHub returned an untrusted snapshot redirect' };
    }
    response = await baseFetch(redirectUrl, {
      headers: { 'user-agent': 'cairn-server' },
      redirect: 'error',
      signal: requestSignal,
    });
  }
  if (!response.ok) {
    await cancelBody(response);
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const installUrl = githubConnectionInstallUrl(
        deps.githubApp === undefined ? githubAppRegistration : deps.githubApp,
      );
      return {
        reason: `GitHub answered ${response.status}: ${githubAccessHint(
          {
            owner: github.owner,
            repo: github.repo,
            token: access.token,
            installUrl,
          },
          response.status,
        )}`,
      };
    }
    return { reason: `GitHub answered ${response.status}` };
  }
  const bytes = await readBoundedTarball(response, INFO_SNAPSHOT_MAX_BYTES);
  return bytes === null
    ? { reason: `the snapshot is larger than ${INFO_SNAPSHOT_MAX_BYTES} bytes` }
    : { tarGz: bytes };
}
