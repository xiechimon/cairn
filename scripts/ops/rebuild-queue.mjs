#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const QUEUE_REF = 'refs/heads/queue/main';

export function planRebuild({ chain, dropSha }) {
  if (!chain.includes(dropSha)) {
    return { action: 'reject', reason: `${dropSha} is not on the queue` };
  }
  const keep = chain.filter((sha) => sha !== dropSha);
  return keep.length === 0
    ? { action: 'delete', reason: 'queue becomes empty' }
    : { action: 'rebuild', keep, dropSha };
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export function queueChain(
  repoDir,
  mainRef = 'origin/main',
  queueRef = `origin/${QUEUE_REF.replace('refs/heads/', '')}`,
) {
  return git(['rev-list', '--reverse', `${mainRef}..${queueRef}`], repoDir)
    .split('\n')
    .filter(Boolean);
}

export function rebuild(
  repoDir,
  { dropSha, remoteQueueRef = `origin/${QUEUE_REF.replace('refs/heads/', '')}` },
) {
  const oldHead = git(['rev-parse', remoteQueueRef], repoDir);
  const work = mkdtempSync(join(tmpdir(), 'rebuild-queue-'));
  try {
    git(['worktree', 'add', '--detach', work, remoteQueueRef], repoDir);
    git(['rebase', '--onto', `${dropSha}^`, dropSha], work);
    const newHead = git(['rev-parse', 'HEAD'], work);
    return { oldHead, newHead };
  } finally {
    rmSync(work, { recursive: true, force: true });
    git(['worktree', 'prune'], repoDir);
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const dropSha = process.argv[2];
  if (!dropSha || !/^[0-9a-f]{7,40}$/.test(dropSha)) {
    console.error('usage: node scripts/ops/rebuild-queue.mjs <sha-to-drop>');
    process.exit(2);
  }
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main', 'queue/main'], { stdio: 'inherit' });
  const chain = queueChain('.');
  const resolved = chain.find((sha) => sha.startsWith(dropSha));
  const plan = planRebuild({ chain, dropSha: resolved ?? dropSha });
  if (plan.action === 'reject') {
    console.error(`[rebuild-queue] ${plan.reason}`);
    console.error(`[rebuild-queue] queue is:\n${chain.join('\n')}`);
    process.exit(1);
  }
  if (plan.action === 'delete') {
    execFileSync('git', ['push', 'origin', `:${QUEUE_REF}`], { stdio: 'inherit' });
    console.log('[rebuild-queue] dropped the only candidate; queue ref deleted');
    process.exit(0);
  }
  const { oldHead, newHead } = rebuild('.', { dropSha: resolved });
  execFileSync(
    'git',
    ['push', `--force-with-lease=${QUEUE_REF}:${oldHead}`, 'origin', `${newHead}:${QUEUE_REF}`],
    { stdio: 'inherit' },
  );
  console.log(
    `[rebuild-queue] dropped ${resolved}; queue ${oldHead.slice(0, 9)} -> ${newHead.slice(0, 9)}`,
  );
}
