import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

try {
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const base =
    process.env.COMMENT_DISCIPLINE_BASE_SHA || git('merge-base', 'origin/main', 'HEAD').trim();
  const allowlist = JSON.parse(readFileSync('scripts/comment-discipline-allowlist.json', 'utf8'));
  if (
    !Array.isArray(allowlist) ||
    allowlist.some(
      (entry) =>
        typeof entry.path !== 'string' || typeof entry.line !== 'string' || !entry.reason?.trim(),
    )
  ) {
    throw new Error('Allowlist entries require path, line and reason');
  }
  const files = git(
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
    base,
    '--',
    'apps',
    'packages',
  )
    .split('\0')
    .filter((path) => /\.(ts|tsx|mjs|css)$/.test(path));
  let violations = 0;
  for (const path of files) {
    const added = new Set();
    let line = 0;
    for (const patchLine of git(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=0',
      base,
      '--',
      path,
    ).split('\n')) {
      const hunk = /^@@ .* \+(\d+)/.exec(patchLine);
      if (hunk) line = Number(hunk[1]);
      else if (patchLine.startsWith('+') && !patchLine.startsWith('+++')) added.add(line++);
      else if (patchLine.startsWith(' ')) line++;
    }
    let block = false;
    for (const [index, text] of readFileSync(path, 'utf8').split('\n').entries()) {
      const trimmed = text.trimStart();
      const comment = block || /^(\/\/|\/\*|\{\s*\/\*)/.test(trimmed);
      if (
        comment &&
        added.has(index + 1) &&
        !allowlist.some((entry) => entry.path === path && entry.line === text)
      ) {
        console.error(
          `${path}:${index + 1}: new comment requires removal or an exact allowlist entry`,
        );
        violations++;
      }
      if (!block && /^(\/\*|\{\s*\/\*)/.test(trimmed)) block = true;
      if (block && trimmed.includes('*/')) block = false;
    }
  }
  console.log(`comment-discipline-gate: ${violations} new comment line(s)`);
  process.exitCode = violations ? 1 : 0;
} catch (error) {
  console.error(`comment-discipline-gate: ${error.message}`);
  process.exitCode = 2;
}
