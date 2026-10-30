import { execFileSync } from 'node:child_process';
import { api, disarmAutoMerge, markers, pages, repo } from './autonomy-brake.mjs';

const batchHead = /^B\d+\//;
const requiredChecks = ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence'];
const log = (pr, action, reasons) =>
  console.log(
    JSON.stringify({ pr: pr?.number ?? null, head: pr?.head?.sha ?? null, action, reasons }),
  );

function eligibility(number, expectedHead, dailyCap) {
  const pr = api(`repos/${repo}/pulls/${number}`);
  const reasons = [];
  if (pr.state !== 'open') reasons.push('not-open');
  if (!batchHead.test(pr.head.ref)) reasons.push('not-batch');
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
    !/^\*\*Independent review gate: PASS\*\*(?: \(carried over\))? for /m.test(verdict.body)
  )
    reasons.push('review-not-pass');
  const today = new Date().toISOString().slice(0, 10);
  const search = pages(
    `search/issues?q=${encodeURIComponent(`repo:${repo} is:pr is:merged merged:${today}`)}&per_page=100`,
  );
  const items = search.flatMap((page) => page.items);
  if (search.some((page) => page.incomplete_results || page.total_count !== items.length))
    throw new Error('Incomplete daily merge search');
  const merged = items
    .map((item) => api(`repos/${repo}/pulls/${item.number}`))
    .filter((pull) => batchHead.test(pull.head.ref) && pull.merged_at?.slice(0, 10) === today);
  if (merged.length >= dailyCap) reasons.push('daily-cap');
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
    .filter((pr) => batchHead.test(pr.head.ref));
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
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
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
