#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rebaseOwnerLane } from './rebase-equivalence.mjs';

export function classifyExtraPreflightRound({ prev, cur }) {
  if (prev.conclusion !== 'success') return 'red';
  if (prev.patchKey && cur.patchKey && prev.patchKey === cur.patchKey) return 'rebase-only';
  return 'review-fix';
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

export function summarizeRework(landings) {
  const counts = { red: 0, 'rebase-only': 0, 'review-fix': 0 };
  const wasted = { red: 0, 'rebase-only': 0, 'review-fix': 0 };
  const byLane = new Map();
  const rounds = [];
  let totalPreflightRuns = 0;

  for (const landing of landings) {
    const runs = landing.runs ?? [];
    if (runs.length === 0) continue;
    rounds.push(runs.length);
    totalPreflightRuns += runs.length;

    const laneKey = landing.lane ?? 'unknown';
    const laneEntry = byLane.get(laneKey) ?? {
      lane: laneKey,
      landings: 0,
      totalRuns: 0,
      extraRounds: 0,
      red: 0,
      'rebase-only': 0,
      'review-fix': 0,
    };
    laneEntry.landings += 1;
    laneEntry.totalRuns += runs.length;

    for (let i = 1; i < runs.length; i += 1) {
      const prev = runs[i - 1];
      const cur = runs[i];
      const cause = classifyExtraPreflightRound({ prev, cur });
      counts[cause] += 1;
      wasted[cause] += Math.round(
        cause === 'red' ? (prev.durationMinutes ?? 0) : (cur.durationMinutes ?? 0),
      );
      laneEntry.extraRounds += 1;
      laneEntry[cause] += 1;
    }
    byLane.set(laneKey, laneEntry);
  }

  rounds.sort((a, b) => a - b);
  const extraRounds = counts.red + counts['rebase-only'] + counts['review-fix'];
  const pct = (n) => (extraRounds > 0 ? Math.round((n / extraRounds) * 100) : 0);
  const causes = {
    red: { count: counts.red, pct: pct(counts.red), wastedMinutes: wasted.red },
    'rebase-only': {
      count: counts['rebase-only'],
      pct: pct(counts['rebase-only']),
      wastedMinutes: wasted['rebase-only'],
    },
    'review-fix': {
      count: counts['review-fix'],
      pct: pct(counts['review-fix']),
      wastedMinutes: wasted['review-fix'],
    },
  };
  const topLanes = [...byLane.values()]
    .sort((a, b) => b.totalRuns - a.totalRuns || b.extraRounds - a.extraRounds)
    .slice(0, 15);

  return {
    landingCount: landings.length,
    matchedLandings: rounds.length,
    totalPreflightRuns,
    roundsP50: percentile(rounds, 0.5),
    roundsP90: percentile(rounds, 0.9),
    roundsMax: rounds.at(-1) ?? 0,
    roundsMean: rounds.length > 0 ? Number((totalPreflightRuns / rounds.length).toFixed(2)) : 0,
    extraRounds,
    causes,
    topLanes,
  };
}

export function subjectsMatch(commitSubject, runTitle) {
  if (!commitSubject || !runTitle) return false;
  if (commitSubject === runTitle) return true;
  if (runTitle.endsWith('…')) {
    return commitSubject.startsWith(runTitle.slice(0, -1));
  }
  return false;
}

export function parseArgs(argv) {
  let limit = 40;
  let repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') {
      limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--repo') {
      repo = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      json = true;
    }
  }
  return { limit, repo, json };
}

function durationMinutes(createdAt, updatedAt) {
  if (!createdAt || !updatedAt) return 0;
  return Math.max(0, (Date.parse(updatedAt) - Date.parse(createdAt)) / 60_000);
}

