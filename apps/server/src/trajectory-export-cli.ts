import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { exportTrajectories, TrajectoryExportError } from './trajectory-export.js';

try {
  const { values } = parseArgs({
    options: {
      build: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (
    values.build !== undefined
      ? values.build === '' || values.since !== undefined || values.until !== undefined
      : values.since === undefined && values.until === undefined
  )
    throw new TrajectoryExportError('Use --build <buildId> or --since/--until <ISO timestamp>');
  const since = values.since === undefined ? undefined : Date.parse(values.since);
  const until = values.until === undefined ? undefined : Date.parse(values.until);
  if (
    (since !== undefined && !Number.isFinite(since)) ||
    (until !== undefined && !Number.isFinite(until)) ||
    (since !== undefined && until !== undefined && since > until)
  )
    throw new TrajectoryExportError('Invalid time range');
  const result = exportTrajectories(loadConfig(), {
    buildId: values.build,
    since,
    until,
    out: values.out,
  });
  const skipReasons = Object.entries(result.skipped).filter(([, count]) => count > 0);
  const skippedTotal = skipReasons.reduce((sum, [, count]) => sum + count, 0);
  const skippedSummary = skippedTotal
    ? `skipped=${skippedTotal} (${skipReasons.map(([reason, count]) => `${reason}=${count}`).join(', ')})`
    : 'skipped=0';
  console.log(
    `exported=${result.exported} redacted=${result.redacted} ${skippedSummary} out=${redactSecrets(result.out).value}`,
  );
} catch (error) {
  const reason =
    error instanceof TrajectoryExportError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid session JSON'
          : 'Invalid arguments or database/session/output I/O failed';
  console.error(`Trajectory export failed: ${reason}`);
  process.exitCode = 1;
}
