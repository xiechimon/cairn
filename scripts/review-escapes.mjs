import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'xiechimon/cairn';
const ROOT = `repos/${REPO}`;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const PATHS = ['ai-only', 'human-only', 'mixed', 'unknown'];
const AI_REVIEWERS = new Set([
  'cairnwright[bot]',
  'chatgpt-codex-connector[bot]',
  'coderabbitai[bot]',
  'github-copilot[bot]',
]);

function request(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }),
  );
}

function pages(endpoint) {
  const records = [];
  const errors = [];
  for (let page = 1; ; page++) {
    try {
      const batch = request(`${endpoint}?per_page=100&page=${page}`);
      if (
        !Array.isArray(batch) ||
        batch.some((record) => !record || typeof record !== 'object' || Array.isArray(record))
      )
        throw new Error('Expected GitHub response records');
      records.push(...batch);
      if (batch.length < 100) break;
    } catch {
      errors.push({
        url: `https://api.github.com/${endpoint}?per_page=100&page=${page}`,
        reason: 'api-unavailable-or-invalid-response',
      });
      break;
    }
  }
  return { records, errors };
}

function beforeMerge(timestamp, mergedAt) {
  return Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) < Date.parse(mergedAt);
}

export function reportEscapes(traces) {
  if (!Array.isArray(traces)) throw new Error('Expected a resolved traces array');
  const reviews = new Map();
  const events = [];
  const excluded = [];
  const weeks = new Map();
  const seen = new Set();
  const totals = {
    qualifyingEvents: 0,
    unknownReviewEvents: 0,
    unresolvedEvents: 0,
    unavailableReviewEvents: 0,
    outsideWindowEvents: 0,
    duplicateEvents: 0,
  };
  for (const trace of traces) {
    const followUpTime = Date.parse(trace?.followUpTimestamp);
    const mergedTime = Date.parse(trace?.introducingMergedAt);
    const key = `${trace?.originalPr}:${trace?.followUpSha}`;
    if (seen.has(key)) {
      totals.duplicateEvents++;
      continue;
    }
    seen.add(key);
    const event = {
      ...trace,
      originalPrUrl: Number.isInteger(trace?.originalPr)
        ? `https://github.com/${REPO}/pull/${trace.originalPr}`
        : null,
      followUpUrl: trace?.followUpSha
        ? `https://github.com/${REPO}/commit/${trace.followUpSha}`
        : null,
      introducingUrl: trace?.introducingSha
        ? `https://github.com/${REPO}/commit/${trace.introducingSha}`
        : null,
      attributionEvidence: trace?.evidence ?? {},
      review: null,
    };
    const resolved =
      trace?.status === 'resolved' &&
      Number.isInteger(trace.originalPr) &&
      trace.originalPr > 0 &&
      trace.introducingSha &&
      Number.isFinite(mergedTime) &&
      Number.isFinite(followUpTime);
    if (
      ['resolved', 'outside-window'].includes(trace?.status) &&
      Number.isFinite(mergedTime) &&
      Number.isFinite(followUpTime) &&
      (followUpTime < mergedTime || followUpTime - mergedTime > WINDOW_MS)
    ) {
      totals.outsideWindowEvents++;
      excluded.push({ ...event, exclusion: 'outside-14-day-window' });
      continue;
    }
    let week = 'unknown-date';
    if (Number.isFinite(followUpTime)) {
      const date = new Date(followUpTime);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      week = date.toISOString().slice(0, 10);
    }
    if (!weeks.has(week))
      weeks.set(week, {
        week,
        paths: Object.fromEntries(
          PATHS.map((path) => [path, { prs: new Set(), followUpEvents: 0 }]),
        ),
        unresolvedEvents: 0,
        unavailableReviewEvents: 0,
      });
    const group = weeks.get(week);
    if (!resolved) {
      totals.unresolvedEvents++;
      group.unresolvedEvents++;
      events.push({ ...event, week, reportStatus: 'unresolved' });
      continue;
    }
    if (!reviews.has(trace.originalPr)) {
      const number = trace.originalPr;
      const errors = [];
      let pull = null;
      try {
        pull = request(`${ROOT}/pulls/${number}`);
        if (
          pull.number !== number ||
          !Number.isFinite(Date.parse(pull.merged_at)) ||
          !/^[a-f0-9]{40}$/.test(pull.head?.sha ?? '')
        )
          throw new Error('Invalid PR metadata');
      } catch {
        errors.push({
          url: `https://api.github.com/${ROOT}/pulls/${number}`,
          reason: 'api-unavailable-or-invalid-response',
        });
      }
      const formal = pages(`${ROOT}/pulls/${number}/reviews`);
      const comments = pages(`${ROOT}/issues/${number}/comments`);
      errors.push(...formal.errors, ...comments.errors);
      const evidence = [];
      for (const review of formal.records) {
        if (
          !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state) ||
          !beforeMerge(review.submitted_at, pull?.merged_at) ||
          !/^[a-f0-9]{40}$/.test(review.commit_id ?? '') ||
          !review.html_url ||
          !review.user?.login
        )
          continue;
        const kind =
          AI_REVIEWERS.has(review.user.login) &&
          review.user.type === 'Bot' &&
          review.state === 'APPROVED'
            ? 'ai'
            : review.user.type === 'User'
              ? 'human'
              : null;
        if (kind)
          evidence.push({
            kind,
            source: 'pull-review',
            reviewer: review.user.login,
            url: review.html_url,
            timestamp: review.submitted_at,
            headSha: review.commit_id,
            matchesMergedHead: review.commit_id === pull?.head?.sha,
            verdict: review.state,
          });
      }
      const gates = comments.records.flatMap((comment) => {
        const mergedAt = pull?.merged_at;
        if (
          comment.user?.login !== 'cairnwright[bot]' ||
          comment.user.type !== 'Bot' ||
          comment.performed_via_github_app?.id !== 5462173 ||
          comment.performed_via_github_app?.slug !== 'cairnwright' ||
          !comment.html_url ||
          !beforeMerge(comment.created_at, mergedAt) ||
          !beforeMerge(comment.updated_at, mergedAt)
        )
          return [];
        const header =
          /^<!-- review-gate:([a-f0-9]{40}) -->\n\*\*Independent review gate: (PASS|BLOCK)\*\* (.+)\n/.exec(
            comment.body ?? '',
          );
        const patch = /\n<!-- review-gate-patch:([a-f0-9]{40}) -->\s*$/.exec(comment.body ?? '');
        if (!header || !patch) return [];
        const direct =
          header[3] ===
          `(separate model; gate weakening, eval gaming, correctness) for \`${header[1].slice(0, 8)}\`.`;
        const carry =
          /^\(carried over\) for `([a-f0-9]{8})`: same patch as the reviewed head `([a-f0-9]{8})`; only the base moved\.$/.exec(
            header[3],
          );
        if (!direct && !(carry && carry[1] === header[1].slice(0, 8) && header[2] === 'PASS'))
          return [];
        return [
          {
            comment,
            headSha: header[1],
            verdict: header[2],
            patch: patch[1],
            direct,
            basisHead: carry?.[2] ?? null,
          },
        ];
      });
      for (const gate of gates) {
        if (gate.headSha !== pull?.head?.sha) continue;
        const basis = gate.direct
          ? gate
          : gates.find(
              (item) =>
                item.direct &&
                item.verdict === 'PASS' &&
                item.headSha.startsWith(gate.basisHead) &&
                item.patch === gate.patch &&
                Date.parse(item.comment.updated_at) <= Date.parse(gate.comment.created_at),
            );
        if (!basis) continue;
        evidence.push({
          kind: 'ai',
          source: 'review-gate',
          reviewer: gate.comment.user.login,
          url: gate.comment.html_url,
          timestamp: gate.comment.updated_at,
          headSha: gate.headSha,
          verdict: gate.verdict,
          basisUrl: basis.comment.html_url,
          reviewedHeadSha: basis.headSha,
        });
      }
      const kinds = new Set(evidence.map((item) => item.kind));
      reviews.set(number, {
        path: errors.length
          ? 'unknown'
          : kinds.size === 2
            ? 'mixed'
            : kinds.has('ai')
              ? 'ai-only'
              : kinds.has('human')
                ? 'human-only'
                : 'unknown',
        evidence,
        data: errors.length ? 'unavailable' : 'available',
        errors,
        sources: [
          `https://api.github.com/${ROOT}/pulls/${number}/reviews`,
          `https://api.github.com/${ROOT}/issues/${number}/comments`,
        ],
        mergedAt: pull?.merged_at ?? null,
        mergedHeadSha: pull?.head?.sha ?? null,
      });
    }
    const review = reviews.get(trace.originalPr);
    const path = group.paths[review.path];
    path.prs.add(trace.originalPr);
    path.followUpEvents++;
    totals.qualifyingEvents++;
    if (review.path === 'unknown') totals.unknownReviewEvents++;
    if (review.data === 'unavailable') {
      totals.unavailableReviewEvents++;
      group.unavailableReviewEvents++;
    }
    events.push({ ...event, week, reportStatus: 'qualifying', review });
  }
  return {
    version: 1,
    windowDays: 14,
    limitations: [
      'Counts are candidate escapes from resolved attribution, not proof of a reviewer mistake.',
      'No escape rate is computed: the reviewed-PR denominator is not available.',
      'Review paths describe pre-merge evidence: formal human reviews may cover earlier PR commits; formal AI reviews require approval; production gates record PASS or BLOCK activity on the merged head.',
      'Unknown bots and unrecognized gate formats do not establish AI or human review; unavailable or partial API data yields unknown.',
      'Counts use distinct originating PRs per UTC Monday week/path; follow-up events are distinct PR/commit pairs.',
    ],
    totals,
    weeks: [...weeks.values()]
      .sort((a, b) => a.week.localeCompare(b.week))
      .map((week) => ({
        ...week,
        paths: Object.fromEntries(
          PATHS.map((path) => [
            path,
            {
              distinctPrs: week.paths[path].prs.size,
              followUpEvents: week.paths[path].followUpEvents,
            },
          ]),
        ),
      })),
    events,
    excluded,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    let tracesPath;
    let format = 'json';
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--traces') tracesPath = args[++index];
      else if (args[index] === '--format') format = args[++index];
      else throw new Error(`Unknown argument: ${args[index]}`);
    }
    if (!tracesPath || !['json', 'text'].includes(format))
      throw new Error('Usage: node scripts/review-escapes.mjs --traces path [--format json|text]');
    const report = reportEscapes(JSON.parse(readFileSync(tracesPath, 'utf8')));
    if (format === 'json') console.log(JSON.stringify(report, null, 2));
    else {
      const lines = ['Weekly review escapes (UTC Monday weeks)', ...report.limitations, ''];
      for (const week of report.weeks) {
        lines.push(week.week);
        for (const path of PATHS)
          lines.push(
            `  ${path}: ${week.paths[path].distinctPrs} PRs, ${week.paths[path].followUpEvents} follow-up events`,
          );
        lines.push(
          `  Unresolved attribution: ${week.unresolvedEvents}; unavailable review data: ${week.unavailableReviewEvents}`,
        );
      }
      lines.push(
        '',
        `Qualifying events: ${report.totals.qualifyingEvents}`,
        `Unknown review: ${report.totals.unknownReviewEvents}`,
        `Unresolved attribution: ${report.totals.unresolvedEvents}`,
        `Unavailable review data: ${report.totals.unavailableReviewEvents}`,
        `Outside 14 days: ${report.totals.outsideWindowEvents}`,
        `Duplicate events: ${report.totals.duplicateEvents}`,
        '',
        'Evidence',
      );
      for (const event of [...report.events, ...report.excluded]) {
        lines.push(
          `${event.originalPrUrl ?? 'Unresolved PR'} | ${event.followUpUrl ?? 'Unavailable follow-up'} | ${event.review?.path ?? event.reportStatus ?? event.exclusion}`,
          `  Attribution: ${event.method ?? 'unknown'} ${event.introducingUrl ?? ''} ${JSON.stringify(event.attributionEvidence)}`,
        );
        for (const evidence of event.review?.evidence ?? [])
          lines.push(
            `  ${evidence.reviewer} ${evidence.timestamp} ${evidence.headSha} ${evidence.url}${evidence.basisUrl ? ` basis: ${evidence.basisUrl}` : ''}`,
          );
        for (const error of event.review?.errors ?? [])
          lines.push(`  Unavailable: ${error.url} (${error.reason})`);
        if (event.review && !event.review.evidence.length)
          lines.push(`  Review sources: ${event.review.sources.join(' ')}`);
      }
      console.log(lines.join('\n'));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
