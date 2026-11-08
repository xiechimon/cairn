import {
  type BoundGitCredentials,
  type CommitIdentity,
  type PushPublication,
  withCoAuthor,
} from '@cairn/shared';
import { gitCredentialEnv, machineGitEnv, runGitOk } from './git.js';

const PUBLISHED = ['--remotes', '--glob=refs/cairn/published-tags/*'];

type Git = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<string>;

async function rewriteUnpublished(
  git: Git,
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

export async function attributeStepCommits(
  input: PushPublication & {
    dir: string;
    branch: string;
    credential: BoundGitCredentials | null;
  },
): Promise<void> {
  if (input.base === null) return;
  const git: Git = (args, stdin, env) =>
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
    input.credential ? gitCredentialEnv(input.credential) : machineGitEnv(),
  );
  await rewriteUnpublished(
    git,
    input.branch,
    await git(['rev-parse', 'HEAD']),
    input.identity,
    input.coAuthor,
  );
}
