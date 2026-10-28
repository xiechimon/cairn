import { describe, expect, test } from 'vitest';
import {
  CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  CHIEF_DISPATCH_HARNESS_PATHS,
  HARNESS_REGRESSION_RESULT_NAME,
  harnessRegressionResultSchema,
} from '../src/index.js';

const valid = {
  patchDigest: `pd2:${'a'.repeat(64)}`,
  harness_sha: 'b'.repeat(64),
  decision_ok: CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  trace_digest: 'c'.repeat(64),
};

describe('harnessRegressionResultSchema', () => {
  test('accepts a complete result', () => {
    expect(harnessRegressionResultSchema.parse(valid)).toEqual(valid);
  });

  test('missing harness_sha, summary, or threshold field -> rejected', () => {
    const { harness_sha: _h, ...noSha } = valid;
    const { patchDigest: _p, ...noDigest } = valid;
    const { decision_ok: _d, ...noRate } = valid;
    expect(harnessRegressionResultSchema.safeParse(noSha).success).toBe(false);
    expect(harnessRegressionResultSchema.safeParse(noDigest).success).toBe(false);
    expect(harnessRegressionResultSchema.safeParse(noRate).success).toBe(false);
    expect(
      harnessRegressionResultSchema.safeParse({ ...valid, harness_sha: 'AB'.repeat(32) }).success,
    ).toBe(false);
    expect(harnessRegressionResultSchema.safeParse({ ...valid, decision_ok: 1.1 }).success).toBe(
      false,
    );
  });
});

describe('CHIEF_DISPATCH_HARNESS_PATHS', () => {
  test('contains the chief prompt, tool descriptions, and worker-related paths', () => {
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('apps/server/src/services/chief.ts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('packages/shared/src/protocol/chief-tools.ts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('apps/daemon/src/backend/pi.ts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('integration/eval/plan/grade.mts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('integration/eval/plan/run.mts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('integration/eval/plan/seed.mts');
    expect(HARNESS_REGRESSION_RESULT_NAME).toBe('harness-regression.json');
  });

  test('keeps plan-family graders on the plan flow _state only', () => {
    expect(CHIEF_DISPATCH_HARNESS_PATHS).not.toContain('integration/eval/plan/grade.mts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).not.toContain('integration/eval/plan/run.mts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).not.toContain('integration/eval/plan/seed.mts');
  });
});
