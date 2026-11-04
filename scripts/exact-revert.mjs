import { execFileSync } from 'node:child_process';

export const shaPattern = /^[a-f0-9]{40}$/;

export const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

export function revertedShas(message) {
  const names = [...message.matchAll(/^This reverts commit ([a-f0-9]{40})\.?$/gm)].map(
    (match) => match[1],
  );
  if (!names.length || new Set(names).size !== names.length)
    throw new Error('Reverted SHAs are missing or duplicated');
  return names;
}

export function assertExactRevertTree(dir, { baseSha, headSha, names, history }) {
  for (const sha of [baseSha, headSha, ...names])
    if (!shaPattern.test(sha)) throw new Error('Invalid SHA');
  git(dir, 'checkout', '--detach', baseSha);
  for (const sha of [...names].sort((a, b) => history.indexOf(a) - history.indexOf(b))) {
    const parents = git(dir, 'show', '-s', '--format=%P', sha).split(' ');
    git(dir, 'revert', '--no-commit', ...(parents.length > 1 ? ['-m', '1'] : []), sha);
  }
  if (git(dir, 'write-tree') !== git(dir, 'rev-parse', `${headSha}^{tree}`))
    throw new Error('Recovery tree differs from the exact revert');
}
