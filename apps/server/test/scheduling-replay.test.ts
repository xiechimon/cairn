import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  planSchedule,
  type ScheduleInput,
  type ScheduleIssue,
} from '../src/services/scheduling/plan.js';

interface ReplayFixture {
  capturedAt: string;
  generatedAt: string;
  mainSha: string;
  issues: ScheduleIssue[];
  mergedPulls: ScheduleInput['mergedPulls'];
  specLedger: string[];
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/1583-2026-10-23-open.json'), 'utf8'),
) as ReplayFixture;

const replay = () =>
  planSchedule({
    generatedAt: Date.parse(fixture.generatedAt),
    mainSha: fixture.mainSha,
    issues: fixture.issues,
    mergedPulls: fixture.mergedPulls,
    specLedger: fixture.specLedger,
    inFlight: new Map(),
  });

const EXPECTED_CLOSES = [1394, 1403, 1528, 1555];

describe('replay of the 2026-10-23 manual sweep (#1583)', () => {
  test('the fixture holds the open tickets and the ledger as they stood that morning', () => {
    expect(fixture.issues.length).toBeGreaterThan(20);
    for (const number of EXPECTED_CLOSES) {
      expect(fixture.issues.some((i) => i.number === number)).toBe(true);
    }
    expect(fixture.specLedger.length).toBeGreaterThan(0);
  });

  test('every ticket the human closed that morning is suggested for closure with a citation', () => {
    const report = replay();
    for (const number of EXPECTED_CLOSES) {
      const item = report.items.find((i) => i.issue === number);
      expect(item, `#${number} is missing from the replay`).toBeDefined();
      expect(item?.group, `#${number} is not in the close group`).toBe('close');
      expect(item?.evidence.length ?? 0).toBeGreaterThan(0);
      const cited = item?.evidence.every((e) => e.ref.length > 1);
      expect(cited).toBe(true);
      expect(item?.reason.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('a close suggestion always names the merged pull, ledger row or ticket it rests on', () => {
    const report = replay();
    expect(report.groups.close.length).toBeGreaterThanOrEqual(EXPECTED_CLOSES.length);
    for (const item of report.items.filter((i) => i.group === 'close')) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.closeReason).not.toBeNull();
    }
  });

  test('a ticket with unchecked acceptance boxes and no handed-over evidence is never closed', () => {
    const report = replay();
    for (const item of report.items.filter((i) => i.group === 'close')) {
      const source = fixture.issues.find((i) => i.number === item.issue);
      const body = source?.body ?? '';
      if (!/^\s*[-*+]\s+\[ \]/mu.test(body)) continue;
      const kinds = item.evidence.map((e) => e.kind);
      expect(kinds.some((k) => k === 'handover' || k === 'ledger-line')).toBe(true);
    }
  });

  test('no ticket whose dependency is still open lands in now', () => {
    const report = replay();
    const open = new Set(fixture.issues.map((i) => i.number));
    for (const item of report.items.filter((i) => i.group === 'now')) {
      for (const dep of item.deps) expect(open.has(dep)).toBe(false);
    }
  });

  test('the replay is deterministic: the same input yields the same groups', () => {
    const first = replay();
    const second = replay();
    expect(second.groups).toEqual(first.groups);
    expect(second.items.map((i) => i.reason)).toEqual(first.items.map((i) => i.reason));
  });
});
