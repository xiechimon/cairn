export interface GitIdentity {
  name: string;
  email: string;
}

export interface GithubAccount {
  login: string;
  id: number;
}

export interface CommitIdentityPolicy {
  bot: GithubAccount;
  owner: GithubAccount & { emails: string[] };
  platformCommitters: GitIdentity[];
  platformMergeAuthors: GitIdentity[];
  agentEnv: string[];
}

export interface CommitFacts {
  sha: string;
  author: GitIdentity;
  committer: GitIdentity;
  parents: number;
  verified: boolean | null;
}

export type PublishGit = (args: string[]) => Promise<string>;
export type PublishApi = (
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<unknown>;

export interface PublishInput {
  git: PublishGit;
  api: PublishApi;
  tip: string;
  exclude: string[];
  coAuthor: GitIdentity | null;
  expectedAuthor: GitIdentity | null;
  stagingRef: string;
  remote?: string;
}

export interface PublishResult {
  tip: string;
  release: () => Promise<void>;
}

export const GITHUB_WEB_COMMITTER: GitIdentity = { name: 'GitHub', email: 'noreply@github.com' };

const COMMIT_HELPER = '~/.cairn/tools/app-token/as-bot.sh git commit';
const PUSH_HELPER = '~/.cairn/tools/app-token/as-bot.sh git push';

export function githubNoreplyEmail(account: GithubAccount): string {
  return `${account.id}+${account.login}@users.noreply.github.com`;
}

export function appBotIdentity(appSlug: string, botUserId: number): GitIdentity {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(appSlug) || !Number.isSafeInteger(botUserId) || botUserId <= 0)
    throw new Error('Invalid GitHub App identity');
  const login = `${appSlug}[bot]`;
  return { name: login, email: githubNoreplyEmail({ login, id: botUserId }) };
}

export function localCommitIdentity(name: string): GitIdentity {
  return { name, email: 'cairn@localhost' };
}

export function policyBotIdentity(policy: CommitIdentityPolicy): GitIdentity {
  return { name: policy.bot.login, email: githubNoreplyEmail(policy.bot) };
}

export function coAuthorTrailer(identity: GitIdentity): string {
  if (/[\r\n\0<>]/.test(identity.name + identity.email))
    throw new Error('Invalid co-author identity');
  return `Co-authored-by: ${identity.name} <${identity.email}>`;
}

export function withCoAuthor(message: string, coAuthor: GitIdentity | null): string {
  if (coAuthor === null) return message;
  const trailer = coAuthorTrailer(coAuthor);
  const lines = message.trimEnd().split('\n');
  if (lines.some((line) => line.trim().toLowerCase() === trailer.toLowerCase())) return message;
  const lastBreak = lines.lastIndexOf('');
  const lastParagraph = lines.slice(lastBreak + 1);
  const endsInTrailers =
    lastBreak > 0 && lastParagraph.some((line) => /^[A-Za-z][A-Za-z0-9-]*: \S/.test(line));
  return `${lines.join('\n')}${endsInTrailers ? '\n' : '\n\n'}${trailer}`;
}

const sameIdentity = (a: GitIdentity, b: GitIdentity) =>
  a.name === b.name && a.email.toLowerCase() === b.email.toLowerCase();

const isOwner = (policy: CommitIdentityPolicy, identity: GitIdentity) =>
  policy.owner.emails.some((email) => email.toLowerCase() === identity.email.toLowerCase());

const isPlatformCommitter = (policy: CommitIdentityPolicy, identity: GitIdentity) =>
  policy.platformCommitters.some((committer) => sameIdentity(committer, identity));

const describe = (identity: GitIdentity) => `${identity.name} <${identity.email}>`;

export function commitIdentityViolation(
  policy: CommitIdentityPolicy,
  commit: CommitFacts,
): string | null {
  const bot = policyBotIdentity(policy);
  if (sameIdentity(commit.author, bot)) {
    if (sameIdentity(commit.committer, GITHUB_WEB_COMMITTER) && commit.verified === true)
      return null;
    return `${commit.sha} is authored by ${bot.name} but was not created through the GitHub API (committer ${describe(commit.committer)}, verified ${String(commit.verified)}); publish it with ${PUSH_HELPER}`;
  }
  if (isOwner(policy, commit.author)) {
    if (isOwner(policy, commit.committer) || isPlatformCommitter(policy, commit.committer))
      return null;
    return `${commit.sha} is authored by ${policy.owner.login} but committed by ${describe(commit.committer)}`;
  }
  if (
    commit.parents > 1 &&
    policy.platformMergeAuthors.some((author) => sameIdentity(author, commit.author)) &&
    isPlatformCommitter(policy, commit.committer)
  )
    return null;
  return `${commit.sha} is authored by ${describe(commit.author)}; software commits are authored by ${bot.name} through the GitHub API and only ${policy.owner.login}'s own commits carry his identity`;
}

export function isAgentEnvironment(
  policy: CommitIdentityPolicy,
  env: Record<string, string | undefined>,
): boolean {
  return policy.agentEnv.some((name) => (env[name] ?? '') !== '');
}

