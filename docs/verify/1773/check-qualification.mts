import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHIEF_DISPATCH_HARNESS_PATHS } from '../../../packages/shared/src/records/merge-gate.ts';
import {
  type CoverageRow,
  scoredValue,
} from '../../../integration/eval/chief-dispatch/family-coverage.mts';
import type { MemoryCase } from '../../../integration/eval/memory-regression/grade.mts';

export type Candidate = { id: string; kind: 'adjacent' | 'irrelevant'; fingerprint: string };
type Row = CoverageRow & {
  model?: unknown;
  failure_class?: unknown;
  meta?: { context_window?: unknown };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};
export type QualificationRun = {
  model: string;
  contextWindow: number;
  cases: Candidate[];
  withMemory: Row[];
  withoutMemory: Row[];
  errors: CoverageRow[];
};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FLOW = '.claude/hillclimb/memory-regression';
const RUNNER = 'integration/eval/chief-dispatch/run-eval.mts';
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function candidates(cases: MemoryCase[]): Candidate[] {
  return cases.flatMap((entry) =>
    entry.expect.kind === 'adjacent' || entry.expect.kind === 'irrelevant'
      ? [{ id: entry.id, kind: entry.expect.kind, fingerprint: hash(JSON.stringify(entry)) }]
      : [],
  );
}
function binary(row: Row, metric: string): number {
  const value = scoredValue(row, metric);
  if (value !== 0 && value !== 1) throw new Error(`Missing binary grade: ${metric}`);
  return value;
}
function indexRows(run: QualificationRun, rows: Row[], control: boolean): Map<string, Row[]> {
  const byId = new Map<string, Row[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.prompt_id;
    const entry = run.cases.find((c) => c.id === id);
    if (typeof id !== 'string' || entry === undefined || (control && entry.kind !== 'irrelevant'))
      throw new Error('Unknown case in scored rows');
    if (typeof row.rep !== 'number' || !Number.isInteger(row.rep) || row.rep < 0)
      throw new Error('Invalid repetition identity');
    const key = `${id}\0${row.rep}`;
    if (seen.has(key)) throw new Error('Duplicate repetition');
    seen.add(key);
    const served = row.model;
    const base = run.model.replace(/-latest$|-0$/, '');
    if (
      served !== run.model &&
      !(
        typeof served === 'string' &&
        served.startsWith(base) &&
        /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(served.slice(base.length))
      )
    )
      throw new Error('Served model differs from requested model');
    const input = row.usage?.input_tokens;
    const output = row.usage?.output_tokens;
    if (
      row.meta?.context_window !== run.contextWindow ||
      row.failure_class != null ||
      row.status !== 'ok' ||
      typeof input !== 'number' ||
      typeof output !== 'number' ||
      !Number.isFinite(input) ||
      !Number.isFinite(output) ||
      input < 0 ||
      output < 0 ||
      input + output <= 0
    )
      throw new Error('Incomplete scored row');
    binary(row, 'decision_ok');
    if (!control && entry.kind === 'adjacent') binary(row, 'untouched_ok');
    byId.set(id, [...(byId.get(id) ?? []), row]);
  }
  return byId;
}

export function qualifyMemoryCases(cases: Candidate[], roster: string[], runs: QualificationRun[]) {
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate candidate');
  const indexed = runs.map((run) => {
    if (!Number.isSafeInteger(run.contextWindow) || run.contextWindow < 1_000_000)
      throw new Error('1M execution metadata is missing');
    if (!roster.includes(run.model)) throw new Error('Model is outside the current roster');
    return {
      run,
      withMemory: indexRows(run, run.withMemory, false),
      control: indexRows(run, run.withoutMemory, true),
    };
  });
  const results = cases.map((entry) => {
    const observations = indexed.flatMap(({ run, withMemory, control }) => {
      if (!run.cases.some((c) => c.id === entry.id && c.fingerprint === entry.fingerprint))
        return [];
      return (withMemory.get(entry.id) ?? []).map((row) => {
        const paired = (control.get(entry.id) ?? []).find((r) => r.rep === row.rep);
        return {
          model: run.model,
          rep: row.rep,
          decision: binary(row, 'decision_ok'),
          untouched: entry.kind === 'adjacent' ? binary(row, 'untouched_ok') : null,
          noMemoryDecision: paired === undefined ? null : binary(paired, 'decision_ok'),
        };
      });
    });
    return {
      ...entry,
      qualified: observations.some((o) => o.decision === 0 || o.untouched === 0),
      paired: entry.kind === 'adjacent' || observations.some((o) => o.noMemoryDecision !== null),
      observations,
    };
  });
  const familyCounts = Object.fromEntries(
    ['adjacent', 'irrelevant'].map((kind) => [kind, cases.filter((c) => c.kind === kind).length]),
  );
  return {
    ready:
      Object.values(familyCounts).every((n) => n >= 4 && n <= 6) &&
      results.every((r) => r.qualified && r.paired),
    familyCounts,
    cases: results,
    executionErrors: runs.reduce((n, run) => n + run.errors.length, 0),
  };
}

