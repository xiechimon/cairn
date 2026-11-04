import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { summarizeAttribution } from './trajectory-attribution.js';

try {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new SyntaxError('Use <packs.jsonl> [<packs.jsonl> ...]');
  const lines = files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== ''),
  );
  process.stdout.write(summarizeAttribution(lines));
} catch (error) {
  const reason =
    error instanceof ZodError
      ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
      : error instanceof SyntaxError
        ? 'Invalid JSONL input or arguments'
        : 'Input I/O failed';
  console.error(`Attribution summary failed: ${reason}`);
  process.exitCode = 1;
}
