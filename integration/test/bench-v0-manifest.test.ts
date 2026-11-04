import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = join(import.meta.dirname, '../eval/harbor');

test('bench-v0 records only independently agreed tasks with paired control evidence', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'bench-v0.json'), 'utf8'));
  expect(manifest.harborVersion).toBe('0.25.0');
  expect(manifest.target).toBe(30);
  const kept = manifest.tasks.filter((task: { kept: boolean }) => task.kept);
  expect(kept.length).toBeLessThanOrEqual(30);
  expect(manifest.complete).toBe(kept.length === 30);
  for (const task of kept) {
    expect(task.oracle.status).toBe('pass');
    expect(task.nop.status).toBe('fail');
    expect(task.nop.failureKind).toBe('assertion');
    expect(task.labels).toHaveLength(2);
    expect(new Set(task.labels.map((label: { vendor: string }) => label.vendor)).size).toBe(2);
    expect(task.labels.every((label: { verdict: string }) => label.verdict === 'accept')).toBe(
      true,
    );
    expect(task.baseSha).toMatch(/^[a-f0-9]{40}$/);
    expect(task.partition).toBe(task.issue % 2 === 0 ? 'optimize' : 'holdout');
    for (const trial of [task.oracle, task.nop]) {
      expect(readFileSync(join(root, trial.log), 'utf8').length).toBeGreaterThan(0);
    }
    const instruction = readFileSync(
      join(root, `tasks/bench-v0/${task.pr}/instruction.md`),
      'utf8',
    );
    expect(instruction).not.toContain('tests/tests.patch');
  }
  if (manifest.complete) {
    expect(
      kept.filter((task: { partition: string }) => task.partition === 'holdout').length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      kept.filter((task: { partition: string }) => task.partition === 'holdout').length,
    ).toBeLessThanOrEqual(20);
  } else {
    expect(manifest.blockers.length).toBeGreaterThan(0);
  }
});

test('bench-v0 conversion status is consistent and keeps the benchmark incomplete until controls run', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'bench-v0.json'), 'utf8'));
  const { conversion } = manifest;
  expect(conversion.taskRepoCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(conversion.perPr).toHaveLength(conversion.converted + conversion.failed);
  const accepted = conversion.perPr.filter(
    (row: { openaiLabel: string }) => row.openaiLabel === 'accept',
  );
  expect(accepted).toHaveLength(conversion.openaiAccepted);
  expect(conversion.openaiAccepted + conversion.openaiRejected).toBe(conversion.converted);
  expect(conversion.labelRubric).toBe('graded-v1');
  for (const row of conversion.perPr) {
    expect(row.partition).toBe(row.issue % 2 === 0 ? 'optimize' : 'holdout');
    expect(row.openaiLabel).toBe(
      row.underspecification <= 1 && row.testValidity <= 1 ? 'accept' : 'reject',
    );
  }
  for (const key of ['underspecificationDistribution', 'testValidityDistribution']) {
    const total = Object.values(conversion[key] as Record<string, number>).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(total).toBe(conversion.converted);
  }
  if (conversion.controls === 'pending') {
    expect(manifest.complete).toBe(false);
    expect(manifest.tasks).toHaveLength(0);
  }
});