type Flow = { roster: { modelId: string }[]; cases: MemoryCase[] };
type State = { harness_paths: string[]; harness_sha?: string; [key: string]: unknown };
type Manifest = {
  sourceCommit: string;
  providerMode: string;
  contextWindow: number;
  requestedModel: string;
  files: Record<string, string>;
  armInputs: Record<string, Record<string, string>>;
};
function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function jsonl(path: string): Row[] {
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Row)
    : [];
}

export function verifyRun(directory: string): QualificationRun {
  const manifest = readJSON<Manifest>(join(directory, 'input-manifest.json'));
  if (manifest.providerMode !== 'real') throw new Error('Real-provider provenance is missing');
  if (!Number.isSafeInteger(manifest.contextWindow) || manifest.contextWindow < 1_000_000)
    throw new Error('1M execution metadata is missing');
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) throw new Error('Invalid source commit');
  const source = (path: string): Buffer =>
    execFileSync('git', ['show', `${manifest.sourceCommit}:${path}`], { cwd: ROOT });
  for (const path of [
    RUNNER,
    'integration/eval/chief-dispatch/stack.mts',
    'packages/shared/src/records/merge-gate.ts',
    'integration/eval/chief-dispatch/family-coverage.mts',
    'integration/eval/memory-regression/grade.mts',
  ]) {
    if (!source(path).equals(readFileSync(join(ROOT, path))))
      throw new Error(`Current verifier dependency differs from source: ${path}`);
  }
  const canonical = JSON.parse(source(`${FLOW}/cases.json`).toString()) as Flow;
  const originalState = JSON.parse(source(`${FLOW}/_state.json`).toString()) as State;
  if (!canonical.roster.some((r) => r.modelId === manifest.requestedModel))
    throw new Error('Requested model was outside source roster');
  const paths = [...new Set([...CHIEF_DISPATCH_HARNESS_PATHS, ...originalState.harness_paths])];
  const digest = createHash('sha256');
  for (const path of [...new Set([RUNNER, ...paths])].sort())
    digest.update(path).update('\0').update(source(path)).update('\0');
  const harnessSha = digest.digest('hex');
  for (const name of ['cases.json', '_state.json']) {
    if (hash(source(`${FLOW}/${name}`)) !== manifest.files[name])
      throw new Error(`Source input hash differs: ${name}`);
  }
  for (const arm of ['with-memory', 'no-memory']) {
    const input = readFileSync(join(directory, arm, 'cases.json'));
    if (hash(input) !== manifest.armInputs[arm]?.['cases.json'])
      throw new Error(`Arm input hash differs: ${arm}`);
    const expected = JSON.parse(JSON.stringify(canonical)) as Flow;
    if (arm === 'no-memory')
      for (const c of expected.cases) if (c.expect.kind === 'irrelevant') c.memories = [];
    if (JSON.stringify(JSON.parse(input.toString())) !== JSON.stringify(expected))
      throw new Error(`Arm changes more than its declared memory condition: ${arm}`);
    const runtime = readJSON<State>(join(directory, arm, '_state.json'));
    if (runtime.harness_sha !== harnessSha)
      throw new Error(`Approved harness differs from source: ${arm}`);
    if (JSON.stringify([...runtime.harness_paths].sort()) !== JSON.stringify([...paths].sort()))
      throw new Error(`Harness path set differs: ${arm}`);
    const { harness_sha: _saved, harness_paths: _paths, ...metadata } = runtime;
    const {
      harness_sha: _originalSaved,
      harness_paths: _originalPaths,
      ...originalMetadata
    } = originalState;
    if (JSON.stringify(metadata) !== JSON.stringify(originalMetadata))
      throw new Error(`Metric metadata differs: ${arm}`);
    if (manifest.armInputs[arm]?.['_state.json'] !== manifest.files['_state.json'])
      throw new Error(`Initial metric input hash differs: ${arm}`);
  }
  return {
    model: manifest.requestedModel,
    contextWindow: manifest.contextWindow,
    cases: candidates(canonical.cases),
    withMemory: jsonl(join(directory, 'with-memory/baseline/results.jsonl')),
    withoutMemory: jsonl(join(directory, 'no-memory/baseline/results.jsonl')),
    errors: [
      ...jsonl(join(directory, 'with-memory/baseline/errors.jsonl')),
      ...jsonl(join(directory, 'no-memory/baseline/errors.jsonl')),
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const directories = process.argv.slice(2);
    if (directories.length === 0)
      throw new Error('Usage: node check-qualification.mts <run-directory>...');
    const flow = readJSON<Flow>(join(ROOT, FLOW, 'cases.json'));
    const report = qualifyMemoryCases(
      candidates(flow.cases),
      flow.roster.map((r) => r.modelId),
      directories.map(verifyRun),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
