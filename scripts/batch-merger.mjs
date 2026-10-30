import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { api, disarmAutoMerge, markers, pages, repo } from './autonomy-brake.mjs';

const batchHead = /^B\d+\//;
const requiredChecks = ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence'];
const log = (pr, action, reasons) =>
  console.log(
    JSON.stringify({ pr: pr?.number ?? null, head: pr?.head?.sha ?? null, action, reasons }),
  );

function ownerRouting(headSha) {
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const source = git(['show', 'origin/main:.claude/workflows/pr-gate.js']);
  const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1)
      throw new Error('Unsupported owner routing policy');
    return source.slice(from, to);
  };
  const constants = extract('const AUTO_MERGE =', 'const FILES_CMD =');
  const routing = extract('const safety = reviewed.find', 'const checked =');
  const range = `origin/main...${headSha}`;
  const numstat = git([
    '-c',
    'core.quotePath=false',
    '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    'diff',
    '--no-renames',
    '--numstat',
    range,
  ]);
  const changedFiles = [];
  const binaryFiles = [];
  let linesChanged = 0;
  for (const row of numstat.replace(/\n$/, '').split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\p{L}\p{M}\p{N}._/@+%-]+)$/u.exec(row);
    if (!match || (match[1] === '-') !== (match[2] === '-'))
      throw new Error('Invalid owner routing numstat');
    const [, added, removed, path] = match;
    changedFiles.push(path);
    if (added === '-') binaryFiles.push(path);
    else linesChanged += Number(added) + Number(removed);
  }
  const deleted = git([
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-renames',
    '--name-only',
    '--diff-filter=D',
    range,
  ]).replace(/\n$/, '');
  const deletedFiles = deleted ? deleted.split('\n') : [];
  if (!Number.isSafeInteger(linesChanged) || !deletedFiles.every((f) => changedFiles.includes(f)))
    throw new Error('Invalid owner routing diff');
  const reasons = runInNewContext(
    `${constants}
const matchedProtected = changedFiles.filter(isProtected);
const reviewed = [];
${routing}
humanReasons`,
    { changedFiles, deletedFiles, binaryFiles, linesChanged },
    { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } },
  );
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === 'string'))
    throw new Error('Invalid owner routing result');
  return reasons;
}

