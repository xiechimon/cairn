import {
  CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  EVIDENCE_PREFIX,
  HARNESS_REGRESSION_RESULT_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  buildHarnessEvalResult,
  decisionOkRate,
  harnessEvalResultRelPath,
  traceDigest,
} from '../eval/chief-dispatch/harness-eval-result.mts';

describe('harness-eval-result', () => {
  test('decisionOkRate is the share of passing rows', () => {
    expect(decisionOkRate([])).toBeNull();
    expect(
      decisionOkRate([
        { grade: { decision_ok: 1 } },
        { grade: { decision_ok: 0 } },
        { grade: { decision_ok: 1 } },
      ]),
    ).toBeCloseTo(2 / 3);
  });

  test('traceDigest sorts by file name and binds to content', () => {
    const a = { name: 'b.json', body: new TextEncoder().encode('one') };
    const b = { name: 'a.json', body: new TextEncoder().encode('two') };
    expect(traceDigest([a, b])).toBe(traceDigest([b, a]));
    expect(traceDigest([a])).not.toBe(traceDigest([{ ...a, body: new TextEncoder().encode('x') }]));
    expect(traceDigest([])).toMatch(/^[0-9a-f]{64}$/);
  });

  test('buildHarnessEvalResult writes the fields the gate requires', () => {
    const row = buildHarnessEvalResult({
      patchDigest: `pd2:${'1'.repeat(64)}`,
      harness_sha: '2'.repeat(64),
      decision_ok: CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
      trace_digest: '3'.repeat(64),
    });
    expect(row.decision_ok).toBe(CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER);
    expect(harnessEvalResultRelPath('1578')).toBe(
      `${EVIDENCE_PREFIX}1578/${HARNESS_REGRESSION_RESULT_NAME}`,
    );
  });
});
