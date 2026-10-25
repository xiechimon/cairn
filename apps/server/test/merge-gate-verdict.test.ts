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

describe('bindGateVerdict: extraction failure does not count as pass', () => {
  test('an extracted empty verdict is pass', () => {
    const bound = bindGateVerdict(base);
    expect(bound).not.toBeNull();
    expect(bound?.outcome).toBe('pass');
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.headSha).toBe(HEAD);
  });

  test('extraction failure is extraction_failed, not pass', () => {
    const bound = bindGateVerdict({ ...base, extracted: false });
    expect(bound).not.toBeNull();
    expect(bound?.outcome).toBe('extraction_failed');
    expect(bound?.outcome).not.toBe('pass');
    expect(bound?.expectedHeadSha).toBe(HEAD);
  });

  test('a verify extraction failure is likewise not pass', () => {
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

  test('an extracted blocking verdict is block', () => {
    expect(bindGateVerdict({ ...base, blocked: true })?.outcome).toBe('block');
  });

  test('step failure takes precedence over the extraction result, recorded as step_failed', () => {
    expect(
      bindGateVerdict({ ...base, stepFailed: true, extracted: true, blocked: false })?.outcome,
    ).toBe('step_failed');
  });

  test('no binding when expectedHeadSha is not a SHA the gate recognises', () => {
    expect(isFullSha('HEAD')).toBe(false);
    expect(bindGateVerdict({ ...base, expectedHeadSha: 'HEAD' })).toBeNull();
    expect(bindGateVerdict({ ...base, expectedHeadSha: HEAD.toUpperCase() })).toBeNull();
  });

  test('reported head differs from expected: record the reported head, patchDigest stays null', () => {
    const bound = bindGateVerdict({ ...base, reportedHeadSha: OTHER, compareFiles: delivery });
    expect(bound?.headSha).toBe(OTHER);
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
    expect(bound?.outcome).toBe('pass');
  });

  test('review reports no head: use expectedHeadSha, the digest comes from this delivery patch', () => {
    expect(deliveryDigest).toMatch(/^pd2:[0-9a-f]{64}$/);
    const bound = bindGateVerdict({ ...base, reportedHeadSha: null, compareFiles: delivery });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.expectedHeadSha).toBe(HEAD);
    expect(bound?.patchDigest).toBe(deliveryDigest);
  });

  test('verify reports no head: expected is not substituted, no digest binding', () => {
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

  test('head matches and compare files given: patchDigest is the digest of this delivery patch', () => {
    const bound = bindGateVerdict({ ...base, compareFiles: delivery });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.patchDigest).toBe(deliveryDigest);
    expect(bound?.outcome).toBe('pass');
  });

  test('head matches but compare unavailable: patchDigest stays null', () => {
    const bound = bindGateVerdict({ ...base, compareFiles: null });
    expect(bound?.headSha).toBe(HEAD);
    expect(bound?.patchDigest).toBeNull();
  });

  test('step failure or extraction failure still binds the digest when the head aligns', () => {
    expect(
      bindGateVerdict({ ...base, stepFailed: true, compareFiles: delivery })?.patchDigest,
    ).toBe(deliveryDigest);
    expect(
      bindGateVerdict({ ...base, extracted: false, compareFiles: delivery })?.patchDigest,
    ).toBe(deliveryDigest);
  });

  test('verify only touched this ticket evidence directory after expected: the digest binds the delivery head, headSha records the evidence commit', () => {
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

  test('verify follow-up commits touch outside the evidence directory, give an empty list, or the directory belongs to another ticket: no digest binding, the head is still recorded', () => {
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
