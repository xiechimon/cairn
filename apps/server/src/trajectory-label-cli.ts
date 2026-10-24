import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { ZodError } from 'zod';
import { AttributionError, labelPacks } from './trajectory-attribution.js';

const USAGE = 'Use --in <packs.jsonl> --out <labeled.jsonl> --model <id>';

try {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
    },
  });
  if (!values.in || !values.out || !values.model) throw new AttributionError(USAGE);
  const baseUrl = process.env.CAIRN_LABELER_BASE_URL;
  const apiKey = process.env.CAIRN_LABELER_API_KEY;
  if (!baseUrl || !apiKey)
    throw new AttributionError('Set CAIRN_LABELER_BASE_URL and CAIRN_LABELER_API_KEY');
  const lines = readFileSync(values.in, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const result = await labelPacks(lines, {
    model: values.model,
    endpoint: { baseUrl, apiKey },
    now: Date.now,
  });
  writeFileSync(values.out, result.lines.length ? `${result.lines.join('\n')}\n` : '', {
    flag: 'wx',
    mode: 0o600,
  });
  const { labeled, alreadyLabeled, notFailed } = result.summary;
  console.log(
    `labeled=${labeled} already_labeled=${alreadyLabeled} not_failed=${notFailed} out=${redactSecrets(values.out).value}`,
  );
} catch (error) {
  const reason =
    error instanceof AttributionError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid JSONL input'
          : 'Invalid arguments or input/output I/O failed';
  console.error(`Trajectory labeling failed: ${reason}`);
  process.exitCode = 1;
}
