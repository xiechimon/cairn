import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillsRoutingCase {
  id: string;
  task: string;
  expected: string[];
  forbidden: string[];
}

export interface RoutingScore {
  precision: number;
  recall: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  forbiddenHits: number;
}

const casesPath = join(import.meta.dirname ?? '.', 'cases.json');

export function loadCases(): SkillsRoutingCase[] {
  return JSON.parse(readFileSync(casesPath, 'utf8')) as SkillsRoutingCase[];
}

export function gradeRouting(
  predicted: string[],
  expected: string[],
  forbidden: string[],
): RoutingScore {
  const predictedSet = new Set(predicted);
  const expectedSet = new Set(expected);
  const forbiddenSet = new Set(forbidden);
  const truePositives = expected.filter((s) => predictedSet.has(s)).length;
  const falsePositives = predicted.filter((s) => !expectedSet.has(s)).length;
  const falseNegatives = expected.filter((s) => !predictedSet.has(s)).length;
  const forbiddenHits = predicted.filter((s) => forbiddenSet.has(s)).length;
  const precision = predicted.length === 0 ? 1 : truePositives / predicted.length;
  const recall = expected.length === 0 ? 1 : truePositives / expected.length;
  return { precision, recall, truePositives, falsePositives, falseNegatives, forbiddenHits };
}

export function aggregate(scores: RoutingScore[]): {
  precision: number;
  recall: number;
  forbiddenHits: number;
} {
  const tp = scores.reduce((a, s) => a + s.truePositives, 0);
  const fp = scores.reduce((a, s) => a + s.falsePositives, 0);
  const fn = scores.reduce((a, s) => a + s.falseNegatives, 0);
  const forbiddenHits = scores.reduce((a, s) => a + s.forbiddenHits, 0);
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    forbiddenHits,
  };
}
