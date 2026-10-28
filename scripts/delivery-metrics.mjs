#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY_MS = 86400000;
const FAILURE_WINDOW_DAYS = 7;
const MAIN_RED_WORKFLOW = 'ci.yml';
const MAIN_RED_EVENT = 'push';
const PR_PAGE_SIZE = 50;
const RUN_PAGE_SIZE = 100;
const MAX_PAGES = 20;

export const BOT_LOGIN_ALLOWLIST = new Set([
  'cairnwright',
  'cairnwright[bot]',
  'claude',
  'claude[bot]',
  'github-actions',
  'github-actions[bot]',
  'dependabot',
  'dependabot[bot]',
  'copilot-sweeper-agent',
  'copilot-pull-request-robot',
  'cursoragent',
  'cursor[bot]',
]);

export function isBot(actor) {
  if (!actor) return false;
  if (typeof actor === 'string') return botLogin(actor);
  if (actor.type === 'Bot') return true;
  const login = actor.login;
  if (login) return botLogin(login);
  if (actor.name)
    return (
      BOT_LOGIN_ALLOWLIST.has(actor.name.toLowerCase()) ||
      actor.name.toLowerCase().endsWith('[bot]')
    );
  return false;
}

const botLogin = (login) => {
  const normalized = login.toLowerCase();
  if (BOT_LOGIN_ALLOWLIST.has(normalized)) return true;
  if (normalized.startsWith('app/')) return true;
  return normalized.endsWith('[bot]');
};

export function isoWeek(date) {
  const day = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const toDate = (value) =>
  value instanceof Date ? value : value === null || value === undefined ? null : new Date(value);

const minutesBetween = (from, to) => (to - from) / 60000;

const instant = (value) => {
  if (value === null || value === undefined) return null;
  const time = toDate(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export function mainRed(runs, now) {
  const cap = now.getTime();
  const windowStart = cap - 7 * DAY_MS;
  const failures = runs
    .filter((run) => run.conclusion === 'failure')
    .map((run) => instant(run.startedAt))
    .filter((start) => start !== null && start <= cap)
    .sort((a, b) => a - b);
  const greens = runs
    .filter((run) => run.conclusion === 'success')
    .map((run) => ({ start: instant(run.startedAt), end: instant(run.completedAt) }))
    .filter((run) => run.start !== null && run.end !== null && run.end >= run.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const start of failures) {
    const green = greens.find((candidate) => candidate.start >= start);
    const interval = green
      ? { start, end: green.end, open: false }
      : { start, end: cap, open: true };
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      if (interval.end >= last.end) {
        last.end = interval.end;
        last.open = interval.open;
      }
    } else merged.push(interval);
  }
  let openMs = 0;
  let intervals = 0;
  const recoveries = [];
  let stillRed = false;
  for (const interval of merged) {
    const clippedStart = Math.max(interval.start, windowStart);
    const clippedEnd = Math.min(interval.end, cap);
    if (clippedEnd <= clippedStart) continue;
    intervals += 1;
    openMs += clippedEnd - clippedStart;
    if (interval.open) stillRed = true;
    else recoveries.push(minutesBetween(interval.start, interval.end));
  }
  return {
    minutes: Math.max(0, Math.round(openMs / 60000)),
    intervals,
    recovered: recoveries.length,
    medianRecoveryMinutes: median(recoveries),
    stillRed,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  }
  const value = (sorted[middle - 1] + sorted[middle]) / 2;
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

const actorOf = (entry) =>
  entry
    ? {
        login: entry.login ?? null,
        type: entry.type ?? null,
        ...(entry.name ? { name: entry.name } : {}),
      }
    : null;

function hasHumanCommit(pr) {
  return pr.commitAuthors.some((author) => !isBot(author));
}

function hasHumanChangesRequested(pr) {
  return pr.reviews.some((review) => review.state === 'CHANGES_REQUESTED' && !isBot(review.author));
}

function hasHumanMerge(pr) {
  return !pr.autoMerge && pr.mergedBy !== null && !isBot(pr.mergedBy);
}

export function humanIntervention(prs) {
  const merged = prs.filter((pr) => pr.mergedAt !== null);
  const byHumanCommit = merged.filter(hasHumanCommit).length;
  const byChangesRequested = merged.filter(hasHumanChangesRequested).length;
  const byHumanMerge = merged.filter(hasHumanMerge).length;
  const intervened = merged.filter(
    (pr) => hasHumanCommit(pr) || hasHumanChangesRequested(pr) || hasHumanMerge(pr),
  ).length;
  return {
    prs: merged.length,
    intervened,
    rate: merged.length === 0 ? null : intervened / merged.length,
    byHumanCommit,
    byChangesRequested,
    byHumanMerge,
  };
}

function usageSummary(prs, ledger, field) {
  const known = [];
  let missing = 0;
  for (const pr of prs) {
    const value = (ledger[String(pr.number)] ?? ledger[pr.number])?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) known.push(value);
    else missing += 1;
  }
  const total = known.reduce((sum, value) => sum + value, 0);
  return {
    prs: prs.length,
    known: known.length,
    missing,
    total,
    mean: known.length === 0 ? null : Math.round((total / known.length) * 100) / 100,
  };
}

export function computeMetrics({ prs, runs, ledger = {}, now, incompleteReasons = [] }) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const seen = new Set();
  const unique = [];
  for (const pr of prs) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    unique.push(pr);
  }
  const weekPrs = unique.filter((pr) => {
    if (pr.mergedAt === null) return false;
    const merged = toDate(pr.mergedAt);
    return merged <= nowDate && merged.getTime() > nowDate.getTime() - 7 * DAY_MS;
  });

  const autonomous = weekPrs.filter((pr) => pr.autoMerge || isBot(pr.mergedBy)).length;
  const leadMinutes = weekPrs
    .map((pr) => minutesBetween(toDate(pr.createdAt).getTime(), toDate(pr.mergedAt).getTime()))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);

  const cohortEnd = new Date(nowDate.getTime() - FAILURE_WINDOW_DAYS * DAY_MS);
  const cohortStart = new Date(cohortEnd.getTime() - 7 * DAY_MS);
  const cohort = unique.filter((pr) => {
    if (pr.mergedAt === null) return false;
    const merged = toDate(pr.mergedAt);
    return merged >= cohortStart && merged < cohortEnd;
  });
  const known = [];
  let missing = 0;
  let failed = 0;
  for (const pr of cohort) {
    const entry = ledger[String(pr.number)] ?? ledger[pr.number];
    const reverted = entry?.revertedWithin7d;
    const fixed = entry?.fixedByLaterPr;
    if (typeof reverted !== 'boolean' && typeof fixed !== 'boolean') {
      missing += 1;
      continue;
    }
    known.push(pr);
    if (reverted === true || fixed === true) failed += 1;
  }

  return {
    week: isoWeek(nowDate),
    throughput: { merged: weekPrs.length, autonomous, human: weekPrs.length - autonomous },
    leadTime: { sample: leadMinutes.length, medianMinutes: median(leadMinutes) },
    changeFailure: {
      cohortStart: cohortStart.toISOString(),
      cohortEnd: cohortEnd.toISOString(),
      cohort: cohort.length,
      known: known.length,
      missing,
      failed,
      rate: known.length === 0 ? null : failed / known.length,
    },
    mainRed: mainRed(runs, nowDate),
    humanIntervention: humanIntervention(weekPrs),
    tokens: usageSummary(weekPrs, ledger, 'tokens'),
    costUsd: usageSummary(weekPrs, ledger, 'costUsd'),
    complete: incompleteReasons.length === 0,
    incompleteReasons,
  };
}

