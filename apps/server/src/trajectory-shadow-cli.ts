import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { resolveTarget, TrajectoryPushError } from './trajectory-push.js';
import { parseLangfuseTarget, runShadow, TrajectoryShadowError } from './trajectory-shadow.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

try {
  const { values } = parseArgs({
    options: {
      'since-hours': { type: 'string', default: '2' },
      'settle-minutes': { type: 'string', default: '30' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const sinceHours = Number(values['since-hours']);
  const settleMinutes = Number(values['settle-minutes']);
  if (!(sinceHours > 0) || !(settleMinutes >= 0))
    throw new TrajectoryShadowError('Use [--since-hours <n>] [--settle-minutes <n>] [--dry-run]');
  const result = await runShadow(parseLangfuseTarget(process.env), resolveTarget(process.env), {
    now: Date.now(),
    sinceMs: sinceHours * HOUR_MS,
    settleMs: settleMinutes * MINUTE_MS,
    dryRun: values['dry-run'],
  });
  console.log(
    `units=${result.units} digests=${result.digests} skipped_already_digested=${result.skippedAlreadyDigested} cost_scores=${result.costScores} question_units=${result.questionUnits} dry_run=${values['dry-run']}`,
  );
} catch (error) {
  const reason =
    error instanceof TrajectoryShadowError || error instanceof TrajectoryPushError
      ? error.message
      : error instanceof ZodError
        ? `Unexpected Langfuse response at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : 'Unexpected failure';
  console.error(`Trajectory shadow failed: ${reason}`);
  process.exitCode = 1;
}
