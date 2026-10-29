import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  blankFailureReviewRecord,
  type FailureReviewAnswers,
  type FailureReviewRecord,
  failureReviewAnswersSchema,
  failureWhereSchema,
  trajectoryPackSchema,
} from '@cairn/shared';
import { isFailedPack } from './trajectory-attribution.js';

export class SampleFailuresError extends Error {}

export interface SampleFailuresOptions {
  week: string;
  seed: string;
  flowsDir: string;
  packPaths: string[];
  perFlow: number;
  packs: number;
  out: string;
}

export interface SampledItem {
  itemId: string;
  source: 'eval' | 'pack';
  flow: string | null;
  buildId: string | null;
  transcriptPath: string | null;
  transcriptMissing: boolean;
}

export interface SampleFailuresResult {
  items: SampledItem[];
  traceHits: number;
  traceMisses: number;
  reviewMd: string;
  reviewBlank: string;
  answers: string;
}

interface TrialCandidate {
  itemId: string;
  flow: string;
  promptId: string;
  rep: number;
  stratum: string;
  transcriptPath: string | null;
  transcriptMissing: boolean;
  resultRow: unknown;
}

interface PackBlindedTranscript {
  buildId: string;
  input: unknown;
  process: unknown;
  outcome: unknown;
}

interface PackCandidate {
  itemId: string;
  buildId: string;
  stratum: string;
  where: string;
  why: string;
  labeler: string;
  blindedTranscript: PackBlindedTranscript;
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

function seededKey(seed: string, value: string): string {
  return createHash('sha256').update(`${seed}:${value}`).digest('hex');
}

function sortBySeed<T>(items: T[], seed: string, keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) =>
    seededKey(seed, keyOf(a)).localeCompare(seededKey(seed, keyOf(b))),
  );
}

function stratifyRoundRobin<T extends { stratum: string; itemId: string }>(
  items: T[],
  seed: string,
  limit: number,
): T[] {
  if (limit < 1 || items.length === 0) return [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const bucket = groups.get(item.stratum) ?? [];
    bucket.push(item);
    groups.set(item.stratum, bucket);
  }
  const strata = sortBySeed([...groups.keys()], seed, (key) => key).map((key) =>
    sortBySeed(groups.get(key) ?? [], seed, (item) => item.itemId),
  );
  const sample: T[] = [];
  while (sample.length < limit && strata.some((bucket) => bucket.length > 0)) {
    for (const bucket of strata) {
      if (bucket.length === 0 || sample.length >= limit) continue;
      const next = bucket.shift();
      if (next) sample.push(next);
    }
  }
  return sample;
}

