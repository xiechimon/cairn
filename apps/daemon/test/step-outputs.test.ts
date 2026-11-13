import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INFO_REPORT_MAX_BYTES, PLAN_FILE_NAME, type VerifyVerdict } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { readDeliveredPlan, readInfoReport, requireUploadedEvidence } from '../src/step-outputs.js';
import { testTempDir } from './test-temp-dir.js';

describe('readInfoReport', () => {
  test('a missing or blank report is absent', () => {
    const dir = testTempDir('cairn-step-outputs-report-');
    expect(readInfoReport(join(dir, 'missing.md'))).toEqual({ kind: 'absent' });
    writeFileSync(join(dir, 'blank.md'), '  \n', 'utf8');
    expect(readInfoReport(join(dir, 'blank.md'))).toEqual({ kind: 'absent' });
  });

  test('returns the report content', () => {
    const file = join(testTempDir('cairn-step-outputs-report-'), 'report.md');
    writeFileSync(file, '# Findings\n', 'utf8');
    expect(readInfoReport(file)).toEqual({ kind: 'report', content: '# Findings\n' });
  });

  test('refuses a report over the byte limit', () => {
    const file = join(testTempDir('cairn-step-outputs-report-'), 'report.md');
    writeFileSync(file, 'x'.repeat(INFO_REPORT_MAX_BYTES + 1), 'utf8');
    const read = readInfoReport(file);
    expect(read.kind).toBe('too-large');
  });
});

describe('readDeliveredPlan', () => {
  test('prefers the conversation plan file over the worktree one', () => {
    const root = testTempDir('cairn-step-outputs-plan-');
    const plansDir = join(root, 'plans');
    const cwd = join(root, 'wt');
    mkdirSync(join(plansDir, 'conv'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(plansDir, 'conv', PLAN_FILE_NAME), 'conversation plan', 'utf8');
    writeFileSync(join(cwd, PLAN_FILE_NAME), 'worktree plan', 'utf8');
    expect(readDeliveredPlan(plansDir, 'conv', cwd)).toBe('conversation plan');
  });

  test('does not fall back to the worktree when the conversation plan is blank', () => {
    const root = testTempDir('cairn-step-outputs-plan-');
    const plansDir = join(root, 'plans');
    const cwd = join(root, 'wt');
    mkdirSync(join(plansDir, 'conv'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(plansDir, 'conv', PLAN_FILE_NAME), ' ', 'utf8');
    writeFileSync(join(cwd, PLAN_FILE_NAME), 'worktree plan', 'utf8');
    expect(readDeliveredPlan(plansDir, 'conv', cwd)).toBeNull();
  });

  test('falls back to the worktree plan when no conversation plan exists', () => {
    const root = testTempDir('cairn-step-outputs-plan-');
    const cwd = join(root, 'wt');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, PLAN_FILE_NAME), 'worktree plan', 'utf8');
    expect(readDeliveredPlan(join(root, 'plans'), 'conv', cwd)).toBe('worktree plan');
  });
});

describe('requireUploadedEvidence', () => {
  const passed: VerifyVerdict = {
    passed: true,
    conclusion: 'ok',
    evidence: [{ path: 'shots/a.png', note: 'a' }],
  };

  test('keeps a passing verdict whose evidence was all uploaded', () => {
    expect(requireUploadedEvidence(passed, new Set(['/wt/shots/a.png']), '/wt')).toBe(passed);
  });

  test('fails a passing verdict with evidence that was not uploaded', () => {
    const result = requireUploadedEvidence(passed, new Set(), '/wt');
    expect(result.passed).toBe(false);
    expect(result.conclusion).toContain('Attachment evidence is missing');
  });

  test('fails a passing verdict with no evidence', () => {
    expect(requireUploadedEvidence({ ...passed, evidence: [] }, new Set(), '/wt').passed).toBe(
      false,
    );
  });

  test('leaves a failing verdict unchanged', () => {
    const failed = { ...passed, passed: false };
    expect(requireUploadedEvidence(failed, new Set(), '/wt')).toBe(failed);
  });
});