export function localCommitViolation(
  policy: CommitIdentityPolicy,
  author: GitIdentity,
  committer: GitIdentity,
  env: Record<string, string | undefined>,
): string | null {
  const bot = policyBotIdentity(policy);
  if (isAgentEnvironment(policy, env)) {
    if (sameIdentity(author, bot) && sameIdentity(committer, bot)) return null;
    return `agent sessions commit as ${bot.name}, not ${describe(author)}: run ${COMMIT_HELPER} ...`;
  }
  for (const identity of [author, committer])
    if (!sameIdentity(identity, bot) && !isOwner(policy, identity))
      return `${describe(identity)} is not an allowed commit identity: commit as ${policy.owner.login} by hand, or as ${bot.name} with ${COMMIT_HELPER}`;
  return null;
}

export function pushViolation(
  policy: CommitIdentityPolicy,
  commits: CommitFacts[],
  env: Record<string, string | undefined>,
): string | null {
  const bot = policyBotIdentity(policy);
  const agent = isAgentEnvironment(policy, env);
  for (const commit of commits) {
    const published =
      sameIdentity(commit.author, bot) && sameIdentity(commit.committer, GITHUB_WEB_COMMITTER);
    if (published) continue;
    if (!agent && isOwner(policy, commit.author) && isOwner(policy, commit.committer)) continue;
    return `${commit.sha} by ${describe(commit.author)} was not created through the GitHub API: push with ${PUSH_HELPER} origin HEAD:<branch>`;
  }
  return null;
}

const apiCommitSchema = (value: unknown) => {
  const body = value as {
    sha?: unknown;
    author?: { name?: unknown; email?: unknown };
    verification?: { verified?: unknown };
  } | null;
  if (
    typeof body?.sha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(body.sha) ||
    typeof body.author?.name !== 'string' ||
    typeof body.author.email !== 'string'
  )
    throw new Error('GitHub returned an unreadable commit');
  return {
    sha: body.sha,
    author: { name: body.author.name, email: body.author.email },
    verified: body.verification?.verified === true,
  };
};

export async function publishVerifiedCommits(input: PublishInput): Promise<PublishResult> {
  const remote = input.remote ?? 'origin';
  if (!/^refs\/cairn\/publish\/[A-Za-z0-9._-]+$/.test(input.stagingRef))
    throw new Error('Invalid staging ref');
  const revs = (
    await input.git(['rev-list', '--reverse', '--topo-order', input.tip, '--not', ...input.exclude])
  )
    .split('\n')
    .filter(Boolean);
  const commits = [];
  for (const sha of revs) {
    const [tree, parents, authorName, authorEmail, committerName, committerEmail, ...body] = (
      await input.git(['show', '-s', '--format=%T%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B', sha])
    ).split('\0');
    if (
      !tree ||
      parents === undefined ||
      !authorName ||
      !authorEmail ||
      !committerName ||
      !committerEmail
    )
      throw new Error(`Unreadable commit ${sha}`);
    commits.push({
      sha,
      tree,
      parents: parents.split(' ').filter(Boolean),
      author: { name: authorName, email: authorEmail },
      committer: { name: committerName, email: committerEmail },
      message: body.join('\0').trimEnd(),
    });
  }
  const replaced = new Map<string, string>();
  const pending = commits.filter((commit) => {
    const made =
      sameIdentity(commit.committer, GITHUB_WEB_COMMITTER) &&
      (input.expectedAuthor === null || sameIdentity(commit.author, input.expectedAuthor));
    return !made;
  });
  if (pending.length === 0) return { tip: input.tip, release: async () => {} };
  const apiRef = `/git/refs/${input.stagingRef.slice('refs/'.length)}`;
  let staged = false;
  const release = async () => {
    if (!staged) return;
    staged = false;
    await input.git(['update-ref', '-d', input.stagingRef]);
    await input.api('DELETE', apiRef).catch((error: unknown) => {
      if (!(error instanceof TypeError)) throw error;
      return input.api('DELETE', apiRef);
    });
  };
  try {
    await input.git(['push', '--no-verify', remote, `${input.tip}:${input.stagingRef}`]);
    staged = true;
    for (const commit of commits) {
      const parents = commit.parents.map((parent) => replaced.get(parent) ?? parent);
      const replay =
        pending.includes(commit) || parents.some((parent, i) => parent !== commit.parents[i]);
      if (!replay) continue;
      const created = apiCommitSchema(
        await input.api('POST', '/git/commits', {
          message: withCoAuthor(commit.message, input.coAuthor),
          tree: commit.tree,
          parents,
        }),
      );
      if (input.expectedAuthor !== null && !sameIdentity(created.author, input.expectedAuthor))
        throw new Error(
          `GitHub API commit for ${commit.sha} was authored as ${created.author.name}, expected ${input.expectedAuthor.name}`,
        );
      if (!created.verified) throw new Error(`GitHub API commit for ${commit.sha} is not verified`);
      replaced.set(commit.sha, created.sha);
    }
    const tip = replaced.get(input.tip) ?? input.tip;
    await input.api('PATCH', apiRef, { sha: tip, force: true });
    await input.git(['fetch', '--no-tags', remote, `+${input.stagingRef}:${input.stagingRef}`]);
    if ((await input.git(['rev-parse', input.stagingRef])).trim() !== tip)
      throw new Error('Fetched staging ref does not match the published tip');
    return { tip, release };
  } catch (error) {
    await release();
    throw error;
  }
}
