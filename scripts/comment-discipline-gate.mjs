import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertExactRevertTree, git as gitIn, revertedShas } from './exact-revert.mjs';

function isExactRevertOfMain(base) {
  const cwd = process.cwd();
  if (gitIn(cwd, 'status', '--porcelain', '--untracked-files=no')) return false;
  const commits = gitIn(cwd, 'rev-list', '--no-merges', `${base}..HEAD`)
    .split('\n')
    .filter(Boolean);
  if (!commits.length) return false;
  const dir = mkdtempSync(join(tmpdir(), 'comment-gate-revert-'));
  try {
    const names = commits.flatMap((sha) =>
      revertedShas(gitIn(cwd, 'show', '-s', '--format=%B', sha)),
    );
    if (new Set(names).size !== names.length) return false;
    const history = gitIn(cwd, 'rev-list', '--first-parent', 'origin/main').split('\n');
    if (names.some((sha) => !history.includes(sha))) return false;
    gitIn(cwd, 'clone', '--shared', '--no-checkout', cwd, dir);
    assertExactRevertTree(dir, {
      baseSha: gitIn(cwd, 'rev-parse', base),
      headSha: gitIn(cwd, 'rev-parse', 'HEAD'),
      names,
      history,
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
  const exactRevert = isExactRevertOfMain(base);
  const files = exactRevert
    ? []
    : git('diff', '--name-only', '-z', '--diff-filter=ACMR', base, '--', 'apps', 'packages')
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
  console.log(
    `comment-discipline-gate: ${violations} new comment line(s)${exactRevert ? ' (exact revert of main commits)' : ''}`,
  );
  process.exitCode = violations ? 1 : 0;
} catch (error) {
  console.error(`comment-discipline-gate: ${error.message}`);
  process.exitCode = 2;
}
