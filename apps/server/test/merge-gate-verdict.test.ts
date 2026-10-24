import type { CompareFile } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { computePatchDigest } from '../src/services/merge-gate/digest.js';
import { isFullSha } from '../src/services/merge-gate/readiness.js';
import { bindGateVerdict } from '../src/services/merge-gate/verdict.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const PATCH_SHA = 'c'.repeat(64);

const delivery: CompareFile[] = [
  {
    status: 'modified',
    filename: 'apps/server/src/a.ts',
    previousFilename: null,
    sha: 'd'.repeat(40),
    additions: 1,
    deletions: 1,
    patchSha: PATCH_SHA,
  },
];
const deliveryDigest = computePatchDigest(delivery).patchDigest;

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
    const bound = bindGateVerdict({ ...base, reportedHeadSha: OTHER, compareFiles: delivery });
    expect(bound?.headSha).toBe(OTHER);
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
    expect(bound?.outcome).toBe('pass');
  });

  test('审核没报 head：用 expectedHeadSha，摘要按这份交付补丁算', () => {
    expect(deliveryDigest).toMatch(/^pd2:[0-9a-f]{64}$/);
    const bound = bindGateVerdict({ ...base, reportedHeadSha: null, compareFiles: delivery });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBe(deliveryDigest);
  });

  test('verify 没报 head：不拿 expected 顶上，摘要不绑定', () => {
    const bound = bindGateVerdict({
      ...base,
      kind: 'verify',
      perspective: null,
      reportedHeadSha: null,
      compareFiles: delivery,
    });
    expect(bound?.headSha).toBeNull();
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
  });

  test('head 一致且给了 compare 文件：patchDigest 是这份交付补丁的摘要', () => {
    const bound = bindGateVerdict({ ...base, compareFiles: delivery });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.patchDigest).toBe(deliveryDigest);
    expect(bound?.outcome).toBe('pass');
  });

  test('head 一致但 compare 读不到：patchDigest 为空', () => {
    const bound = bindGateVerdict({ ...base, compareFiles: null });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
  });

  test('步失败或抽取失败，head 对齐时摘要照样绑定', () => {
    expect(
      bindGateVerdict({ ...base, stepFailed: true, compareFiles: delivery })?.patchDigest,
    ).toBe(deliveryDigest);
    expect(
      bindGateVerdict({ ...base, extracted: false, compareFiles: delivery })?.patchDigest,
    ).toBe(deliveryDigest);
  });

  test('verify 在 expected 之后只改了本票证据目录：摘要绑交付 head，headSha 记证据提交', () => {
    const bound = bindGateVerdict({
      ...base,
      kind: 'verify',
      perspective: null,
      reportedHeadSha: OTHER,
      compareFiles: delivery,
      evidenceDir: 'docs/verify/1404/',
      pathsAfterExpected: ['docs/verify/1404/notes.md'],
    });
    expect(bound?.headSha).toBe(OTHER);
    expect(bound?.patchDigest).toBe(deliveryDigest);
    expect(bound?.outcome).toBe('pass');
  });

  test('verify 的后续提交碰了证据目录外、空列表、或目录不是本票：摘要不绑定，head 仍记下', () => {
    const verify = {
      ...base,
      kind: 'verify' as const,
      perspective: null,
      reportedHeadSha: OTHER,
      compareFiles: delivery,
      evidenceDir: 'docs/verify/1404/',
    };
    expect(
      bindGateVerdict({
        ...verify,
        pathsAfterExpected: ['docs/verify/1404/notes.md', 'apps/server/src/a.ts'],
      })?.patchDigest,
    ).toBeNull();
    expect(
      bindGateVerdict({
        ...verify,
        pathsAfterExpected: ['docs/verify/1404/notes.md', 'apps/server/src/old.ts'],
      })?.headSha,
    ).toBe(OTHER);
    expect(
      bindGateVerdict({ ...verify, pathsAfterExpected: ['docs/verify/1404-extra/notes.md'] })
        ?.patchDigest,
    ).toBeNull();
    expect(
      bindGateVerdict({ ...verify, pathsAfterExpected: ['docs/verify/1404/../../apps/x.ts'] })
        ?.patchDigest,
    ).toBeNull();
    expect(bindGateVerdict({ ...verify, pathsAfterExpected: [] })?.patchDigest).toBeNull();
    expect(bindGateVerdict({ ...verify, pathsAfterExpected: null })?.patchDigest).toBeNull();
    expect(
      bindGateVerdict({
        ...verify,
        evidenceDir: 'docs/verify/1404',
        pathsAfterExpected: ['docs/verify/1404/notes.md'],
      })?.patchDigest,
    ).toBeNull();
    expect(
      bindGateVerdict({
        ...verify,
        evidenceDir: null,
        pathsAfterExpected: ['docs/verify/1404/notes.md'],
      })?.patchDigest,
    ).toBeNull();
  });
});