function eligibility(number, expectedHead, dailyCap) {
  const pr = api(`repos/${repo}/pulls/${number}`);
  const reasons = [];
  if (pr.state !== 'open') reasons.push('not-open');
  if (!batchHead.test(pr.head.ref)) reasons.push('not-batch');
  if (pr.head.repo?.full_name !== repo) reasons.push('head-repo-mismatch');
  if (!/^[a-f0-9]{40}$/.test(pr.head.sha) || pr.head.sha !== expectedHead)
    reasons.push('head-changed-or-invalid');
  if (!pr.labels.some((label) => label.name === 'review-gate')) reasons.push('no-review-label');
  if (pr.draft) reasons.push('draft');
  if (pr.base.ref !== 'main') reasons.push('base-not-main');
  for (const label of ['needs-decision', 'cairn-recovery'])
    if (pr.labels.some((item) => item.name === label)) reasons.push(label);
  const runs = pages(
    `repos/${repo}/commits/${pr.head.sha}/check-runs?filter=latest&per_page=100`,
  ).flatMap((page) => page.check_runs);
  for (const name of requiredChecks) {
    const latest = runs
      .filter(
        (run) =>
          run.name === name && run.head_sha === pr.head.sha && run.app?.slug === 'github-actions',
      )
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== 'completed' || latest.conclusion !== 'success')
      reasons.push(`check:${name}`);
  }
  const verdict = pages(`repos/${repo}/issues/${number}/comments?per_page=100`)
    .flat()
    .filter(
      (comment) =>
        comment.user?.login === 'cairnwright[bot]' &&
        comment.body.includes(`<!-- review-gate:${pr.head.sha} -->`),
    )
    .sort((a, b) => b.id - a.id)[0];
  if (
    !verdict ||
    !new RegExp(
      `^<!-- review-gate:${pr.head.sha} -->\\n\\*\\*Independent review gate: PASS\\*\\*(?: \\(carried over\\))? for `,
    ).test(verdict.body)
  )
    reasons.push('review-not-pass');
  const today = new Date().toISOString().slice(0, 10);
  let merged = 0;
  for (let page = 1; ; page++) {
    const closed = api(
      `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
    for (const pull of closed) {
      if (pull.updated_at.slice(0, 10) < today) break;
      if (batchHead.test(pull.head.ref) && pull.merged_at?.slice(0, 10) === today) merged++;
    }
    if (closed.length < 100 || closed.some((pull) => pull.updated_at.slice(0, 10) < today)) break;
  }
  if (merged >= dailyCap) reasons.push('daily-cap');
  if (markers().length) reasons.push('autonomy-paused');
  return { pr, reasons };
}

try {
  let dailyCap = 10;
  let dryRun = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--daily-cap' && /^\d+$/.test(args[i + 1] ?? '')) {
      dailyCap = Number(args[++i]);
      if (!Number.isSafeInteger(dailyCap)) throw new Error('Invalid daily cap');
    } else throw new Error('Expected --dry-run or --daily-cap <integer>');
  }
  const pulls = pages(`repos/${repo}/pulls?state=open&per_page=100`)
    .flat()
    .filter((pr) => batchHead.test(pr.head.ref) && pr.head.repo?.full_name === repo);
  const blocked = new Set();
  for (const pr of pulls) {
    if (!pr.auto_merge) continue;
    try {
      if (!dryRun) disarmAutoMerge(pr);
      log(pr, dryRun ? 'would-disarm' : 'disarmed', []);
    } catch (error) {
      blocked.add(pr.number);
      log(pr, 'error', [error.message]);
      process.exitCode = 1;
    }
  }
  let attempted = false;
  for (const candidate of pulls) {
    if (blocked.has(candidate.number)) continue;
    try {
      if (attempted) {
        log(candidate, 'skip', ['one-merge-per-pass']);
        continue;
      }
      let result = eligibility(candidate.number, candidate.head.sha, dailyCap);
      if (result.reasons.length) {
        log(result.pr, 'skip', result.reasons);
        continue;
      }
      const commits = pages(`repos/${repo}/pulls/${candidate.number}/commits?per_page=100`).flat();
      if (commits.at(-1)?.sha !== candidate.head.sha) throw new Error('Commit list head mismatch');
      const body = commits
        .map((commit) => commit.commit.message.split('\n').slice(1).join('\n').trim())
        .filter(Boolean)
        .join('\n\n');
      result = eligibility(candidate.number, candidate.head.sha, dailyCap);
      if (result.reasons.length) {
        log(result.pr, 'skip', result.reasons);
        continue;
      }
      if (result.pr.auto_merge && !dryRun) {
        disarmAutoMerge(result.pr);
        log(result.pr, 'disarmed', []);
        log(result.pr, 'skip', ['auto-merge-rearmed']);
        continue;
      }
      let ownerReasons;
      try {
        ownerReasons = ownerRouting(result.pr.head.sha);
      } catch (error) {
        log(result.pr, 'owner-routing-unavailable', [error.message]);
        continue;
      }
      if (ownerReasons.length) {
        log(result.pr, 'owner-route', ownerReasons);
        continue;
      }
      attempted = true;
      if (!dryRun)
        execFileSync(
          'gh',
          [
            'pr',
            'merge',
            String(candidate.number),
            '--repo',
            repo,
            '--squash',
            '--match-head-commit',
            result.pr.head.sha,
            '--subject',
            `${result.pr.title} (#${candidate.number})`,
            '--body',
            body,
          ],
          { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
        );
      log(result.pr, dryRun ? 'would-merge' : 'merged', []);
    } catch (error) {
      log(candidate, 'error', [error.message]);
      process.exitCode = 1;
    }
  }
} catch (error) {
  log(null, 'error', [error.message]);
  process.exitCode = 1;
}
