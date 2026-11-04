import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  acceptanceBoxes,
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

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/1583-2026-10-23-open.json');
const REPORT_PATH = join(import.meta.dirname, '../../../docs/verify/1583/replay-report.json');
const CUTOFF = '2026-10-23T10:56:00Z';
const MAIN_SHA_PREFIX = '1442c6af';

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ReplayFixture;

const replay = () =>
  planSchedule({
    generatedAt: Date.parse(fixture.generatedAt),
    mainSha: fixture.mainSha,
    issues: fixture.issues,
    mergedPulls: fixture.mergedPulls,
    specLedger: fixture.specLedger,
    inFlight: new Map(),
  });

const FOCUS = [1394, 1403, 1528, 1555] as const;

describe('replay of the 2026-10-23 manual sweep (#1583)', () => {
  test('the fixture holds exactly the 45 open tickets at the cutoff with the real mainSha', () => {
    expect(fixture.issues).toHaveLength(45);
    expect(fixture.mainSha.startsWith(MAIN_SHA_PREFIX)).toBe(true);
    expect(fixture.generatedAt).toBe(CUTOFF);
    for (const number of FOCUS) {
      expect(fixture.issues.some((i) => i.number === number)).toBe(true);
    }
    expect(fixture.specLedger.length).toBeGreaterThan(0);
  });

  test('no issue carries a comment dated after the cutoff', () => {
    const cutoffMs = Date.parse(CUTOFF);
    for (const issue of fixture.issues) {
      for (const comment of issue.comments ?? []) {
        expect(typeof comment).toBe('string');
        expect(comment.length).toBeGreaterThan(0);
      }
      expect(issue.createdAt).toBeLessThanOrEqual(cutoffMs);
    }
  });

  test('focus tickets close only when the box guard and merged-pull body evidence both pass', () => {
    const report = replay();
    for (const number of FOCUS) {
      const source = fixture.issues.find((i) => i.number === number);
      expect(source, `#${number} missing`).toBeDefined();
      const item = report.items.find((i) => i.issue === number);
      expect(item, `#${number} missing from report`).toBeDefined();
      const boxes = acceptanceBoxes(source?.body ?? '');
      const mergedNames = fixture.mergedPulls.some((p) =>
        new RegExp(`#${number}(?!\\d)`, 'u').test(p.body ?? ''),
      );
      if (boxes.checked > 0 && boxes.unchecked === 0 && mergedNames) {
        expect(item?.group, `#${number} should close`).toBe('close');
        expect(item?.evidence.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(item?.group, `#${number} must not close past the box guard`).not.toBe('close');
        expect(item?.reason).toMatch(/人工判断|验收还差|无在飞|依赖|ready-for-agent|维持待办/);
      }
    }
  });

  test('a close suggestion always names the merged pull, ledger row or ticket it rests on', () => {
    const report = replay();
    for (const item of report.items.filter((i) => i.group === 'close')) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.closeReason).not.toBeNull();
    }
  });

  test('unchecked acceptance boxes never produce a close without completed boxes and a merged-pull body', () => {
    const report = replay();
    for (const item of report.items.filter((i) => i.group === 'close')) {
      const source = fixture.issues.find((i) => i.number === item.issue);
      const boxes = acceptanceBoxes(source?.body ?? '');
      expect(boxes.unchecked).toBe(0);
      expect(boxes.checked).toBeGreaterThan(0);
      expect(
        item.evidence.some((e) => e.kind === 'merged-pull' || e.kind === 'superseding-issue'),
      ).toBe(true);
    }
  });

  test('no ticket whose dependency is still open lands in now', () => {
    const report = replay();
    const open = new Set(fixture.issues.map((i) => i.number));
    for (const item of report.items.filter((i) => i.group === 'now')) {
      for (const dep of item.deps) expect(open.has(dep)).toBe(false);
    }
  });

  test('the replay is deterministic and writes the report JSON under docs/verify/1583', () => {
    const first = replay();
    const second = replay();
    expect(second.groups).toEqual(first.groups);
    expect(second.items.map((i) => i.reason)).toEqual(first.items.map((i) => i.reason));
    const payload = {
      generatedAt: first.generatedAt,
      mainSha: first.mainSha,
      groups: first.groups,
      items: first.items,
      unparsedDeps: first.unparsedDeps,
      focus: FOCUS.map((number) => {
        const item = first.items.find((i) => i.issue === number);
        const source = fixture.issues.find((i) => i.number === number);
        const boxes = acceptanceBoxes(source?.body ?? '');
        return {
          issue: number,
          group: item?.group ?? null,
          closeReason: item?.closeReason ?? null,
          reason: item?.reason ?? null,
          evidence: item?.evidence ?? [],
          acceptance: boxes,
        };
      }),
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as typeof payload;
    expect(committed.groups).toEqual(first.groups);
    expect(committed.focus.map((f) => f.issue)).toEqual([...FOCUS]);
  });
});
