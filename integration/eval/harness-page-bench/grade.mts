import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type PageBenchRequirement = { id: string };

export type PageBenchQuestion = {
  id: string;
  requirements: readonly PageBenchRequirement[];
};

export type PageBenchBank = {
  version: string;
  questions: readonly PageBenchQuestion[];
};

export type PageBenchScreenshot = {
  viewport: 'desktop' | 'mobile';
  path: string;
  sha256: string;
};

export type PageBenchTokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type PageBenchRunRecord = {
  questionBankVersion: string;
  questionId: string;
  requirements: Record<string, boolean>;
  buildOk: boolean;
  consoleErrors: string[];
  screenshots: PageBenchScreenshot[];
  model: string;
  harnessVersion: string;
  budgets: { wallMs: number; inputTokens: number; outputTokens: number };
  elapsedMs: number;
  tokenUsage: PageBenchTokenUsage;
  retries: number;
};

export type GradeValid = {
  status: 'valid';
  score: number;
  perRequirement: Record<string, boolean>;
};

export type GradeInvalid = {
  status: 'invalid';
  reasons: string[];
};

export type GradeResult = GradeValid | GradeInvalid;

export type GradeOptions = {
  artifactRoot?: string;
};

export type AggregateSummary = {
  validCount: number;
  invalidCount: number;
  meanScore: number | null;
  invalidReasons: string[][];
};

function resolvePath(path: string, artifactRoot: string | undefined): string {
  if (isAbsolute(path)) return path;
  return artifactRoot === undefined ? path : join(artifactRoot, path);
}

function readableBytes(path: string): Buffer | null {
  try {
    accessSync(path, constants.R_OK);
    return readFileSync(path);
  } catch {
    return null;
  }
}

function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

export function gradeRun(
  record: PageBenchRunRecord,
  bank: PageBenchBank,
  options: GradeOptions = {},
): GradeResult {
  const reasons: string[] = [];

  if (record.questionBankVersion !== bank.version) {
    reasons.push(
      `questionBankVersion ${record.questionBankVersion} does not match bank version ${bank.version}`,
    );
  }

  const question = bank.questions.find((q) => q.id === record.questionId);
  if (question === undefined) {
    reasons.push(`unknown question id ${record.questionId}`);
  }

  const bankIds = question?.requirements.map((r) => r.id) ?? [];
  const recordIds = Object.keys(record.requirements);

  if (recordIds.length === 0) {
    reasons.push('empty requirement map');
  }

  for (const id of bankIds) {
    if (!Object.hasOwn(record.requirements, id)) {
      reasons.push(`missing requirement ${id}`);
    }
  }

  for (const id of recordIds) {
    if (!bankIds.includes(id)) {
      reasons.push(`unknown requirement id ${id}`);
    }
  }

  if (record.consoleErrors.length > 0) {
    reasons.push(`console errors present (${record.consoleErrors.length})`);
  }

  const byViewport = new Map<string, PageBenchScreenshot>();
  for (const shot of record.screenshots) {
    byViewport.set(shot.viewport, shot);
  }
  for (const viewport of ['desktop', 'mobile'] as const) {
    const shot = byViewport.get(viewport);
    if (shot === undefined) {
      reasons.push(`missing ${viewport} screenshot`);
      continue;
    }
    const absolute = resolvePath(shot.path, options.artifactRoot);
    const body = readableBytes(absolute);
    if (body === null) {
      reasons.push(`${viewport} screenshot missing or unreadable: ${shot.path}`);
      continue;
    }
    const digest = sha256Hex(body);
    if (digest !== shot.sha256) {
      reasons.push(`${viewport} screenshot sha256 mismatch`);
    }
  }

  if (reasons.length > 0) {
    return { status: 'invalid', reasons };
  }

  const perRequirement: Record<string, boolean> = {};
  for (const id of bankIds) {
    perRequirement[id] = record.requirements[id] === true;
  }

  if (!record.buildOk) {
    return { status: 'valid', score: 0, perRequirement };
  }

  const total = bankIds.length;
  const passed = bankIds.filter((id) => perRequirement[id]).length;
  return {
    status: 'valid',
    score: total === 0 ? 0 : passed / total,
    perRequirement,
  };
}

export function qualityPerCost(input: {
  score: number;
  tokenUsage: PageBenchTokenUsage | null | undefined;
}): number | null {
  const usage = input.tokenUsage;
  if (usage == null) return null;
  const { input: inputTokens, output, cacheRead, cacheWrite } = usage;
  if (
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(output) ||
    !Number.isFinite(cacheRead) ||
    !Number.isFinite(cacheWrite)
  ) {
    return null;
  }
  if (inputTokens < 0 || output < 0 || cacheRead < 0 || cacheWrite < 0) return null;
  const tokens = inputTokens + output;
  if (tokens <= 0) return null;
  if (!Number.isFinite(input.score)) return null;
  return input.score / (tokens / 1000);
}

export function aggregateGrades(results: readonly GradeResult[]): AggregateSummary {
  const invalidReasons: string[][] = [];
  let scoreSum = 0;
  let validCount = 0;
  for (const result of results) {
    if (result.status === 'valid') {
      validCount += 1;
      scoreSum += result.score;
      continue;
    }
    invalidReasons.push([...result.reasons]);
  }
  return {
    validCount,
    invalidCount: invalidReasons.length,
    meanScore: validCount === 0 ? null : scoreSum / validCount,
    invalidReasons,
  };
}
