#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const GRACE_MS = 30 * 60_000;
const IDLE_MS = 3 * 24 * 60 * 60_000;
const PR_LIMIT = '1000';

function settled(worktree, own, now, { pushedHead, savedOn, idleSince }) {
  const assetsOf = own.length > 0 && /^pr-assets\/\d+$/.test(worktree.branch);
  if (assetsOf && pushedHead(worktree.branch) !== worktree.head)
    return { action: 'keep', reason: `HEAD ${worktree.head} of ${worktree.branch} is not pushed` };
  const done = assetsOf ? own[0] : own.find((pr) => pr.headRefOid === worktree.head);
  if (done) {
    const verb = done.state === 'MERGED' ? 'merged' : 'closed';
    if (now - Date.parse(done.mergedAt ?? done.closedAt) < GRACE_MS)
      return { action: 'keep', reason: `PR #${done.number} ${verb} less than 30 minutes ago` };
    return { action: 'remove', reason: `PR #${done.number} ${verb}` };
  }
  const unmatched = !worktree.branch
    ? 'detached HEAD'
    : own.length === 0
      ? `no PR for ${worktree.branch}`
      : `HEAD ${worktree.head} is not the head of any merged or closed PR`;
  const ref = savedOn(worktree.head);
  if (!ref) return { action: 'keep', reason: `${unmatched} and HEAD is on no remote branch` };
  if (now - idleSince(worktree.path) < IDLE_MS)
    return { action: 'keep', reason: `${unmatched} and the tree changed less than 3 days ago` };
  return { action: 'remove', reason: `${unmatched}, HEAD is on ${ref}, idle 3+ days` };
}

export function decide(worktree, prs, now, facts) {
  if (worktree.locked) return { action: 'keep', reason: 'locked' };
  if (worktree.path.startsWith(`${join(homedir(), '.t3')}/`))
    return { action: 'keep', reason: 'managed by T3 Code' };
  const assetsOf = Number(/^pr-assets\/(\d+)$/.exec(worktree.branch ?? '')?.[1]);
  const own = worktree.branch
    ? prs.filter((pr) => (assetsOf ? pr.number === assetsOf : pr.headRefName === worktree.branch))
    : [];
  const open = own.find((pr) => pr.state === 'OPEN');
  if (open) return { action: 'keep', reason: `PR #${open.number} is open` };
  const verdict = settled(worktree, own, now, facts);
  if (verdict.action === 'keep') return verdict;
  const inner = facts.nested(worktree.path);
  if (inner.length > 0) return { action: 'keep', reason: `contains worktree ${inner.join(', ')}` };
  if (facts.dirty(worktree.path))
    return { action: 'keep', reason: 'uncommitted or untracked changes' };
  const users = facts.busy(worktree.path);
  if (users.length > 0) return { action: 'keep', reason: `in use by pid ${users.join(', ')}` };
  return verdict;
}

function linkedWorktrees(repo) {
  const entries = [];
  let current = null;
  for (const line of execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  }).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), head: null, branch: null, locked: false };
      entries.push(current);
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (current && line.startsWith('branch '))
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (current && line.startsWith('locked')) current.locked = true;
  }
  return entries.slice(1);
}

function dirty(path) {
  const status = spawnSync(
    'git',
    ['--no-optional-locks', '-C', path, 'status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf8' },
  );
  return status.status !== 0 || status.stdout.trim() !== '';
}

function lastChange(path) {
  const gitDir = spawnSync('git', ['-C', path, 'rev-parse', '--absolute-git-dir'], {
    encoding: 'utf8',
  });
  if (gitDir.status !== 0) return Number.POSITIVE_INFINITY;
  return Math.max(
    ...['HEAD', 'index', 'logs/HEAD'].map(
      (file) => statSync(join(gitDir.stdout.trim(), file), { throwIfNoEntry: false })?.mtimeMs ?? 0,
    ),
  );
}

function busy(path) {
  const users = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let cwd;
    try {
      cwd = readlinkSync(`/proc/${entry}/cwd`);
    } catch {
      continue;
    }
    if (cwd === path || cwd.startsWith(`${path}/`)) users.push(Number(entry));
  }
  return users;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  const repoAt = argv.indexOf('--repo');
  const repo = resolve(
    repoAt === -1
      ? (process.env.CAIRN_REPO ?? join(homedir(), 'Code/AgentProjects/cairn'))
      : argv[repoAt + 1],
  );
  const dryRun = argv.includes('--dry-run');
  const list = spawnSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      PR_LIMIT,
      '--json',
      'number,state,headRefName,headRefOid,mergedAt,closedAt',
    ],
    { cwd: repo, encoding: 'utf8' },
  );
  if (list.status !== 0) {
    console.error(
      `worktree-reaper: gh pr list failed, removing nothing: ${(list.stderr ?? '').trim()}`,
    );
    process.exit(1);
  }
  const prs = JSON.parse(list.stdout);
  const fetch = spawnSync('git', ['-C', repo, 'fetch', '--prune', '--quiet', 'origin'], {
    encoding: 'utf8',
  });
  if (fetch.status !== 0) {
    console.error(
      `worktree-reaper: git fetch failed, removing nothing: ${(fetch.stderr ?? '').trim()}`,
    );
    process.exit(1);
  }
  spawnSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' });
  const counts = { removed: 0, kept: 0, failed: 0 };
  const worktrees = linkedWorktrees(repo);
  for (const worktree of worktrees) {
    const { action, reason } = decide(worktree, prs, Date.now(), {
      dirty,
      busy,
      idleSince: lastChange,
      nested: (path) =>
        worktrees.filter((other) => other.path.startsWith(`${path}/`)).map((other) => other.path),
      savedOn: (head) =>
        spawnSync(
          'git',
          [
            '-C',
            repo,
            'for-each-ref',
            '--count=1',
            '--contains',
            head,
            '--format=%(refname:short)',
            'refs/remotes',
          ],
          { encoding: 'utf8' },
        ).stdout.trim() || null,
      pushedHead: (branch) =>
        spawnSync(
          'git',
          ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
          {
            encoding: 'utf8',
          },
        ).stdout.trim() || null,
    });
    if (action === 'keep') {
      counts.kept += 1;
      console.log(`kept ${worktree.path}: ${reason}`);
    } else if (dryRun) {
      console.log(`would remove ${worktree.path} (${reason})`);
    } else {
      const removal = spawnSync('git', ['-C', repo, 'worktree', 'remove', worktree.path], {
        encoding: 'utf8',
      });
      if (removal.status === 0) {
        counts.removed += 1;
        console.log(`removed ${worktree.path} (${reason})`);
      } else {
        counts.failed += 1;
        console.log(`failed ${worktree.path}: ${removal.stderr.trim()}`);
      }
    }
  }
  console.log(
    `worktree-reaper: ${counts.removed} removed, ${counts.kept} kept, ${counts.failed} failed${dryRun ? ' (dry run)' : ''}`,
  );
  process.exit(counts.failed > 0 ? 1 : 0);
}
