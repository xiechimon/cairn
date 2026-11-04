#!/usr/bin/env -S pnpm exec tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { redactDispatchCases } from './redact.mts';
import type { ExportedDispatchCase } from './types.mts';

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.in || !values.out) {
  console.error('usage: redact-cli.mts --in <raw.json> --out <redacted.json>');
  process.exit(2);
}
const raw = JSON.parse(readFileSync(resolve(values.in), 'utf8')) as {
  cases: ExportedDispatchCase[];
};
const results = redactDispatchCases(raw.cases);
const kept = results.flatMap((r) => (r.kept ? [r.case] : []));
const dropped = results.length - kept.length;
writeFileSync(
  resolve(values.out),
  `${JSON.stringify({ redactedAt: new Date().toISOString(), cases: kept }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(
  `kept=${kept.length} dropped=${dropped} out=${redactSecrets(resolve(values.out)).value}`,
);
