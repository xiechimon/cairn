import { describe, expect, test } from 'vitest';
import {
  aggregate,
  gradeRouting,
  loadCases,
  type SkillsRoutingCase,
} from '../eval/skills-routing/grade.mts';

describe('gradeRouting', () => {
  test('counts true positives, false positives and false negatives', () => {
    const score = gradeRouting(
      ['e2e-debugging', 'design-review', 'misc-skill'],
      ['e2e-debugging', 'native-skill'],
      ['design-review'],
    );
    expect(score.truePositives).toBe(1);
    expect(score.falsePositives).toBe(2);
    expect(score.falseNegatives).toBe(1);
    expect(score.precision).toBe(1 / 3);
    expect(score.recall).toBe(1 / 2);
  });

  test('counts predicted forbidden skills as forbidden hits and false positives', () => {
    const score = gradeRouting(
      ['e2e-debugging', 'design-review'],
      ['e2e-debugging'],
      ['design-review'],
    );
    expect(score.forbiddenHits).toBe(1);
    expect(score.falsePositives).toBe(1);
    expect(score.precision).toBe(1 / 2);
    expect(score.recall).toBe(1);
  });

  test('reports zero forbidden hits when the router avoids the distractors', () => {
    const score = gradeRouting(['e2e-debugging'], ['e2e-debugging'], ['design-review']);
    expect(score.forbiddenHits).toBe(0);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
  });

  test('treats empty predictions as perfect precision and empty expectations as perfect recall', () => {
    expect(gradeRouting([], ['e2e-debugging'], ['design-review'])).toMatchObject({
      precision: 1,
      recall: 0,
      forbiddenHits: 0,
    });
    expect(gradeRouting(['e2e-debugging'], [], ['design-review'])).toMatchObject({
      precision: 0,
      recall: 1,
      forbiddenHits: 0,
    });
  });
});

describe('aggregate', () => {
  test('micro-averages precision and recall and totals forbidden hits', () => {
    const scores = [
      gradeRouting(['e2e-debugging', 'design-review'], ['e2e-debugging'], ['design-review']),
      gradeRouting(['design-review'], ['e2e-debugging'], ['design-review']),
      gradeRouting([], [], []),
    ];
    const totals = aggregate(scores);
    expect(totals.precision).toBe(1 / 3);
    expect(totals.recall).toBe(1 / 2);
    expect(totals.forbiddenHits).toBe(2);
  });
});

describe('loadCases', () => {
  test('loads a labeled set whose expectations and distractors never overlap', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(new Set(cases.map((c: SkillsRoutingCase) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(Array.isArray(c.expected)).toBe(true);
      expect(Array.isArray(c.forbidden)).toBe(true);
      for (const skill of c.expected) {
        expect(c.forbidden).not.toContain(skill);
      }
    }
  });
});
