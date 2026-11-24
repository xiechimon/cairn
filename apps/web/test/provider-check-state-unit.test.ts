import type { ProviderTestResult } from '@cairn/shared';
import { expect, it } from 'vitest';
import {
  applyListResponse,
  initialProviderRefresh,
  issueCheckGeneration,
  needsProviderList,
  recordModelResult,
  recordProviderResult,
  retireModelChecks,
  selectRowChecks,
  selectVisibleChecks,
  startModelChecks,
} from '../src/resources/provider-check-state.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const ID = 'relay';
const MODEL = 'small-model';
const OK: ProviderTestResult = {
  status: 'ok', failure: null, reason: null, detail: null, httpStatus: 200, latencyMs: 412,
};
const STALE: ProviderTestResult = {
  status: 'failed', failure: 'timeout', reason: null, detail: null, httpStatus: 504, latencyMs: null,
};

it.each([B, C])('C1: a GET returning %s cannot confirm a repeated check issued after it began', (returned) => {
  const first = issueCheckGeneration(initialProviderRefresh, ID, B, { fingerprint: A, fetching: false });
  const second = issueCheckGeneration(first, ID, B, { fingerprint: A, fetching: true });
  expect(second.generation).toBeGreaterThan(first.generation);

  const stale = applyListResponse(second, first.generation, [{ id: ID, configurationFingerprint: returned }]);
  expect(needsProviderList(stale, first.generation)).toBe(true);
  const fresh = applyListResponse(stale, stale.generation, [{ id: ID, configurationFingerprint: B }]);
  expect(needsProviderList(fresh)).toBe(false);
});

it('C1: a cached match does not waive a refresh if an older GET is in flight', () => {
  const matching = issueCheckGeneration(initialProviderRefresh, ID, B, { fingerprint: B, fetching: false });
  expect(needsProviderList(matching)).toBe(false);
  const check = issueCheckGeneration(matching, ID, B, { fingerprint: B, fetching: true });
  const stale = applyListResponse(check, matching.generation, [{ id: ID, configurationFingerprint: C }]);
  expect(needsProviderList(stale, matching.generation)).toBe(true);
});

it('C1: confirms only the covered providers and does not loop after a failed or legacy GET', () => {
  const earlier = issueCheckGeneration(initialProviderRefresh, ID, B, { fingerprint: A, fetching: false });
  const later = issueCheckGeneration(earlier, 'other', C, { fingerprint: A, fetching: true });
  const firstResponse = applyListResponse(later, earlier.generation, []);
  expect([...firstResponse.pending.keys()]).toEqual(['other']);
  expect(needsProviderList(firstResponse, earlier.generation)).toBe(true);
  expect(needsProviderList(firstResponse, later.generation)).toBe(false);
  const legacy = applyListResponse(firstResponse, later.generation, [{ id: 'other' }]);
  expect(needsProviderList(legacy)).toBe(true);
  expect(needsProviderList(legacy, later.generation)).toBe(false);
  const authoritative = applyListResponse(legacy, later.generation, [{ id: 'other', configurationFingerprint: B }]);
  expect(needsProviderList(authoritative)).toBe(false);
});

it.each([false, true])('C1 C22: selects the server-tested fingerprint across a save (save first=%s)', (saveFirst) => {
  const running = { phase: 'running' } as const;
  const started = startModelChecks(new Map(), A, { [MODEL]: running });
  expect(selectVisibleChecks(started, A)[MODEL]).toBe(running);
  const result = { ...OK, configurationFingerprint: B };
  const outcome = { phase: 'done', result, at: 2 } as const;
  const record = (checks: typeof started) => recordModelResult(checks, A, MODEL, running, outcome, true);
  const saved = saveFirst ? retireModelChecks(started, A) : record(started);
  expect(selectVisibleChecks(saved, saveFirst ? B : A)).toEqual({});
  const settled = saveFirst ? record(saved) : retireModelChecks(saved, A);
  expect(selectVisibleChecks(settled, A)).toEqual({});
  expect(selectVisibleChecks(settled, B)[MODEL]).toBe(outcome);
  const rows = recordProviderResult({}, ID, MODEL, result);
  expect(selectRowChecks(rows[ID], A)).toBeUndefined();
  expect(selectRowChecks(rows[ID], B)?.[MODEL]).toBe(result);
});

