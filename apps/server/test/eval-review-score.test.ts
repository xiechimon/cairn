import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  type AnswersFile,
  buildLabelerTrust,
  cohenKappa,
  labelerVendor,
  type ReviewLabelRecord,
  scoreReviewWeeks,
  wilsonAgreementInterval,
} from '../src/eval-review-score.js';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function packRecord(
  itemId: string,
  buildId: string,
  hand: { where: string; why: string },
  reader: { model: string; vendor: string },
): ReviewLabelRecord {
  return {
    itemId,
    source: 'pack',
    buildId,
    verdictClass: 'agent-mistake',
    where: hand.where as ReviewLabelRecord['where'],
    why: hand.why as ReviewLabelRecord['why'],
    note: 'hand label',
    reader,
  };
}

test("Cohen's kappa on a fixed 2x2 fixture matches the reference value 0.5", () => {
  const pairs: Array<[string, string]> = [
    ...Array.from({ length: 15 }, () => ['prompt', 'prompt'] as [string, string]),
    ...Array.from({ length: 5 }, () => ['prompt', 'runtime'] as [string, string]),
    ...Array.from({ length: 5 }, () => ['runtime', 'prompt'] as [string, string]),
    ...Array.from({ length: 15 }, () => ['runtime', 'runtime'] as [string, string]),
  ];
  const result = cohenKappa(pairs);
  expect(result.n).toBe(40);
  expect(result.agreement).toBeCloseTo(0.75, 10);
  expect(result.chanceAgreement).toBeCloseTo(0.5, 10);
  expect(result.kappa).toBeCloseTo(0.5, 10);
});

test('perfect agreement gives kappa 1 and chance agreement about 0', () => {
  const pairs: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => {
    const label = `label-${i}`;
    return [label, label];
  });
  const result = cohenKappa(pairs);
  expect(result.agreement).toBe(1);
  expect(result.chanceAgreement).toBeCloseTo(0.05, 10);
  expect(result.kappa).toBeCloseTo(1, 10);
});

test('degenerate marginals report kappa null with n, not a fake 1', () => {
  const pairs: Array<[string, string]> = Array.from({ length: 12 }, () => ['prompt', 'prompt']);
  const result = cohenKappa(pairs);
  expect(result.n).toBe(12);
  expect(result.agreement).toBe(1);
  expect(result.chanceAgreement).toBe(1);
  expect(result.kappa).toBeNull();
});

test('trusted stays false at 29 labels even with 100% agreement', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const records = Array.from({ length: 29 }, (_, i) =>
    packRecord(`item-${i}`, `build-${i}`, { where: 'prompt', why: 'wrong_tool' }, reader),
  );
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: Object.fromEntries(
      records.map((record) => [record.itemId, { where: 'prompt', why: 'wrong_tool' }]),
    ),
  };
  const scored = scoreReviewWeeks([{ week: '2026-W44', records, answers }]);
  const trust = buildLabelerTrust(scored);
  expect(trust.labels).toBe(29);
  expect(trust.whereAgreement).toBe(1);
  expect(scored.where.interval95?.[0]).toBeGreaterThan(0.8);
  expect(trust.trusted).toBe(false);
});

test('trusted turns true at 30 labels when the where lower bound is at least 0.8', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const records = Array.from({ length: 30 }, (_, i) =>
    packRecord(`item-${i}`, `build-${i}`, { where: 'prompt', why: 'wrong_tool' }, reader),
  );
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: Object.fromEntries(
      records.map((record) => [record.itemId, { where: 'prompt', why: 'wrong_tool' }]),
    ),
  };
  const scored = scoreReviewWeeks([{ week: '2026-W44', records, answers }]);
  const trust = buildLabelerTrust(scored);
  expect(trust.labels).toBe(30);
  expect(scored.where.interval95?.[0]).toBeGreaterThanOrEqual(0.8);
  expect(trust.trusted).toBe(true);
});

test('trusted stays false at 30 labels with 24/30 where agreement (point estimate vs lower bound)', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const records = Array.from({ length: 30 }, (_, i) => {
    const agree = i < 24;
    return packRecord(
      `item-${i}`,
      `build-${i}`,
      {
        where: agree ? 'prompt' : 'runtime',
        why: 'wrong_tool',
      },
      reader,
    );
  });
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: Object.fromEntries(
      records.map((record) => [record.itemId, { where: 'prompt', why: 'wrong_tool' }]),
    ),
  };
  const scored = scoreReviewWeeks([{ week: '2026-W44', records, answers }]);
  const trust = buildLabelerTrust(scored);
  expect(trust.labels).toBe(30);
  expect(trust.whereAgreement).toBeCloseTo(0.8, 10);
  expect(scored.where.interval95?.[0]).toBeLessThan(0.8);
  expect(wilsonAgreementInterval(24, 30)?.[0]).toBeLessThan(0.8);
  expect(trust.trusted).toBe(false);
});

test("a record whose reader vendor equals the labeler's vendor is rejected", () => {
  const records = [
    packRecord(
      'item-1',
      'build-1',
      { where: 'prompt', why: 'wrong_tool' },
      { model: 'claude-opus-4', vendor: 'anthropic' },
    ),
  ];
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(labelerVendor(answers.labelerModel)).toBe('anthropic');
  expect(() => scoreReviewWeeks([{ week: '2026-W44', records, answers }])).toThrow(
    /reader vendor equals the labeler vendor/i,
  );
});

