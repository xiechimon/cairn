import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function collectCandidates({ since, until, cwd = process.cwd() }) {
  const bounds = [since, until].map((value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    )
      throw new Error('Interval bounds must be explicit UTC timestamps ending in Z');
    const date = new Date(value);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')
    )
      throw new Error('Invalid UTC timestamp');
    return date.getTime();
  });
  if (bounds[0] >= bounds[1]) throw new Error('Expected since < until');
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const history = git(['log', 'origin/main', '--format=%H%x00%cI', '-z']);
  const fields = history.split('\0');
  const candidates = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const followUpSha = fields[i];
    const time = new Date(fields[i + 1]).getTime();
    if (time < bounds[0] || time >= bounds[1]) continue;
    const message = git(['show', '-s', '--format=%B', followUpSha]).replace(/\n$/, '');
    const subject = message.split('\n', 1)[0];
    const conventionalFix = /^(?:fix|hotfix|bugfix)(?:\([^\n)]+\))?!?:\s+\S/i.test(subject);
    const scopedFix = /^[a-z][\w-]*\([^\n)]+\)!?:\s+(?:fix|hotfix|bugfix)\b/i.test(subject);
    const revert =
      /^Revert "[^\n]+"(?: \(#\d+\))?$/.test(subject) ||
      /^revert(?:\([^\n)]+\))?!?:\s+\S/i.test(subject);
    if (!conventionalFix && !scopedFix && !revert) continue;
    const paths = git([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-m',
      '-z',
      followUpSha,
    ])
      .split('\0')
      .filter(Boolean);
    candidates.push({
      followUpSha,
      timestamp: new Date(time).toISOString(),
      message,
      paths: [...new Set(paths)].sort(),
      fixingPr: Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]) || null,
    });
  }
  return candidates.sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.followUpSha.localeCompare(b.followUpSha),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--since' || args[2] !== '--until')
      throw new Error(
        'Usage: node scripts/escape-trace.mjs --since UTC --until UTC (inclusive since, exclusive until; origin/main committer timestamps)',
      );
    console.log(JSON.stringify(collectCandidates({ since: args[1], until: args[3] }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
