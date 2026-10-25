import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { ZodError } from 'zod';
import { ReflectError, reflectPacks } from './trajectory-reflect.js';

const USAGE = 'Use --in <packs.jsonl> --out <candidates.jsonl> --model <id>';

try {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
    },
  });
  if (!values.in || !values.out || !values.model) throw new ReflectError(USAGE);
  const baseUrl = process.env.CAIRN_REFLECTOR_BASE_URL;
  const apiKey = process.env.CAIRN_REFLECTOR_API_KEY;
  if (!baseUrl || !apiKey)
    throw new ReflectError('Set CAIRN_REFLECTOR_BASE_URL and CAIRN_REFLECTOR_API_KEY');
  const lines = readFileSync(values.in, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  const result = await reflectPacks(lines, {
    model: values.model,
    endpoint: { baseUrl, apiKey },
    now: Date.now,
  });
  writeFileSync(values.out, result.lines.length ? `${result.lines.join('\n')}\n` : '', {
    flag: 'wx',
    mode: 0o600,
  });
  const { reflected, notEligible, candidates, rejected } = result.summary;
  console.log(
    `reflected=${reflected} not_eligible=${notEligible} candidates=${candidates} rejected=${rejected} out=${redactSecrets(values.out).value}`,
  );
} catch (error) {
  const reason =
    error instanceof ReflectError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid JSONL input'
          : 'Invalid arguments or input/output I/O failed';
  console.error(`Trajectory reflection failed: ${reason}`);
  process.exitCode = 1;
}