function formatDuration(minutes) {
  if (minutes === null) return 'no data';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}

function formatRate(rate) {
  if (rate === null) return 'no data';
  return `${(rate * 100).toFixed(1)}%`;
}

export function renderReport(metrics) {
  const lines = [];
  lines.push(`# Delivery metrics ${metrics.week}`);
  lines.push('');
  lines.push('DORA-aligned delivery metrics for the autonomous merge loop (spec 28 §6, #1758).');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(
    `| Merged PRs | ${metrics.throughput.merged} (${metrics.throughput.autonomous} autonomous, ${metrics.throughput.human} human) |`,
  );
  lines.push(`| Median PR open to merge | ${formatDuration(metrics.leadTime.medianMinutes)} |`);
  const failure = metrics.changeFailure;
  lines.push(
    `| Change failure rate | ${failure.rate === null ? 'no data' : formatRate(failure.rate)} (${failure.failed} of ${failure.known} known, ${failure.missing} missing) |`,
  );
  lines.push(
    `| Main red | ${formatDuration(metrics.mainRed.minutes)} over ${metrics.mainRed.intervals} ${metrics.mainRed.intervals === 1 ? 'interval' : 'intervals'}, median recovery ${formatDuration(metrics.mainRed.medianRecoveryMinutes)}${metrics.mainRed.stillRed ? ', still red at report time' : ''} |`,
  );
  lines.push(
    `| Human intervention | ${formatRate(metrics.humanIntervention.rate)} (${metrics.humanIntervention.intervened} of ${metrics.humanIntervention.prs}) |`,
  );
  lines.push(
    `| Tokens per merged PR | ${metrics.tokens.mean === null ? 'missing data' : metrics.tokens.mean} (known ${metrics.tokens.known}, missing data ${metrics.tokens.missing}) |`,
  );
  lines.push(
    `| Cost per merged PR | ${metrics.costUsd.mean === null ? 'missing data' : `$${metrics.costUsd.mean}`} (known ${metrics.costUsd.known}, missing data ${metrics.costUsd.missing}) |`,
  );
  if (!metrics.complete) {
    lines.push('');
    lines.push(`Incomplete: ${metrics.incompleteReasons.join('; ')}`);
  }
  return lines.join('\n');
}

