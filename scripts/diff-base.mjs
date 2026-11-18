import { spawnSync } from 'node:child_process';

// Queue candidates diff the full stacked chain: after a force-push rebuild the
// configured base is a dead commit, so fall back to the origin/main merge-base.
// Other refs keep strict resolution — a wrong base must fail loudly.
export function mergeBase(cwd, configured) {
  const queue = process.env.GITHUB_REF?.startsWith('refs/heads/queue/') === true;
  const targets =
    queue && configured !== 'origin/main' ? [configured, 'origin/main'] : [configured];
  for (const target of targets) {
    const run = spawnSync('git', ['merge-base', 'HEAD', target], {
      cwd,
      encoding: 'utf8',
    });
    if (run.status === 0) return run.stdout.trim();
  }
  return '';
}
