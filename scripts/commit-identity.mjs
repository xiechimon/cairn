import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import {
  commitIdentityViolation,
  localCommitViolation,
  pushViolation,
} from '../packages/shared/src/commit-identity.ts';

const policy = JSON.parse(
  readFileSync(new URL('../packages/shared/commit-identity.json', import.meta.url), 'utf8'),
);

const ZERO = /^0+$/;

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function parseIdent(raw) {
  const match = /^(.*) <([^>]*)> \d+ [+-]\d{4}$/.exec(raw.trim());
  if (!match) throw new Error(`unreadable git identity: ${raw}`);
  return { name: match[1], email: match[2] };
}

export function commitsOf(revListArgs) {
  return git(['log', '--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce', ...revListArgs])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, an, ae, cn, ce] = line.split('\0');
      return {
        sha,
        parents: parents.split(' ').filter(Boolean).length,
        author: { name: an, email: ae },
        committer: { name: cn, email: ce },
        verified: null,
      };
    });
}

async function verification(repo, sha) {
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const response = await fetch(`${api}/repos/${repo}/commits/${sha}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`cannot read verification of ${sha}: HTTP ${response.status}`);
  return (await response.json()).commit?.verification?.verified === true;
}

function ciRange() {
  const base = process.env.BASE_SHA ?? '';
  const before = process.env.BEFORE_SHA ?? '';
  if (base) return `${base}..HEAD`;
  if (before && !ZERO.test(before)) return `${before}..HEAD`;
  return 'HEAD^!';
}

async function ci() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  const range = ciRange();
  const failures = [];
  for (const commit of commitsOf([range])) {
    console.log(
      `${commit.sha} author: ${commit.author.name} <${commit.author.email}> committer: ${commit.committer.name} <${commit.committer.email}>`,
    );
    const facts = { ...commit, verified: await verification(repo, commit.sha) };
    const violation = commitIdentityViolation(policy, facts);
    if (violation) failures.push(violation);
  }
  for (const failure of failures) console.log(`::error::${failure}`);
  return failures.length === 0 ? 0 : 1;
}

function preCommit() {
  const violation = localCommitViolation(
    policy,
    parseIdent(git(['var', 'GIT_AUTHOR_IDENT'])),
    parseIdent(git(['var', 'GIT_COMMITTER_IDENT'])),
    process.env,
  );
  if (!violation) return 0;
  console.error(`commit identity: ${violation}`);
  return 1;
}

function prePush() {
  const updates = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  for (const update of updates) {
    const [, localSha, remoteRef, remoteSha] = update.split(' ');
    if (!localSha || ZERO.test(localSha) || !remoteRef?.startsWith('refs/heads/')) continue;
    const range =
      remoteSha && !ZERO.test(remoteSha)
        ? [`${remoteSha}..${localSha}`]
        : [localSha, '--not', '--remotes'];
    const violation = pushViolation(policy, commitsOf(range), process.env);
    if (violation) {
      console.error(`commit identity: ${violation}`);
      return 1;
    }
  }
  return 0;
}

const commands = { ci, 'pre-commit': preCommit, 'pre-push': prePush };

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const command = commands[process.argv[2]];
  if (!command) {
    console.error('usage: commit-identity.mjs ci|pre-commit|pre-push');
    process.exit(2);
  }
  process.exitCode = await command();
}
