import type { SkillInjectHit, SkillInjectRuleId } from '@cairn/shared';
import type { SkillsRoutingSnapshot } from './snapshot.mts';

export type RelevanceLabel = 'unrelated' | 'relevant' | 'uncertain';

export interface InjectionClassification {
  stepId: string;
  skillId: string;
  rule: SkillInjectRuleId;
  label: RelevanceLabel;
  rationale: string;
}

export interface ClassificationTotals {
  ok: boolean;
  populationHits: number;
  classifiedHits: number;
  missingKeys: string[];
  extraKeys: string[];
  byLabel: Record<RelevanceLabel, number>;
}

function hitKey(stepId: string, skillId: string, rule: SkillInjectRuleId): string {
  return `${stepId}\0${skillId}\0${rule}`;
}

export function populationHitKeys(snapshot: SkillsRoutingSnapshot): string[] {
  return snapshot.steps.flatMap((step) =>
    step.storedHits.map((hit) => hitKey(step.stepId, hit.id, hit.rule)),
  );
}

export function reconcileClassificationTotals(
  snapshot: SkillsRoutingSnapshot,
  classifications: readonly InjectionClassification[],
): ClassificationTotals {
  const expected = new Set(populationHitKeys(snapshot));
  const seen = new Set<string>();
  const missingKeys: string[] = [];
  const extraKeys: string[] = [];
  const byLabel: Record<RelevanceLabel, number> = {
    unrelated: 0,
    relevant: 0,
    uncertain: 0,
  };
  for (const row of classifications) {
    const key = hitKey(row.stepId, row.skillId, row.rule);
    if (seen.has(key)) extraKeys.push(key);
    seen.add(key);
    if (!expected.has(key)) extraKeys.push(key);
    byLabel[row.label] += 1;
  }
  for (const key of expected) {
    if (!seen.has(key)) missingKeys.push(key);
  }
  return {
    ok: missingKeys.length === 0 && extraKeys.length === 0 && seen.size === expected.size,
    populationHits: expected.size,
    classifiedHits: classifications.length,
    missingKeys,
    extraKeys,
    byLabel,
  };
}

export function classifySnapshotHits(
  snapshot: SkillsRoutingSnapshot,
  classifications: readonly InjectionClassification[],
): Array<InjectionClassification & { storedHit: SkillInjectHit; taskText: string }> {
  const byKey = new Map(
    classifications.map((row) => [hitKey(row.stepId, row.skillId, row.rule), row] as const),
  );
  return snapshot.steps.flatMap((step) =>
    step.storedHits.map((hit) => {
      const row = byKey.get(hitKey(step.stepId, hit.id, hit.rule));
      if (row === undefined) {
        throw new Error(`missing classification for ${step.stepId}/${hit.id}/${hit.rule}`);
      }
      return { ...row, storedHit: hit, taskText: step.taskText };
    }),
  );
}
