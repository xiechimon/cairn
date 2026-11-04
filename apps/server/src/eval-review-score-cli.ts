import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildLabelerTrust,
  buildWeekArtifact,
  formatDimensionLine,
  loadWeekInput,
  scoreReviewWeeks,
  type WeekInput,
  writeLabelerTrust,
  writeWeekArtifact,
} from './eval-review-score.js';

class UsageError extends Error {}

function resolveFromCaller(path: string): string {
  if (isAbsolute(path)) return path;
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, path);
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      reviews: { type: 'string' },
      trust: { type: 'string' },
      out: { type: 'string' },
      week: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(
      [
        'Usage: pnpm eval:review-score --reviews <dir> [--week <ISO-week>]... [--trust <path>] [--out <dir>]',
        'Each week directory must contain review-<week>.jsonl and answers-<week>.json.',
        'Writes labeler-trust.json and per-week score-<week>.json (ids and labels only).',
      ].join('\n'),
    );
    process.stdout.write('\n');
    process.exit(0);
  }

  const reviewsDir = values.reviews;
  if (reviewsDir === undefined || reviewsDir === '') {
    throw new UsageError('--reviews <dir> is required');
  }

  const weeks = values.week ?? [];
  if (weeks.length === 0 && positionals.length === 0) {
    throw new UsageError('Pass at least one --week <ISO-week>');
  }
  const weekIds = [...weeks, ...positionals];
  const inputs: WeekInput[] = weekIds.map((week) =>
    loadWeekInput(resolveFromCaller(reviewsDir), week),
  );
  const score = scoreReviewWeeks(inputs);
  const trust = buildLabelerTrust(score);

  const trustPath = resolveFromCaller(
    values.trust ?? '.claude/hillclimb/attribution/labeler-trust.json',
  );
  writeLabelerTrust(trustPath, trust);

  const outDir = resolveFromCaller(values.out ?? '.claude/hillclimb/attribution/reviews');
  for (const input of inputs) {
    const weekScore = scoreReviewWeeks([input]);
    writeWeekArtifact(outDir, buildWeekArtifact(input, weekScore));
  }

  process.stdout.write(`${formatDimensionLine('where', score.where)}\n`);
  process.stdout.write(`${formatDimensionLine('why', score.why)}\n`);
  process.stdout.write(`${JSON.stringify(trust, null, 2)}\n`);
  process.stdout.write(`wrote ${trustPath}\n`);
} catch (error) {
  const message =
    error instanceof UsageError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unknown failure';
  console.error(`eval:review-score failed: ${message}`);
  process.exitCode = 1;
}
