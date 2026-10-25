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
  test('接受完整结果', () => {
    expect(harnessRegressionResultSchema.parse(valid)).toEqual(valid);
  });

  test('缺 harness_sha、摘要或阈值字段则拒', () => {
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
  test('含总管提示词、工具描述与 worker 相关路径', () => {
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('apps/server/src/services/chief.ts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('packages/shared/src/protocol/chief-tools.ts');
    expect(CHIEF_DISPATCH_HARNESS_PATHS).toContain('apps/daemon/src/backend/pi.ts');
    expect(HARNESS_REGRESSION_RESULT_NAME).toBe('harness-regression.json');
  });
});