export function sampleFailures(options: SampleFailuresOptions): SampleFailuresResult {
  if (!/^(\d{4})-W(\d{2})$/.test(options.week)) {
    throw new SampleFailuresError('--week requires ISO week form YYYY-Www');
  }
  if (!Number.isSafeInteger(options.perFlow) || options.perFlow < 1) {
    throw new SampleFailuresError('--per-flow must be a positive integer');
  }
  if (!Number.isSafeInteger(options.packs) || options.packs < 1) {
    throw new SampleFailuresError('--packs must be a positive integer');
  }
  if (existsSync(options.out)) {
    throw new SampleFailuresError(`Review directory already exists: ${options.out}`);
  }

  const flowsDir = resolve(options.flowsDir);
  const trialByIdentity = new Map<string, TrialCandidate>();
  const flowNames = existsSync(flowsDir)
    ? readdirSync(flowsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const flow of flowNames) {
    const baseline = join(flowsDir, flow, 'baseline');
    for (const row of readJsonl(join(baseline, 'results.jsonl'))) {
      if (!row || typeof row !== 'object') continue;
      const record = row as {
        prompt_id?: unknown;
        rep?: unknown;
        grade?: Record<string, unknown>;
      };
      if (typeof record.prompt_id !== 'string' || typeof record.rep !== 'number') continue;
      const failing = Object.entries(record.grade ?? {})
        .filter(([, value]) => value === 0 || value === false)
        .map(([key]) => key)
        .sort();
      if (failing.length === 0) continue;
      const identity = `${flow}\0${record.prompt_id}\0${record.rep}`;
      const transcriptPath = join(baseline, 'traces', `${record.prompt_id}_rep${record.rep}.json`);
      const transcriptMissing = !existsSync(transcriptPath);
      trialByIdentity.set(identity, {
        itemId: `eval:${flow}:${record.prompt_id}:${record.rep}`,
        flow,
        promptId: record.prompt_id,
        rep: record.rep,
        stratum: failing.join('+'),
        transcriptPath: transcriptMissing ? null : transcriptPath,
        transcriptMissing,
        resultRow: row,
      });
    }
    for (const row of readJsonl(join(baseline, 'errors.jsonl'))) {
      if (!row || typeof row !== 'object') continue;
      const record = row as { prompt_id?: unknown; rep?: unknown; failure_class?: unknown };
      if (typeof record.prompt_id !== 'string' || typeof record.rep !== 'number') continue;
      const identity = `${flow}\0${record.prompt_id}\0${record.rep}`;
      if (trialByIdentity.has(identity)) continue;
      const transcriptPath = join(baseline, 'traces', `${record.prompt_id}_rep${record.rep}.json`);
      const transcriptMissing = !existsSync(transcriptPath);
      trialByIdentity.set(identity, {
        itemId: `eval:${flow}:${record.prompt_id}:${record.rep}`,
        flow,
        promptId: record.prompt_id,
        rep: record.rep,
        stratum:
          typeof record.failure_class === 'string' && record.failure_class
            ? record.failure_class
            : 'error',
        transcriptPath: transcriptMissing ? null : transcriptPath,
        transcriptMissing,
        resultRow: row,
      });
    }
  }

  const trialsByFlow = new Map<string, TrialCandidate[]>();
  for (const trial of trialByIdentity.values()) {
    const bucket = trialsByFlow.get(trial.flow) ?? [];
    bucket.push(trial);
    trialsByFlow.set(trial.flow, bucket);
  }
  const sampledTrials: TrialCandidate[] = [];
  for (const flow of sortBySeed([...trialsByFlow.keys()], options.seed, (name) => name)) {
    sampledTrials.push(
      ...stratifyRoundRobin(trialsByFlow.get(flow) ?? [], options.seed, options.perFlow),
    );
  }
  const trials = sortBySeed(sampledTrials, options.seed, (item) => item.itemId);

  const packByBuild = new Map<string, PackCandidate>();
  for (const path of options.packPaths.map((packPath) => resolve(packPath))) {
    for (const row of readJsonl(path)) {
      const pack = trajectoryPackSchema.parse(row);
      if (!isFailedPack(pack) || pack.attribution === null) continue;
      const previous = packByBuild.get(pack.buildId);
      const candidate: PackCandidate = {
        itemId: `pack:${pack.buildId}`,
        buildId: pack.buildId,
        stratum: pack.attribution.where,
        where: pack.attribution.where,
        why: pack.attribution.why,
        labeler: pack.attribution.labeler,
        blindedTranscript: {
          buildId: pack.buildId,
          input: pack.input,
          process: pack.process,
          outcome: pack.outcome,
        },
      };
      if (previous) {
        if (previous.where !== candidate.where || previous.why !== candidate.why) {
          throw new SampleFailuresError(`Conflicting attribution: ${pack.buildId}`);
        }
        continue;
      }
      failureWhereSchema.parse(candidate.where);
      packByBuild.set(pack.buildId, candidate);
    }
  }
  const orderedPacks = sortBySeed(
    stratifyRoundRobin([...packByBuild.values()], options.seed, options.packs),
    options.seed,
    (item) => item.itemId,
  );

  mkdirSync(options.out, { recursive: true });
  const missingDir = join(options.out, 'missing-transcripts');
  const packTranscriptDir = join(options.out, 'transcripts');
  const items: SampledItem[] = [
    ...trials.map((trial) => {
      let transcriptPath = trial.transcriptPath;
      if (trial.transcriptMissing) {
        mkdirSync(missingDir, { recursive: true });
        const kept = join(missingDir, `${trial.itemId.replaceAll(':', '_')}.json`);
        writeFileSync(kept, `${JSON.stringify(trial.resultRow, null, 2)}\n`);
        transcriptPath = kept;
      }
      return {
        itemId: trial.itemId,
        source: 'eval' as const,
        flow: trial.flow,
        buildId: null,
        transcriptPath,
        transcriptMissing: trial.transcriptMissing,
      };
    }),
    ...orderedPacks.map((pack) => {
      mkdirSync(packTranscriptDir, { recursive: true });
      const transcriptPath = join(packTranscriptDir, `${pack.itemId.replaceAll(':', '_')}.json`);
      writeFileSync(transcriptPath, `${JSON.stringify(pack.blindedTranscript, null, 2)}\n`);
      return {
        itemId: pack.itemId,
        source: 'pack' as const,
        flow: null,
        buildId: pack.buildId,
        transcriptPath,
        transcriptMissing: false,
      };
    }),
  ];

  const blankRecords: FailureReviewRecord[] = items.map((item) =>
    blankFailureReviewRecord({
      itemId: item.itemId,
      source: item.source,
      flow: item.flow,
      buildId: item.buildId,
    }),
  );
  const answers: FailureReviewAnswers = failureReviewAnswersSchema.parse({
    week: options.week,
    seed: options.seed,
    items: Object.fromEntries(
      orderedPacks.map((pack) => [
        pack.itemId,
        { where: pack.where, why: pack.why, labeler: pack.labeler },
      ]),
    ),
  });

  const reviewLines = [`# Failure review ${options.week}`, ''];
  for (const item of items) {
    reviewLines.push(`## ${item.itemId}`, '');
    reviewLines.push(`- source: ${item.source}`);
    if (item.flow) reviewLines.push(`- flow: ${item.flow}`);
    if (item.buildId) reviewLines.push(`- buildId: ${item.buildId}`);
    if (item.transcriptPath) {
      reviewLines.push(`- transcript: \`${relative(options.out, item.transcriptPath)}\``);
    } else {
      reviewLines.push('- transcript: none');
    }
    if (item.transcriptMissing) reviewLines.push('- transcriptMissing: true');
    reviewLines.push('');
  }

  const reviewMd = join(options.out, `review-${options.week}.md`);
  const reviewBlank = join(options.out, `review-${options.week}.blank.jsonl`);
  const answersPath = join(options.out, `answers-${options.week}.json`);
  writeFileSync(reviewMd, `${reviewLines.join('\n')}\n`);
  writeFileSync(reviewBlank, `${blankRecords.map((row) => JSON.stringify(row)).join('\n')}\n`);
  writeFileSync(answersPath, `${JSON.stringify(answers, null, 2)}\n`, { mode: 0o600 });

  return {
    items,
    traceHits: items.filter((item) => item.source === 'eval' && !item.transcriptMissing).length,
    traceMisses: items.filter((item) => item.source === 'eval' && item.transcriptMissing).length,
    reviewMd,
    reviewBlank,
    answers: answersPath,
  };
}
