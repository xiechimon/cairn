#!/usr/bin/env -S pnpm exec tsx
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { createKeyfileSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { sealHeldOutCases, splitLabeledCases, writeVisibleFlow } from './split.mts';
import type { LabeledDispatchCase } from './types.mts';

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    keyfile: { type: 'string' },
  },
});
if (!values.in || !values.out) {
  console.error(
    'usage: split-cli.mts --in <labeled.json> --out <dir> [--keyfile ~/.cairn/eval-heldout.key]',
  );
  process.exit(2);
}
const keyfile = resolve(values.keyfile ?? `${process.env.HOME}/.cairn/eval-heldout.key`);
const raw = JSON.parse(readFileSync(resolve(values.in), 'utf8')) as {
  cases: LabeledDispatchCase[];
};
const { visible, heldOut } = splitLabeledCases(raw.cases);
const outDir = resolve(values.out);
writeVisibleFlow(visible, outDir);
const box = createKeyfileSecretBox(keyfile);
const sealedPath = join(outDir, 'heldout.sealed');
sealHeldOutCases(heldOut, box, sealedPath);
console.log(
  `visible=${visible.length} held_out=${heldOut.length} cases_json=${redactSecrets(join(outDir, 'cases.json')).value} heldout=${redactSecrets(sealedPath).value} keyfile=${redactSecrets(keyfile).value}`,
);
