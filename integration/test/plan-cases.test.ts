import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  type AnyPlanCase,
  isPlanCase,
  isPlanRevisionCase,
  type PlanRevisionCase,
  revisionCaseProblems,
} from '../eval/plan/grade.mts';

const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/plan');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  roster: { key: string; modelId: string }[];
  cases: AnyPlanCase[];
};

describe('plan cases ledger', () => {
  test('ten revision cases with unique ids', () => {
    const revisions = flow.cases.filter((c) => isPlanRevisionCase(c));
    expect(revisions.length).toBe(10);
    expect(new Set(flow.cases.map((c) => c.id)).size).toBe(flow.cases.length);
    expect(new Set(revisions.map((c) => c.id)).size).toBe(10);
  });

  test('every revision case has at least one feedback-dependent and one preservation requirement', () => {
    for (const c of flow.cases.filter((row): row is PlanRevisionCase => isPlanRevisionCase(row))) {
      expect(c.expect.mustFix.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.expect.mustPreserve.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.feedback.trim(), c.id).not.toBe('');
      expect(c.priorPlan.length, c.id).toBeGreaterThanOrEqual(1);
      expect(revisionCaseProblems(c), c.id).toEqual([]);
    }
  });

  test('every case parses and its roster seeds', () => {
    expect(flow.roster.length).toBeGreaterThan(0);
    for (const agent of flow.roster) {
      expect(agent.key).toBeTruthy();
      expect(agent.modelId).toBeTruthy();
    }
    for (const c of flow.cases) {
      expect(isPlanCase(c) || isPlanRevisionCase(c), c.id).toBe(true);
    }
  });

  test('covers under-splitting, over-splitting, missing requirement, forbidden, ignored feedback, dropped step', () => {
    const tags = flow.cases.flatMap((c) => c.tags);
    for (const need of [
      'under-splitting',
      'over-splitting',
      'missing-requirement',
      'forbidden',
      'ignored-feedback',
      'dropped-step',
    ]) {
      expect(tags, need).toContain(need);
    }
  });

  test('mustFix aliases do not echo ticket topic words from the prompt', () => {
    for (const c of flow.cases.filter((row): row is PlanRevisionCase => isPlanRevisionCase(row))) {
      const prompt = c.prompt.toLowerCase();
      for (const marker of c.expect.mustFix.flat()) {
        expect(prompt.includes(marker.toLowerCase()), `${c.id}: ${marker}`).toBe(false);
      }
    }
  });
});