const PR_SEARCH_FIELDS = `
  number
  createdAt
  mergedAt
  author { login ... on Bot { __typename } }
  mergedBy { login ... on Bot { __typename } }
  autoMergeRequest { enabledAt }
  commits(last: 100) { nodes { commit { authors(first: 10) { nodes { name user { login } } } } } }
  reviews(first: 20, states: CHANGES_REQUESTED) { nodes { state author { login ... on Bot { __typename } } } }
`;

const isRateLimit = (error) => /rate limit/i.test(String(error?.message ?? error));

export function fetchPrs({ repo, now, gh }) {
  const windowStart = new Date(now.getTime() - 14 * DAY_MS).toISOString().slice(0, 10);
  const query = `repo:${repo} is:pr is:merged merged:>=${windowStart}`;
  const prs = [];
  const reasons = [];
  let cursor = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let json;
    try {
      json = JSON.parse(
        gh([
          'api',
          'graphql',
          '-f',
          `query=query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PR_PAGE_SIZE}, after: $after) {
    nodes { ... on PullRequest { ${PR_SEARCH_FIELDS} } }
    pageInfo { hasNextPage endCursor }
  }
}`,
          '-f',
          `q=${query}`,
          ...(cursor ? ['-f', `after=${cursor}`] : []),
        ]),
      );
    } catch (error) {
      if (isRateLimit(error)) {
        reasons.push(`pull requests: ${String(error.message).slice(0, 200)}`);
        return { prs, reasons };
      }
      throw error;
    }
    const search = json?.data?.search;
    for (const node of search?.nodes ?? []) {
      if (!node?.number) continue;
      const commits = node.commits?.nodes ?? [];
      prs.push({
        number: node.number,
        title: node.title ?? null,
        createdAt: node.createdAt,
        mergedAt: node.mergedAt,
        author: actorOf(
          node.author ? { login: node.author.login, type: node.author.__typename } : null,
        ),
        mergedBy: actorOf(
          node.mergedBy ? { login: node.mergedBy.login, type: node.mergedBy.__typename } : null,
        ),
        autoMerge: node.autoMergeRequest !== null && node.autoMergeRequest !== undefined,
        commitAuthors: commits.flatMap((slot) =>
          (slot.commit?.authors?.nodes ?? []).map((author) => ({
            login: author.user?.login ?? null,
            name: author.name ?? null,
          })),
        ),
        reviews: (node.reviews?.nodes ?? []).map((review) => ({
          state: review.state,
          author: actorOf(
            review.author ? { login: review.author.login, type: review.author.__typename } : null,
          ),
        })),
      });
    }
    if (!search?.pageInfo?.hasNextPage) {
      truncated = false;
      break;
    }
    truncated = true;
    cursor = search.pageInfo.endCursor;
  }
  if (truncated) reasons.push('pull requests: stopped after 20 pages; results are incomplete');
  return { prs, reasons };
}

export const REQUIRED_MAIN_CHECKS = ['check', 'pack-smoke', 'e2e-gate'];
const RED_JOB_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

export function requiredCheckRun(jobs) {
  const byName = new Map();
  for (const job of jobs) {
    if (REQUIRED_MAIN_CHECKS.includes(job.name)) byName.set(job.name, job);
  }
  const present = REQUIRED_MAIN_CHECKS.map((name) => byName.get(name)).filter(Boolean);
  const failed = present.filter((job) => RED_JOB_CONCLUSIONS.has(job.conclusion));
  const stamp = (conclusion, chosen) => {
    const starts = chosen
      .map((job) => job.started_at)
      .filter(Boolean)
      .sort();
    const ends = chosen
      .map((job) => job.completed_at)
      .filter(Boolean)
      .sort();
    if (starts.length === 0) return null;
    return { conclusion, startedAt: starts[0], completedAt: ends.at(-1) ?? null };
  };
  if (failed.length > 0) return stamp('failure', failed);
  if (
    REQUIRED_MAIN_CHECKS.some((name) => {
      const job = byName.get(name);
      return !job || job.conclusion == null || job.conclusion === 'cancelled';
    })
  )
    return null;
  const succeeded = present.filter((job) => job.conclusion === 'success');
  if (succeeded.length === 0) return null;
  const green = stamp('success', succeeded);
  if (green?.completedAt == null) return null;
  return green;
}

