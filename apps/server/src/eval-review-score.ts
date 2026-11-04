import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type FailureWhere,
  type FailureWhy,
  failureWhereSchema,
  failureWhySchema,
} from '@cairn/shared';

export type ReviewLabelRecord = {
  itemId: string;
  source: 'eval' | 'pack';
  flow?: string;
  buildId?: string;
  verdictClass: 'agent-mistake' | 'grader-bug' | 'unfair-task';
  where?: FailureWhere;
  why?: FailureWhy;
  note: string;
  reader: { model: string; vendor: string };
};

export type AnswersFile = {
  labelerModel: string;
  items: Record<string, { where: FailureWhere; why: FailureWhy }>;
};

export type DimensionScore = {
  n: number;
  agreement: number | null;
  chanceAgreement: number | null;
  kappa: number | null;
  interval95: [number, number] | null;
};

export type ReviewScore = {
  labels: number;
  where: DimensionScore;
  why: DimensionScore;
};

export type LabelerTrust = {
  labels: number;
  whereAgreement: number | null;
  whyAgreement: number | null;
  kappaWhere: number | null;
  kappaWhy: number | null;
  trusted: boolean;
};

export type WeekInput = {
  week: string;
  records: ReviewLabelRecord[];
  answers: AnswersFile;
};

export type WeekScoreArtifact = {
  week: string;
  labels: Array<{
    itemId: string;
    source: ReviewLabelRecord['source'];
    buildId?: string;
    flow?: string;
    verdictClass: ReviewLabelRecord['verdictClass'];
    where?: FailureWhere;
    why?: FailureWhy;
  }>;
  score: {
    where: DimensionScore;
    why: DimensionScore;
  };
};

export function labelerVendor(modelId: string): string {
  const id = modelId.trim().toLowerCase();
  if (id === '') return 'unknown';
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('glm')) return 'z.ai';
  if (id.includes('gpt') || id.includes('codex') || id.includes('o1') || id.includes('o3')) {
    return 'openai';
  }
  if (id.includes('grok')) return 'xai';
  return 'unknown';
}

export function wilsonAgreementInterval(successes: number, total: number): [number, number] | null {
  if (total <= 0) return null;
  const z2 = 1.96 * 1.96;
  const p = successes / total;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const spread = 1.96 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return [(center - spread) / denominator, (center + spread) / denominator];
}

export function cohenKappa(pairs: Array<[string, string]>): DimensionScore {
  const n = pairs.length;
  if (n === 0) {
    return { n: 0, agreement: null, chanceAgreement: null, kappa: null, interval95: null };
  }
  const matches = pairs.filter(([a, b]) => a === b).length;
  const observed = matches / n;
  const labels = new Set(pairs.flat());
  let expected = 0;
  for (const label of labels) {
    const row = pairs.filter(([a]) => a === label).length;
    const col = pairs.filter(([, b]) => b === label).length;
    expected += (row * col) / n ** 2;
  }
  return {
    n,
    agreement: observed,
    chanceAgreement: expected,
    kappa: expected === 1 ? null : (observed - expected) / (1 - expected),
    interval95: wilsonAgreementInterval(matches, n),
  };
}

export function readLabelRecords(path: string): ReviewLabelRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const loc = `${path}:${index + 1}`;
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null) {
        throw new Error(`Invalid label record in ${loc}`);
      }
      const record = value as ReviewLabelRecord;
      if (typeof record.itemId !== 'string' || record.itemId.length === 0) {
        throw new Error(`Label record missing itemId in ${loc}`);
      }
      if (record.source !== 'eval' && record.source !== 'pack') {
        throw new Error(`Label record ${record.itemId} has invalid source`);
      }
      if (
        record.verdictClass !== 'agent-mistake' &&
        record.verdictClass !== 'grader-bug' &&
        record.verdictClass !== 'unfair-task'
      ) {
        throw new Error(`Label record ${record.itemId} has invalid verdictClass`);
      }
      if (
        typeof record.reader !== 'object' ||
        record.reader === null ||
        typeof record.reader.model !== 'string' ||
        typeof record.reader.vendor !== 'string'
      ) {
        throw new Error(`Label record ${record.itemId} missing reader`);
      }
      if (typeof record.note !== 'string') {
        throw new Error(`Label record ${record.itemId} missing note`);
      }
      return record;
    });
}

export function readAnswersFile(path: string): AnswersFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as AnswersFile;
  if (typeof parsed.labelerModel !== 'string' || parsed.labelerModel.length === 0) {
    throw new Error(`Answers file missing labelerModel: ${path}`);
  }
  if (typeof parsed.items !== 'object' || parsed.items === null) {
    throw new Error(`Answers file missing items: ${path}`);
  }
  return parsed;
}

