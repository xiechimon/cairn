import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type BoundGitCredentials,
  type CommitIdentity,
  type PushPublication,
  publishVerifiedCommits,
  withCoAuthor,
} from '@cairn/shared';
import { gitCredentialEnv, machineGitEnv, runGitOk } from './git.js';

type StepGithubTarget = NonNullable<PushPublication['github']>;

export interface StepPublish {
  verified: boolean;
  release: () => Promise<void>;
}

const PUBLISHED = ['--remotes', '--glob=refs/cairn/published-tags/*'];
const nothingToRelease = async () => {};

export function stepGithubTarget(cloneUrl: string): StepGithubTarget | null {
  const match = /^https:\/\/([^/@]+)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    cloneUrl,
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    owner: match[2],
    repo: match[3],
    apiBase: match[1] === 'github.com' ? 'https://api.github.com' : `https://${match[1]}/api/v3`,
  };
}

function stepApi(target: StepGithubTarget, credential: BoundGitCredentials) {
  const token = credential.passwordFile
    ? readFileSync(credential.passwordFile, 'utf8').trim()
    : credential.password;
  return async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    const response = await fetch(
      `${target.apiBase}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'cairn-daemon',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

async function rewriteLocally(
  git: (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<string>,
  branch: string,
  head: string,
  identity: CommitIdentity | null,
  coAuthor: CommitIdentity | null,
): Promise<void> {
  const unpublished = (
    await git(['rev-list', '--reverse', '--topo-order', head, '--not', ...PUBLISHED])
  )
    .split('\n')
    .filter(Boolean);
  const replacements = new Map<string, string>();
  for (const oid of unpublished) {
    const [tree, parents, author, email, date, committer, committerEmail, committerDate, ...body] =
      (
        await git([
          'show',
          '-s',
          '--format=%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B',
          oid,
        ])
      ).split('\0');
    if (
      !tree ||
      parents === undefined ||
      !author ||
      !email ||
      !date ||
      !committer ||
      !committerEmail ||
      !committerDate
    )
      throw new Error('Invalid commit metadata');
    const original = body.join('\0').trimEnd();
    const message = withCoAuthor(original, coAuthor);
    const rewrittenParents = parents
      .split(' ')
      .filter(Boolean)
      .map((parent) => replacements.get(parent) ?? parent);
    const authorIdentity = identity ?? { name: author, email };
    const committerIdentity = identity ?? { name: committer, email: committerEmail };
    if (
      message === original &&
      rewrittenParents.join(' ') === parents &&
      authorIdentity.name === author &&
      authorIdentity.email === email &&
      committerIdentity.name === committer &&
      committerIdentity.email === committerEmail
    )
      continue;
    replacements.set(
      oid,
      await git(
        ['commit-tree', tree, ...rewrittenParents.flatMap((parent) => ['-p', parent])],
        `${message}\n`,
        {
          GIT_AUTHOR_NAME: authorIdentity.name,
          GIT_AUTHOR_EMAIL: authorIdentity.email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: committerIdentity.name,
          GIT_COMMITTER_EMAIL: committerIdentity.email,
          GIT_COMMITTER_DATE: committerDate,
        },
      ),
    );
  }
  const next = replacements.get(head);
  if (next) await git(['update-ref', `refs/heads/${branch}`, next, head]);
}

export async function publishStepCommits(
  input: PushPublication & {
    dir: string;
    branch: string;
    credential: BoundGitCredentials | null;
  },
): Promise<StepPublish> {
  if (input.base === null) return { verified: false, release: nothingToRelease };
  const remoteEnv = input.credential ? gitCredentialEnv(input.credential) : machineGitEnv();
  const git = (args: string[], stdin?: string, env?: NodeJS.ProcessEnv) =>
    runGitOk(args, {
      cwd: input.dir,
      ...(stdin !== undefined ? { input: stdin } : {}),
      ...(env ? { env } : {}),
      timeoutMs: 480_000,
    });
  if ((await git(['branch', '--show-current'])) !== input.branch)
    throw new Error('Publish branch changed');
  await git(
    [
      'fetch',
      'origin',
      '+refs/heads/*:refs/remotes/origin/*',
      '+refs/tags/*:refs/cairn/published-tags/*',
    ],
    undefined,
    remoteEnv,
  );
  const head = await git(['rev-parse', 'HEAD']);
  if (input.github === null || input.credential === null) {
    await rewriteLocally(git, input.branch, head, input.identity, input.coAuthor);
    return { verified: false, release: nothingToRelease };
  }
  const published = await publishVerifiedCommits({
    git: (args) => git(args, undefined, remoteEnv),
    api: stepApi(input.github, input.credential),
    tip: head,
    exclude: PUBLISHED,
    coAuthor: input.coAuthor,
    expectedAuthor: input.identity,
    stagingRef: `refs/cairn/publish/${randomBytes(8).toString('hex')}`,
  });
  if (published.tip !== head)
    await git(['update-ref', `refs/heads/${input.branch}`, published.tip, head]);
  return { verified: true, release: published.release };
}
