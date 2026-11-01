import { execFileSync } from 'node:child_process';
import { api, disarmAutoMerge, markers, pages, repo } from './autonomy-brake.mjs';
import { requiredChecks as branchProtectionChecks, mustBeGreenJobs } from './merge-checks.mjs';
import { ownerRouting } from './merge-route.mjs';

const batchHead = /^B\d+\//;
const queueCommand = '@mergifyio queue';
const queueMarker = (sha) => `<!-- batch-merger-queued:${sha} -->`;
const queueRequest = new RegExp(`^${queueCommand}\\n<!-- batch-merger-queued:[a-f0-9]{40} -->$`);
const requiredChecks = branchProtectionChecks;
const ownerRouteLabel = 'owner-route';
const log = (pr, action, reasons) =>
  console.log(
    JSON.stringify({ pr: pr?.number ?? null, head: pr?.head?.sha ?? null, action, reasons }),
  );

function markOwnerRoute(pr, reasons, dryRun) {
  const marker = `<!-- batch-merger-owner-route:${pr.head.sha} -->`;
  const commented = pages(`repos/${repo}/issues/${pr.number}/comments?per_page=100`)
    .flat()
    .some((comment) => comment.body.startsWith(marker));
  const labelled = pr.labels.some((label) => label.name === ownerRouteLabel);
  if (commented && labelled) return;
  if (dryRun) {
    log(pr, 'would-mark-owner-route', reasons);
    return;
  }
  if (!commented)
    api(`repos/${repo}/issues/${pr.number}/comments`, {
      body: `${marker}\n**Batch merger: owner route** for \`${pr.head.sha.slice(0, 8)}\`. This PR needs the owner:\n\n${reasons.map((reason) => `- ${reason}`).join('\n')}`,
    });
  if (!labelled) api(`repos/${repo}/issues/${pr.number}/labels`, { labels: [ownerRouteLabel] });
  log(pr, 'marked-owner-route', reasons);
}

function clearOwnerRoute(pr, dryRun) {
  if (!pr.labels.some((label) => label.name === ownerRouteLabel)) return;
  if (dryRun) {
    log(pr, 'would-unmark-owner-route', []);
    return;
  }
  execFileSync(
    'gh',
    ['api', '--method', 'DELETE', `repos/${repo}/issues/${pr.number}/labels/${ownerRouteLabel}`],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  log(pr, 'unmarked-owner-route', []);
}

function queueState(pr) {
  const requested = pages(`repos/${repo}/issues/${pr.number}/comments?per_page=100`)
    .flat()
    .some((comment) => comment.body === `${queueCommand}\n${queueMarker(pr.head.sha)}`);
  const labelled = (name) => pr.labels.some((label) => label.name === name);
  if (labelled('dequeued') && requested) return 'dequeued-needs-human';
  if (labelled('queued') || requested) return 'already-queued';
  return null;
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
  for (const name of mustBeGreenJobs) {
    const latest = runs
      .filter(
        (run) =>
          run.name === name && run.head_sha === pr.head.sha && run.app?.slug === 'github-actions',
      )
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== 'completed' || !['success', 'skipped'].includes(latest.conclusion))
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
  const queued = pages(`repos/${repo}/issues/comments?since=${today}T00:00:00Z&per_page=100`)
    .flat()
    .filter(
      (comment) => comment.created_at >= `${today}T00:00:00Z` && queueRequest.test(comment.body),
    ).length;
  if (queued >= dailyCap) reasons.push('daily-cap');
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
  for (const candidate of pulls) {
    if (blocked.has(candidate.number)) continue;
    try {
      let result = eligibility(candidate.number, candidate.head.sha, dailyCap);
      if (result.reasons.length) {
        log(result.pr, 'skip', result.reasons);
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
        markOwnerRoute(result.pr, ownerReasons, dryRun);
        continue;
      }
      const state = queueState(result.pr);
      if (state) {
        log(result.pr, 'skip', [state]);
        continue;
      }
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
      clearOwnerRoute(result.pr, dryRun);
      if (!dryRun)
        api(`repos/${repo}/issues/${candidate.number}/comments`, {
          body: `${queueCommand}\n${queueMarker(result.pr.head.sha)}`,
        });
      log(result.pr, dryRun ? 'would-queue' : 'queued', []);
    } catch (error) {
      log(candidate, 'error', [error.message]);
      process.exitCode = 1;
    }
  }
} catch (error) {
  log(null, 'error', [error.message]);
  process.exitCode = 1;
}