export function scoreReviewWeeks(weeks: WeekInput[]): ReviewScore {
  const seen = new Map<string, string>();
  const wherePairs: Array<[string, string]> = [];
  const whyPairs: Array<[string, string]> = [];
  let labeled = 0;

  for (const week of weeks) {
    const labeler = labelerVendor(week.answers.labelerModel);
    if (labeler === 'unknown') {
      throw new Error(
        `unresolved labeler vendor for model ${week.answers.labelerModel || '(empty)'}`,
      );
    }
    for (const record of week.records) {
      const readerVendor = labelerVendor(record.reader.model);
      if (readerVendor === 'unknown') {
        throw new Error(`unresolved reader vendor for model ${record.reader.model || '(empty)'}`);
      }
      if (readerVendor === labeler) {
        throw new Error(
          `reader vendor equals the labeler vendor (${labeler}) for ${record.itemId}`,
        );
      }
      if (record.source === 'pack' && !record.buildId) {
        throw new Error(`Pack record missing buildId: ${record.itemId}`);
      }
      const identity =
        record.source === 'pack' ? `pack:${record.buildId}` : `eval:${record.itemId}`;
      const fingerprint = JSON.stringify({
        verdictClass: record.verdictClass,
        where: record.where ?? null,
        why: record.why ?? null,
      });
      const previous = seen.get(identity);
      if (previous !== undefined) {
        if (previous !== fingerprint) {
          throw new Error(`Conflicting review: ${record.buildId ?? record.itemId}`);
        }
        continue;
      }
      seen.set(identity, fingerprint);
      const answer = week.answers.items[record.itemId];
      if (!answer) continue;
      if (record.where === undefined && record.why === undefined) continue;
      const handWhere = failureWhereSchema.safeParse(record.where);
      if (!handWhere.success) {
        throw new Error(`invalid where for ${record.itemId}`);
      }
      const handWhy = failureWhySchema.safeParse(record.why);
      if (!handWhy.success) {
        throw new Error(`invalid why for ${record.itemId}`);
      }
      const answerWhere = failureWhereSchema.safeParse(answer.where);
      if (!answerWhere.success) {
        throw new Error(`invalid where for ${record.itemId} answers`);
      }
      const answerWhy = failureWhySchema.safeParse(answer.why);
      if (!answerWhy.success) {
        throw new Error(`invalid why for ${record.itemId} answers`);
      }
      labeled += 1;
      wherePairs.push([answerWhere.data, handWhere.data]);
      whyPairs.push([answerWhy.data, handWhy.data]);
    }
  }

  return {
    labels: labeled,
    where: cohenKappa(wherePairs),
    why: cohenKappa(whyPairs),
  };
}

export function buildLabelerTrust(score: ReviewScore): LabelerTrust {
  const whereLower = score.where.interval95?.[0] ?? null;
  return {
    labels: score.labels,
    whereAgreement: score.where.agreement,
    whyAgreement: score.why.agreement,
    kappaWhere: score.where.kappa,
    kappaWhy: score.why.kappa,
    trusted: score.labels >= 30 && whereLower !== null && whereLower >= 0.8,
  };
}

export function formatDimensionLine(name: string, score: DimensionScore): string {
  const agreement =
    score.agreement === null ? 'n/a' : `${(score.agreement * 100).toFixed(1)}% (n=${score.n})`;
  const kappa =
    score.kappa === null ? `null (n=${score.n})` : `${score.kappa.toFixed(3)} (n=${score.n})`;
  const interval =
    score.interval95 === null
      ? 'n/a'
      : `[${score.interval95[0].toFixed(3)}, ${score.interval95[1].toFixed(3)}] (n=${score.n})`;
  return `${name}: agreement=${agreement} kappa=${kappa} wilson95=${interval}`;
}

export function buildWeekArtifact(week: WeekInput, score: ReviewScore): WeekScoreArtifact {
  return {
    week: week.week,
    labels: week.records.map((record) => ({
      itemId: record.itemId,
      source: record.source,
      ...(record.buildId !== undefined ? { buildId: record.buildId } : {}),
      ...(record.flow !== undefined ? { flow: record.flow } : {}),
      verdictClass: record.verdictClass,
      ...(record.where !== undefined ? { where: record.where } : {}),
      ...(record.why !== undefined ? { why: record.why } : {}),
    })),
    score: { where: score.where, why: score.why },
  };
}

export function writeLabelerTrust(path: string, trust: LabelerTrust): void {
  writeFileSync(path, `${JSON.stringify(trust, null, 2)}\n`);
}

export function writeWeekArtifact(dir: string, artifact: WeekScoreArtifact): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `score-${artifact.week}.json`);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}

export function discoverWeekDirs(reviewsDir: string): string[] {
  return readdirSync(reviewsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadWeekInput(reviewsDir: string, week: string): WeekInput {
  const dir = join(reviewsDir, week);
  const records = readLabelRecords(join(dir, `review-${week}.jsonl`));
  const answers = readAnswersFile(join(dir, `answers-${week}.json`));
  return { week, records, answers };
}
