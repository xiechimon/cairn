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
  cloudAgents: GitIdentity[];
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

const COMMIT_HELPER = 'git commit';
const LOCAL_COMMIT_EMAIL = 'cairn@localhost';

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
  return { name, email: LOCAL_COMMIT_EMAIL };
}

export function policyBotIdentity(policy: CommitIdentityPolicy): GitIdentity {
  return { name: policy.bot.login, email: githubNoreplyEmail(policy.bot) };
}

const sameIdentity = (a: GitIdentity, b: GitIdentity) =>
  a.name === b.name && a.email.toLowerCase() === b.email.toLowerCase();

const isOwner = (policy: CommitIdentityPolicy, identity: GitIdentity) =>
  policy.owner.emails.some((email) => email.toLowerCase() === identity.email.toLowerCase());

const isPlatformCommitter = (policy: CommitIdentityPolicy, identity: GitIdentity) =>
  policy.platformCommitters.some((committer) => sameIdentity(committer, identity));

const isCloudAgent = (policy: CommitIdentityPolicy, identity: GitIdentity) =>
  policy.cloudAgents.some((agent) => sameIdentity(agent, identity));

const describe = (identity: GitIdentity) => `${identity.name} <${identity.email}>`;

export function commitIdentityViolation(
  policy: CommitIdentityPolicy,
  commit: CommitFacts,
  fromFork: boolean,
): string | null {
  const bot = policyBotIdentity(policy);
  if (
    sameIdentity(commit.author, bot) ||
    isOwner(policy, commit.author) ||
    isCloudAgent(policy, commit.author)
  ) {
    if (fromFork)
      return `${commit.sha} claims ${describe(commit.author)} but comes from a fork; only branches of this repository carry the App's, a cloud session's or ${policy.owner.login}'s identity`;
    if (
      sameIdentity(commit.committer, bot) ||
      isOwner(policy, commit.committer) ||
      isCloudAgent(policy, commit.committer) ||
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
  return `${commit.sha} is authored by ${describe(commit.author)}; commits must use ${policy.owner.login}, a cloud session or the transitional ${bot.name} identity`;
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
  const local = [author, committer].find(
    (identity) => identity.email.toLowerCase() === LOCAL_COMMIT_EMAIL,
  );
  if (local)
    return `${describe(local)} is an unpublished local Cairn identity: configure the product's GitHub user connection, or commit as ${policy.owner.login} with ${COMMIT_HELPER}`;
  if (isAgentEnvironment(policy, env)) {
    if (isOwner(policy, author) && isOwner(policy, committer)) return null;
    if (sameIdentity(author, bot) && sameIdentity(committer, bot)) return null;
    if (isCloudAgent(policy, author) && isCloudAgent(policy, committer)) return null;
    return `agent sessions use the same allowed identity for author and committer: configure ${policy.owner.login}'s registered email and run ${COMMIT_HELPER}, or retain an existing cloud or transitional App identity`;
  }
  for (const identity of [author, committer])
    if (
      !sameIdentity(identity, bot) &&
      !isOwner(policy, identity) &&
      !isCloudAgent(policy, identity)
    )
      return `${describe(identity)} is not an allowed commit identity: configure ${policy.owner.login}'s registered email and run ${COMMIT_HELPER}`;
  return null;
}

export function pushViolation(policy: CommitIdentityPolicy, commits: CommitFacts[]): string | null {
  const bot = policyBotIdentity(policy);
  for (const commit of commits) {
    if (sameIdentity(commit.author, bot) || isCloudAgent(policy, commit.author)) continue;
    if (isOwner(policy, commit.author)) continue;
    return `${commit.sha} by ${describe(commit.author)} is not an allowed author: commit as ${policy.owner.login} with ${COMMIT_HELPER}`;
  }
  return null;
}