function collectLiveRework({ repo, limit }) {
  execFileSync('git', ['fetch', '-q', 'origin', 'main'], { stdio: 'ignore' });
  const pushes = JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/activity?ref=refs/heads/main&per_page=${limit}`], {
      encoding: 'utf8',
    }),
  );
  const runs = JSON.parse(
    execFileSync(
      'gh',
      [
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        'ci.yml',
        '--limit',
        '400',
        '--json',
        'databaseId,headBranch,headSha,conclusion,status,createdAt,updatedAt,displayTitle',
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ),
  ).filter(
    (run) =>
      run.status === 'completed' &&
      typeof run.headBranch === 'string' &&
      run.headBranch.startsWith('preflight/'),
  );

  const commits = [];
  for (const push of pushes) {
    let raw = '';
    try {
      raw = execFileSync(
        'git',
        ['log', '--reverse', '--format=%H%x1f%s%x1f%B%x1e', `${push.before}..${push.after}`],
        { encoding: 'utf8' },
      );
    } catch {
      continue;
    }
    for (const entry of raw.split('\x1e')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const [sha, subject, body] = trimmed.split('\x1f');
      const lane = rebaseOwnerLane(body ?? '');
      commits.push({ sha, subject, lane, landedAt: push.timestamp });
    }
  }

  const patchCache = new Map();
  const patchKeyOf = (sha) => {
    if (patchCache.has(sha)) return patchCache.get(sha);
    try {
      const files = JSON.parse(
        execFileSync(
          'gh',
          [
            'api',
            `repos/${repo}/commits/${sha}`,
            '--jq',
            '[.files[] | {f: .filename, s: .status, p: (.patch // "")}]',
          ],
          { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        ),
      );
      const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
      patchCache.set(sha, digest);
      return digest;
    } catch {
      patchCache.set(sha, null);
      return null;
    }
  };

  commits.sort((a, b) => Date.parse(a.landedAt) - Date.parse(b.landedAt));
  const lastMatchedAt = new Map();
  const landings = [];

  for (const commit of commits) {
    if (!commit.lane) {
      landings.push({ ...commit, runs: [] });
      continue;
    }
    const branch = `preflight/${commit.lane}`;
    const groupKey = `${branch}\0${commit.subject}`;
    const prevAt = lastMatchedAt.get(groupKey) ?? 0;
    const endAt = Date.parse(commit.landedAt);
    const matched = runs
      .filter(
        (run) =>
          run.headBranch === branch &&
          subjectsMatch(commit.subject, run.displayTitle) &&
          Date.parse(run.createdAt) > prevAt &&
          Date.parse(run.createdAt) <= endAt,
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((run) => ({
        databaseId: run.databaseId,
        headSha: run.headSha,
        conclusion: run.conclusion,
        createdAt: run.createdAt,
        durationMinutes: durationMinutes(run.createdAt, run.updatedAt),
        patchKey: null,
      }));
    if (matched.length > 0) {
      lastMatchedAt.set(groupKey, endAt);
      for (let i = 1; i < matched.length; i += 1) {
        if (matched[i - 1].conclusion === 'success') {
          matched[i - 1].patchKey = patchKeyOf(matched[i - 1].headSha);
          matched[i].patchKey = patchKeyOf(matched[i].headSha);
        }
      }
    }
    landings.push({ ...commit, runs: matched });
  }

  return { landings, summary: summarizeRework(landings) };
}

function formatSummary(summary) {
  const lines = [
    `landings=${summary.landingCount} matched=${summary.matchedLandings} preflightRuns=${summary.totalPreflightRuns} rounds: p50=${summary.roundsP50} p90=${summary.roundsP90} max=${summary.roundsMax} mean=${summary.roundsMean}`,
    `extraRounds=${summary.extraRounds}: red=${summary.causes.red.count} (${summary.causes.red.pct}%, ${summary.causes.red.wastedMinutes}m), rebase-only=${summary.causes['rebase-only'].count} (${summary.causes['rebase-only'].pct}%, ${summary.causes['rebase-only'].wastedMinutes}m), review-fix=${summary.causes['review-fix'].count} (${summary.causes['review-fix'].pct}%, ${summary.causes['review-fix'].wastedMinutes}m)`,
  ];
  for (const lane of summary.topLanes.slice(0, 8)) {
    lines.push(
      `  ${lane.lane}: landings=${lane.landings} runs=${lane.totalRuns} extra=${lane.extraRounds} (red=${lane.red}, rebase-only=${lane['rebase-only']}, review-fix=${lane['review-fix']})`,
    );
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { limit, repo, json } = parseArgs(process.argv.slice(2));
  const result = collectLiveRework({ repo, limit });
  if (json) {
    console.log(JSON.stringify(result.summary, null, 2));
  } else {
    console.log(formatSummary(result.summary));
  }
}
