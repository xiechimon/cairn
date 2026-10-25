import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { parsePacks, pushPacks, resolveTarget, TrajectoryPushError } from './trajectory-push.js';

try {
  const { values, positionals: files } = parseArgs({
    options: { force: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (files.length === 0)
    throw new TrajectoryPushError('Use [--force] <packs.jsonl> [<packs.jsonl> ...]');
  const target = resolveTarget(process.env);
  const packs = files.flatMap((file) => parsePacks(readFileSync(file, 'utf8')));
  const result = await pushPacks(packs, target, {
    ledgerPath: join(loadConfig().dataDir, 'trajectory-pushes.jsonl'),
    force: values.force === true,
  });
  console.log(
    `pushed=${result.pushed} spans=${result.spans} redacted=${result.redacted} skipped_already_pushed=${result.skippedAlreadyPushed} endpoint=${target.url.origin}${target.url.pathname}`,
  );
} catch (error) {
  const reason =
    error instanceof TrajectoryPushError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid JSONL input'
          : 'Input I/O failed';
  console.error(`Trajectory push failed: ${reason}`);
  process.exitCode = 1;
}
