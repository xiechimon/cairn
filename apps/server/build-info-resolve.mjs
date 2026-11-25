import { execFileSync } from 'node:child_process';

export function resolveBuildVersion(opts = {}) {
  const env = opts.env ?? process.env;
  const raw = (env.CAIRN_BUILD_VERSION || env.VERSION || '').trim();
  if (raw !== '' && raw !== '0.0.0') return raw;
  const describe =
    opts.gitDescribeExact ??
    (() =>
      execFileSync('git', ['describe', '--tags', '--match', 'desktop-v*', '--exact-match'], {
        cwd: opts.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
  try {
    const tag = describe().trim();
    const match = /^desktop-v(.+)$/.exec(tag);
    const parsed = match?.[1]?.trim() ?? '';
    return parsed !== '' && parsed !== '0.0.0' ? parsed : null;
  } catch {
    return null;
  }
}
