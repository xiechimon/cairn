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
}

const COMMIT_HELPER = '~/.cairn/tools/app-token/as-bot.sh git commit';

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
  fromFork: boolean,
): string | null {
  const bot = policyBotIdentity(policy);
  if (sameIdentity(commit.author, bot) || isOwner(policy, commit.author)) {
    if (fromFork)
      return `${commit.sha} claims ${describe(commit.author)} but comes from a fork; only branches of this repository carry the App's or ${policy.owner.login}'s identity`;
    if (
      sameIdentity(commit.committer, bot) ||
      isOwner(policy, commit.committer) ||
      isPlatformCommitter(policy, commit.committer)
    )
      return null;
    return `${commit.sha} is authored by ${describe(commit.author)} but committed by ${describe(commit.committer)}`;
  }
  if (
    commit.parents > 1 &&
    policy.platformMergeAuthors.some((author) => sameIdentity(author, commit.author)) &&
    isPlatformCommitter(policy, commit.committer)
  )
    return null;
  return `${commit.sha} is authored by ${describe(commit.author)}; software commits are authored by ${bot.name} and only ${policy.owner.login}'s own commits carry his identity`;
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
    if (sameIdentity(commit.author, bot)) continue;
    if (!agent && isOwner(policy, commit.author)) continue;
    return `${commit.sha} by ${describe(commit.author)} is not authored by ${bot.name}: commit with ${COMMIT_HELPER}`;
  }
  return null;
}
