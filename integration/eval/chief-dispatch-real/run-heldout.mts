#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { SecretBox } from '@cairn/shared';
import { createKeyfileSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { wilsonInterval } from '../chief-dispatch/baseline-record.mts';
import { decisionOkRate, parseResultsJsonl } from '../chief-dispatch/harness-eval-result.mts';
import { formatHeldOutRunStdout, openHeldOutCases, writeVisibleFlow } from './split.mts';

export type HeldOutEvaluator = (flowDir: string) => Promise<{ resultsJsonlPath: string }>;

export async function runHeldOut(args: {
  sealedPath: string;
  box: SecretBox;
  evaluate: HeldOutEvaluator;
}): Promise<{
  stdout: string;
  decisionOk: number;
  decisionOkInterval: [number, number];
  scored: number;
  caseCount: number;
}> {
  const cases = openHeldOutCases(args.sealedPath, args.box);
  const temp = mkdtempSync(join(tmpdir(), 'cairn-heldout-'));
  try {
    writeVisibleFlow(cases, temp);
    const { resultsJsonlPath } = await args.evaluate(temp);
    const rows = parseResultsJsonl(readFileSync(resultsJsonlPath, 'utf8'));
    const scored = rows.length;
    const successes = rows.filter((r) => r.grade?.decision_ok === 1).length;
    const decisionOk = decisionOkRate(rows) ?? 0;
    const interval = wilsonInterval(successes, scored);
    const decisionOkInterval: [number, number] = interval ? [interval.low, interval.high] : [0, 0];
    const stdout = formatHeldOutRunStdout({
      half: 'held-out',
      caseCount: cases.length,
      decisionOk,
      decisionOkInterval,
      scored,
    });
    return { stdout, decisionOk, decisionOkInterval, scored, caseCount: cases.length };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function defaultEvaluate(flowDir: string): Promise<{ resultsJsonlPath: string }> {
  const runner = join(dirname(fileURLToPath(import.meta.url)), '../chief-dispatch/run-eval.mts');
  const variant = 'baseline';
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', runner, '--flow', flowDir, '--variant', variant, '--approve-harness'],
    {
      cwd: resolve(join(dirname(fileURLToPath(import.meta.url)), '../../..')),
      encoding: 'utf8',
      env: { ...process.env },
    },
  );
  if (result.status !== 0) {
    const err = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`held-out run-eval failed: ${err}`);
  }
  const resultsJsonlPath = join(flowDir, variant, 'results.jsonl');
  if (!existsSync(resultsJsonlPath)) {
    throw new Error(`held-out run-eval produced no results at ${resultsJsonlPath}`);
  }
  return Promise.resolve({ resultsJsonlPath });
}

async function main() {
  const { values } = parseArgs({
    options: {
      sealed: { type: 'string' },
      keyfile: { type: 'string' },
    },
  });
  if (!values.sealed) {
    console.error('usage: run-heldout.mts --sealed <heldout.sealed> [--keyfile PATH]');
    console.error(
      'Opens the sealed half into a temp flow, runs chief-dispatch run-eval, prints aggregate scores only, then deletes the temp flow.',
    );
    process.exit(2);
  }
  const keyfile = resolve(values.keyfile ?? `${process.env.HOME}/.cairn/eval-heldout.key`);
  const box = createKeyfileSecretBox(keyfile);
  const result = await runHeldOut({
    sealedPath: resolve(values.sealed),
    box,
    evaluate: defaultEvaluate,
  });
  process.stdout.write(`${result.stdout}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Held-out run failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