test('null where or why labels are rejected and cannot establish agreement', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const base = packRecord('item-1', 'build-1', { where: 'prompt', why: 'wrong_tool' }, reader);
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(() =>
    scoreReviewWeeks([
      {
        week: '2026-W44',
        records: [{ ...base, where: null as unknown as ReviewLabelRecord['where'] }],
        answers,
      },
    ]),
  ).toThrow(/invalid where/i);
  expect(() =>
    scoreReviewWeeks([
      {
        week: '2026-W44',
        records: [{ ...base, why: null as unknown as ReviewLabelRecord['why'] }],
        answers,
      },
    ]),
  ).toThrow(/invalid why/i);
});

test('invalid where or why enum labels are rejected', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const base = packRecord('item-1', 'build-1', { where: 'prompt', why: 'wrong_tool' }, reader);
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(() =>
    scoreReviewWeeks([
      {
        week: '2026-W44',
        records: [{ ...base, where: 'not-a-where' as ReviewLabelRecord['where'] }],
        answers,
      },
    ]),
  ).toThrow(/invalid where/i);
  expect(() =>
    scoreReviewWeeks([
      {
        week: '2026-W44',
        records: [{ ...base, why: 'not-a-why' as ReviewLabelRecord['why'] }],
        answers,
      },
    ]),
  ).toThrow(/invalid why/i);
});

test('empty reader.vendor cannot bypass same-vendor rejection when model maps to the labeler', () => {
  const records = [
    packRecord(
      'item-1',
      'build-1',
      { where: 'prompt', why: 'wrong_tool' },
      { model: 'claude-opus-4', vendor: '' },
    ),
  ];
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(() => scoreReviewWeeks([{ week: '2026-W44', records, answers }])).toThrow(
    /reader vendor equals the labeler vendor/i,
  );
});

test('wrong-cased reader.vendor Anthropic cannot bypass same-vendor rejection', () => {
  const records = [
    packRecord(
      'item-1',
      'build-1',
      { where: 'prompt', why: 'wrong_tool' },
      { model: 'claude-opus-4', vendor: 'Anthropic' },
    ),
  ];
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(() => scoreReviewWeeks([{ week: '2026-W44', records, answers }])).toThrow(
    /reader vendor equals the labeler vendor/i,
  );
});

test('unresolved reader.model vendor is rejected', () => {
  const records = [
    packRecord(
      'item-1',
      'build-1',
      { where: 'prompt', why: 'wrong_tool' },
      { model: 'mystery-model', vendor: 'openai' },
    ),
  ];
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: { 'item-1': { where: 'prompt', why: 'wrong_tool' } },
  };
  expect(() => scoreReviewWeeks([{ week: '2026-W44', records, answers }])).toThrow(
    /unresolved reader vendor/i,
  );
});

test('conflicting repeated labels for the same item identity across weeks are rejected', () => {
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const first = packRecord('item-a', 'build-1', { where: 'prompt', why: 'wrong_tool' }, reader);
  const second = packRecord('item-b', 'build-1', { where: 'runtime', why: 'wrong_tool' }, reader);
  const answersFor = (record: ReviewLabelRecord): AnswersFile => ({
    labelerModel: 'claude-sonnet-4',
    items: {
      [record.itemId]: { where: 'prompt', why: 'wrong_tool' },
    },
  });
  expect(() =>
    scoreReviewWeeks([
      { week: '2026-W44', records: [first], answers: answersFor(first) },
      { week: '2026-W45', records: [second], answers: answersFor(second) },
    ]),
  ).toThrow(/Conflicting review.*build-1/i);
});

test('labeler-trust.json shape uses Wilson lower bound, not the raw point estimate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-review-score-'));
  temps.push(dir);
  const path = join(dir, 'labeler-trust.json');
  const reader = { model: 'gpt-5', vendor: 'openai' };
  const records = Array.from({ length: 30 }, (_, i) =>
    packRecord(
      `item-${i}`,
      `build-${i}`,
      { where: i < 24 ? 'prompt' : 'runtime', why: 'wrong_tool' },
      reader,
    ),
  );
  const answers: AnswersFile = {
    labelerModel: 'claude-sonnet-4',
    items: Object.fromEntries(
      records.map((record) => [record.itemId, { where: 'prompt', why: 'wrong_tool' }]),
    ),
  };
  const scored = scoreReviewWeeks([{ week: '2026-W44', records, answers }]);
  const trust = buildLabelerTrust(scored);
  writeFileSync(path, `${JSON.stringify(trust, null, 2)}\n`);
  const written = JSON.parse(readFileSync(path, 'utf8')) as typeof trust;
  expect(written).toEqual({
    labels: trust.labels,
    whereAgreement: trust.whereAgreement,
    whyAgreement: trust.whyAgreement,
    kappaWhere: trust.kappaWhere,
    kappaWhy: trust.kappaWhy,
    trusted: false,
  });
  expect(Object.keys(written).sort()).toEqual(
    ['kappaWhere', 'kappaWhy', 'labels', 'trusted', 'whereAgreement', 'whyAgreement'].sort(),
  );
});
