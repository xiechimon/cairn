import type { BoundGitCredentials, CommitIdentity } from '@cairn/shared';
import { gitCredentialEnv, machineGitEnv, runGitOk } from './git.js';

export async function ensureStepCoauthor(
  dir: string,
  branch: string,
  base: string | null,
  identity: CommitIdentity | null,
  credential: BoundGitCredentials | null,
): Promise<void> {
  if (identity === null || base === null) return;
  if (/[\r\n\0<>]/.test(identity.name + identity.email))
    throw new Error('Invalid co-author identity');
  const git = (args: string[], input?: string, env?: NodeJS.ProcessEnv) =>
    runGitOk(args, {
      cwd: dir,
      ...(input !== undefined ? { input } : {}),
      ...(env ? { env } : {}),
      timeoutMs: 480_000,
    });
  if ((await git(['branch', '--show-current'])) !== branch)
    throw new Error('Co-author branch changed');
  await git(
    [
      'fetch',
      'origin',
      '+refs/heads/*:refs/remotes/origin/*',
      '+refs/tags/*:refs/cairn/published-tags/*',
    ],
    undefined,
    credential ? gitCredentialEnv(credential) : machineGitEnv(),
  );
  const head = await git(['rev-parse', 'HEAD']);
  const unpublished = (
    await git([
      'rev-list',
      '--reverse',
      '--topo-order',
      `${base}..${head}`,
      '--not',
      '--remotes',
      '--glob=refs/cairn/published-tags/*',
    ])
  )
    .split('\n')
    .filter(Boolean);
  const replacements = new Map<string, string>();
  for (const oid of unpublished) {
    const raw = await git([
      'show',
      '-s',
      '--format=%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B',
      oid,
    ]);
    const [tree, parents, author, email, date, committer, committerEmail, committerDate, ...body] =
      raw.split('\0');
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
    const message = body.join('\0');
    const trailer = `Co-authored-by: ${identity.name} <${identity.email}>`;
    const present = message
      .split('\n')
      .some((line) => line.toLowerCase() === trailer.toLowerCase());
    const rewrittenParents = parents
      .split(' ')
      .filter(Boolean)
      .map((parent) => replacements.get(parent) ?? parent);
    if (present && rewrittenParents.join(' ') === parents) continue;
    const next = await git(
      ['commit-tree', tree, ...rewrittenParents.flatMap((parent) => ['-p', parent])],
      present ? `${message}\n` : `${message.trimEnd()}\n\n${trailer}\n`,
      {
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: committer,
        GIT_COMMITTER_EMAIL: committerEmail,
        GIT_COMMITTER_DATE: committerDate,
      },
    );
    replacements.set(oid, next);
  }
  const next = replacements.get(head);
  if (next) await git(['update-ref', `refs/heads/${branch}`, next, head]);
}
