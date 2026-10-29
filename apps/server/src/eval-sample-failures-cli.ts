import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SampleFailuresError, sampleFailures } from './eval-sample-failures.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const defaultFlowsDir = join(repositoryRoot, '.claude/hillclimb');

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      week: { type: 'string' },
      seed: { type: 'string' },
      flows: { type: 'string' },
      'per-flow': { type: 'string', default: '3' },
      packs: { type: 'string', default: '10' },
      out: { type: 'string' },
    },
  });
  if (!values.week || !values.out) {
    throw new SampleFailuresError(
      'Use --week <ISO week, e.g. 2026-W44> --out <dir> [--seed] [--flows] [--per-flow] [--packs] [pack.jsonl...]',
    );
  }
  if (!/^(\d{4})-W(\d{2})$/.test(values.week)) {
    throw new SampleFailuresError('--week requires ISO week form YYYY-Www');
  }
  const perFlow = Number(values['per-flow']);
  const packs = Number(values.packs);
  if (!Number.isSafeInteger(perFlow) || perFlow < 1) {
    throw new SampleFailuresError('--per-flow must be a positive integer');
  }
  if (!Number.isSafeInteger(packs) || packs < 1) {
    throw new SampleFailuresError('--packs must be a positive integer');
  }
  const result = sampleFailures({
    week: values.week,
    seed: values.seed ?? values.week,
    flowsDir: values.flows ? resolve(values.flows) : defaultFlowsDir,
    packPaths: positionals,
    perFlow,
    packs,
    out: values.out,
  });
  console.log(
    JSON.stringify(
      {
        week: values.week,
        items: result.items.map((item) => item.itemId),
        traceHits: result.traceHits,
        traceMisses: result.traceMisses,
        reviewMd: result.reviewMd,
        reviewBlank: result.reviewBlank,
        answers: result.answers,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const reason =
    error instanceof SampleFailuresError ? error.message : 'Invalid arguments or I/O failed';
  console.error(`eval-sample-failures: ${reason}`);
  process.exitCode = 1;
}
