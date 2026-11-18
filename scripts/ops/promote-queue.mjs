#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';

export const QUEUE_REF = 'refs/heads/queue/main';
export const REQUIRED_CHECKS = ['check', 'pack-smoke', 'e2e-gate'];
const POLL_SECONDS = 30;
const WAIT_SECONDS = Number(process.env.PROMOTE_WAIT_SECONDS ?? 40 * 60);

export function evaluate({ queueHead, ciRuns, checkRuns, mainTip, candidateContainsMain }) {
  if (!queueHead) return { action: 'reject', reason: 'queue/main does not exist' };
  if (!candidateContainsMain) return { action: 'reject', reason: 'stale' };
  const run = ciRuns.find((r) => r.head_sha === queueHead && r.head_branch.startsWith('queue/'));
  if (run?.status !== 'completed')
    return { action: 'wait', reason: run ? `run ${run.status}` : 'no ci run yet' };
  if (run.conclusion !== 'success') return { action: 'reject', reason: `ci ${run.conclusion}` };
  const byName = new Map(checkRuns.map((c) => [c.name, c.conclusion]));
  const missing = REQUIRED_CHECKS.filter((name) => byName.get(name) !== 'success');
  if (missing.length > 0)
    return { action: 'wait', reason: `checks pending: ${missing.join(', ')}` };
  void mainTip;
  return { action: 'promote', sha: queueHead };
}

const gh = (args) =>
  JSON.parse(
    execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
  );

export function evaluateHead(repo) {
  const queueHead = gh([`repos/${repo}/git/ref/heads/queue%2Fmain`]).object.sha;
  const { workflow_runs: ciRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${queueHead}&event=push&per_page=10`,
  ]);
  const { check_runs: checkRuns } = gh([
    `repos/${repo}/commits/${queueHead}/check-runs?per_page=100`,
  ]);
  const mainTip = gh([`repos/${repo}/git/ref/heads/main`]).object.sha;
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', 'queue/main'], { stdio: 'inherit' });
  const contains =
    spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', queueHead]).status === 0;
  return evaluate({ queueHead, ciRuns, checkRuns, mainTip, candidateContainsMain: contains });
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const wait = process.argv.includes('--wait');
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  for (;;) {
    const verdict = evaluateHead(repo);
    console.log(`[promote-queue] ${verdict.action}: ${verdict.reason ?? verdict.sha}`);
    if (verdict.action === 'promote') {
      execFileSync('git', ['push', 'origin', `${verdict.sha}:refs/heads/main`], {
        stdio: 'inherit',
      });
      console.log(`[promote-queue] promoted ${verdict.sha} to main`);
      process.exit(0);
    }
    if (verdict.action === 'reject' || !wait || Date.now() > deadline) {
      process.exit(verdict.action === 'wait' ? 2 : 1);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, POLL_SECONDS * 1000);
  }
}