it.each([true, false])('C22: an older run cannot clear a pending check owned by a newer run (moved=%s)', (moved) => {
  const stale = { phase: 'running' } as const;
  const current = { phase: 'running' } as const;
  let checks = startModelChecks(new Map(), A, { [MODEL]: stale });
  checks = startModelChecks(checks, moved ? B : A, { [MODEL]: current });
  const outcome = {
    phase: 'done',
    result: { ...OK, configurationFingerprint: moved ? B : A },
    at: 2,
  } as const;
  const next = recordModelResult(checks, A, MODEL, stale, outcome, true);
  expect(selectVisibleChecks(next, moved ? B : A)[MODEL]).toBe(current);
  if (moved) expect(selectVisibleChecks(next, A)[MODEL]).toBeUndefined();
});

it.each([true, false])('C22: an older run cannot overwrite a completed check owned by a newer run (moved=%s)', (moved) => {
  const stale = { phase: 'running' } as const;
  const current = { phase: 'running' } as const;
  let checks = startModelChecks(new Map(), A, { [MODEL]: stale });
  checks = startModelChecks(checks, moved ? B : A, { [MODEL]: current });
  const destination = moved ? B : A;
  const newer = {
    phase: 'done',
    result: { ...OK, configurationFingerprint: destination },
    at: 2,
  } as const;
  checks = recordModelResult(checks, destination, MODEL, current, newer, true);
  const staleOutcome = {
    phase: 'done',
    result: { ...STALE, configurationFingerprint: destination },
    at: 3,
  } as const;
  const next = recordModelResult(checks, A, MODEL, stale, staleOutcome, true);
  expect(selectVisibleChecks(next, destination)[MODEL]).toBe(newer);
});

it.each([true, false])('C22: an older run cannot replace a completed check with an unfinished one (moved=%s)', (moved) => {
  const stale = { phase: 'running' } as const;
  const current = { phase: 'running' } as const;
  let checks = startModelChecks(new Map(), A, { [MODEL]: stale });
  checks = startModelChecks(checks, moved ? B : A, { [MODEL]: current });
  const destination = moved ? B : A;
  const newer = {
    phase: 'done',
    result: { ...OK, configurationFingerprint: destination },
    at: 2,
  } as const;
  checks = recordModelResult(checks, destination, MODEL, current, newer, true);
  const next = recordModelResult(checks, A, MODEL, stale, { phase: 'unavailable', at: 3 }, true);
  expect(selectVisibleChecks(next, destination)[MODEL]).toBe(newer);
});

it.each([undefined, A])('C22: a fingerprint-less result matches only a missing detail fingerprint (started at %s)', (startedWith) => {
  const running = { phase: 'running' } as const;
  const started = startModelChecks(new Map(), startedWith, { [MODEL]: running });
  const outcome = { phase: 'done', result: OK, at: 2 } as const;
  const settled = recordModelResult(started, startedWith, MODEL, running, outcome, true);
  expect(selectVisibleChecks(settled, undefined)[MODEL]).toBe(outcome);
  expect(selectVisibleChecks(settled, A)).toEqual({});
  const rows = recordProviderResult({}, ID, MODEL, { ...OK, configurationFingerprint: A });
  expect(recordProviderResult(rows, ID, MODEL, OK)).toBe(rows);
  expect(selectRowChecks(rows[ID], undefined)).toBeUndefined();
  const refresh = issueCheckGeneration(initialProviderRefresh, ID, undefined, { fingerprint: A, fetching: true });
  expect(refresh.generation).toBe(1);
  expect(needsProviderList(refresh)).toBe(false);
});
