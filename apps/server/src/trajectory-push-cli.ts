import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { parsePacks, pushPacks, resolveTarget, TrajectoryPushError } from './trajectory-push.js';

try {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new TrajectoryPushError('Use <packs.jsonl> [<packs.jsonl> ...]');
  const target = resolveTarget(process.env);
  const packs = files.flatMap((file) => parsePacks(readFileSync(file, 'utf8')));
  const result = await pushPacks(packs, target);
  console.log(
    `pushed=${result.pushed} spans=${result.spans} redacted=${result.redacted} endpoint=${target.url.origin}${target.url.pathname}`,
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
