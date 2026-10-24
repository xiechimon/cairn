import { describe, expect, test } from 'vitest';
import { isFullSha } from '../src/services/merge-gate/readiness.js';
import { bindGateVerdict } from '../src/services/merge-gate/verdict.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const base = {
  kind: 'review' as const,
  perspective: 'code_reviewer',
  expectedHeadSha: HEAD,
  reportedHeadSha: HEAD,
  stepFailed: false,
  extracted: true,
  blocked: false,
};

describe('bindGateVerdict：抽取失败不计为通过', () => {
  test('抽出的空判定是 pass', () => {
    const bound = bindGateVerdict(base);
    expect(bound).not.toBeNull();
    expect(bound?.outcome).toBe('pass');
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.headSha).toBe(HEAD);
  });

  test('抽取失败是 extraction_failed，不是 pass', () => {
    const bound = bindGateVerdict({ ...base, extracted: false });
    expect(bound).not.toBeNull();
    expect(bound?.outcome).toBe('extraction_failed');
    expect(bound?.outcome).not.toBe('pass');
    expect(bound?.expectedHeadSha).toBe(HEAD);
  });

  test('verify 抽取失败同样不是 pass', () => {
    const bound = bindGateVerdict({
      ...base,
      kind: 'verify',
      perspective: null,
      extracted: false,
    });
    expect(bound?.kind).toBe('verify');
    expect(bound?.perspective).toBeNull();
    expect(bound?.outcome).toBe('extraction_failed');
  });

  test('抽出的 blocking 是 block', () => {
    expect(bindGateVerdict({ ...base, blocked: true })?.outcome).toBe('block');
  });

  test('步失败优先于抽取结果，记 step_failed', () => {
    expect(
      bindGateVerdict({ ...base, stepFailed: true, extracted: true, blocked: false })?.outcome,
    ).toBe('step_failed');
  });

  test('expectedHeadSha 不是闸认的 SHA 则不绑定', () => {
    expect(isFullSha('HEAD')).toBe(false);
    expect(bindGateVerdict({ ...base, expectedHeadSha: 'HEAD' })).toBeNull();
    expect(bindGateVerdict({ ...base, expectedHeadSha: HEAD.toUpperCase() })).toBeNull();
  });

  test('reported head 与 expected 不一致：记下 reported，patchDigest 为空', () => {
    const bound = bindGateVerdict({ ...base, reportedHeadSha: OTHER });
    expect(bound?.headSha).toBe(OTHER);
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
    expect(bound?.outcome).toBe('pass');
  });

  test('没报 head：headSha 为空，expectedHeadSha 仍在', () => {
    const bound = bindGateVerdict({ ...base, reportedHeadSha: null });
    expect(bound?.headSha).toBeNull();
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
  });
});
