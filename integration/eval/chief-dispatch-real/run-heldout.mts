#!/usr/bin/env -S pnpm exec tsx
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createKeyfileSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { formatHeldOutRunStdout, openHeldOutCases, writeVisibleFlow } from './split.mts';

const { values } = parseArgs({
  options: {
    sealed: { type: 'string' },
    keyfile: { type: 'string' },
    scores: { type: 'string' },
  },
});
if (!values.sealed) {
  console.error(
    'usage: run-heldout.mts --sealed <heldout.sealed> [--keyfile PATH] [--scores scores.json]',
  );
  console.error(
    'Opens the sealed half into a temp dir, never prints case text. Pass --scores with aggregate numbers from a prior run-eval on that temp dir, or omit to print case counts only.',
  );
  process.exit(2);
}
const keyfile = resolve(values.keyfile ?? `${process.env.HOME}/.cairn/eval-heldout.key`);
const box = createKeyfileSecretBox(keyfile);
const cases = openHeldOutCases(resolve(values.sealed), box);
const temp = mkdtempSync(join(tmpdir(), 'cairn-heldout-'));
try {
  writeVisibleFlow(cases, temp);
  let decisionOk = Number.NaN;
  let lo = Number.NaN;
  let hi = Number.NaN;
  let scored = 0;
  if (values.scores) {
    const scores = JSON.parse(readFileSync(resolve(values.scores), 'utf8')) as {
      decision_ok?: number;
      decision_ok_95ci?: [number, number];
      scored?: number;
    };
    decisionOk = scores.decision_ok ?? Number.NaN;
    lo = scores.decision_ok_95ci?.[0] ?? Number.NaN;
    hi = scores.decision_ok_95ci?.[1] ?? Number.NaN;
    scored = scores.scored ?? 0;
  }
  process.stdout.write(
    `${formatHeldOutRunStdout({
      half: 'held-out',
      caseCount: cases.length,
      decisionOk: Number.isFinite(decisionOk) ? decisionOk : 0,
      decisionOkInterval: [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0],
      scored,
    })}\n`,
  );
  writeFileSync(join(temp, '.opened'), '1');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