export function fetchMainRuns({ repo, now, gh }) {
  const runs = [];
  const reasons = [];
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const created = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  let page = 0;
  let seenOldGreen = false;
  let lastPageFull = false;
  while (page < MAX_PAGES && !seenOldGreen) {
    page += 1;
    let json;
    try {
      json = JSON.parse(
        gh([
          'api',
          `repos/${repo}/actions/workflows/${MAIN_RED_WORKFLOW}/runs?branch=main&event=${MAIN_RED_EVENT}&per_page=${RUN_PAGE_SIZE}&created=${encodeURIComponent(`>=${created}`)}${page > 1 ? `&page=${page}` : ''}`,
        ]),
      );
    } catch (error) {
      if (isRateLimit(error)) {
        reasons.push(`main runs: ${String(error.message).slice(0, 200)}`);
        return { runs, reasons };
      }
      throw error;
    }
    const batch = json.workflow_runs ?? [];
    lastPageFull = batch.length >= RUN_PAGE_SIZE;
    for (const run of batch) {
      if (run.id == null) continue;
      let jobsJson;
      try {
        jobsJson = JSON.parse(
          gh(['api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`]),
        );
      } catch (error) {
        if (isRateLimit(error)) {
          reasons.push(`main runs: ${String(error.message).slice(0, 200)}`);
          return { runs, reasons };
        }
        throw error;
      }
      const reduced = requiredCheckRun(jobsJson.jobs ?? []);
      if (run.updated_at < since && reduced?.conclusion === 'success') seenOldGreen = true;
      if (!reduced?.startedAt) continue;
      runs.push({
        conclusion: reduced.conclusion,
        startedAt: new Date(reduced.startedAt),
        completedAt: reduced.completedAt ? new Date(reduced.completedAt) : null,
      });
    }
    if (!lastPageFull) break;
  }
  if (lastPageFull && !seenOldGreen)
    reasons.push('main runs: stopped after 20 pages; results are incomplete');
  return { runs, reasons };
}

export function stripAnsi(text) {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

function ghText(args, input) {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.FORCE_COLOR;
  return stripAnsi(
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env,
      input,
    }),
  );
}

function repoSlug() {
  return ghText(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const argv = process.argv.slice(2);
    const option = (name) => {
      const at = argv.indexOf(name);
      return at === -1 ? undefined : argv[at + 1];
    };
    const now = new Date(option('--now') ?? Date.now());
    const outDir = option('--out');
    const repoArg = option('--repo');
    const fixturePath = option('--fixture');
    const ledgerPath = option('--ledger');
    const ticket = option('--ticket') ?? 1717;
    let prs;
    let runs;
    let reasons;
    let ledger = ledgerPath ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
    if (fixturePath) {
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
      prs = fixture.prs ?? [];
      runs = (fixture.runs ?? []).map((run) => ({
        conclusion: run.conclusion,
        startedAt: run.startedAt === null ? null : new Date(run.startedAt),
        completedAt: run.completedAt === null ? null : new Date(run.completedAt),
      }));
      ledger = fixture.ledger ?? ledger;
      reasons = fixture.incompleteReasons ?? [];
    } else {
      const repo = repoArg ?? repoSlug();
      const prResult = fetchPrs({ repo, now, gh: ghText });
      const runResult = fetchMainRuns({ repo, now, gh: ghText });
      prs = prResult.prs;
      runs = runResult.runs;
      reasons = [...prResult.reasons, ...runResult.reasons];
    }
    const metrics = computeMetrics({ prs, runs, ledger, now, incompleteReasons: reasons });
    const report = renderReport(metrics);
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${metrics.week}.json`), `${JSON.stringify(metrics, null, 2)}\n`);
      writeFileSync(join(outDir, `${metrics.week}.md`), report);
    }
    process.stdout.write(report);
    if (argv.includes('--comment') && !argv.includes('--dry-run'))
      ghText(
        ['issue', 'comment', String(ticket), '--repo', repoArg ?? repoSlug(), '--body-file', '-'],
        report,
      );
  } catch (error) {
    console.error(`delivery-metrics: ${error.message}`);
    process.exitCode = 2;
  }
}
