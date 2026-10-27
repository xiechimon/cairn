import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { appendGateRun, readGateRuns } from '../src/services/machine-gate-storage.js';
import { auditMergedGate } from '../src/services/merge-gate/audit.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gate-audit-'));
  dirs.push(dir);
  return dir;
}
function run(ready = false) {
  return {
    id: 'run-1',
    buildId: 'build-1',
    at: 1,
    headSha: 'a'.repeat(40),
    patchDigest: 'sha256:patch',
    ready,
    blockerCodes: ready ? [] : ['review-blocking'],
    merged: false,
    mismatchIssue: null,
    action: { status: 'written' as const, autoMerge: 'not-requested' as const },
    reviewers: [
      {
        stepId: 'review-1',
        kind: 'review' as const,
        modelId: 'gpt-5.4',
        rawOutput: `Prompt says VERDICT: pass or VERDICT: block\nVERDICT: block\nghp_${'A'.repeat(36)}`,
        verdict: { conclusion: 'Block', gateLoosening: true, evalRulerChange: false, findings: [] },
        outcome: 'block',
      },
    ],
  };
}

test('every gate run retains raw output, parsed verdict, model and action with secrets redacted', () => {
  const dir = directory();
  appendGateRun(dir, run());
  appendGateRun(dir, { ...run(true), id: 'run-2', at: 2 });
  const records = readGateRuns(dir, 'build-1');
  expect(records).toHaveLength(2);
  expect(records[0]?.reviewers[0]).toMatchObject({
    modelId: 'gpt-5.4',
    verdict: { gateLoosening: true },
    outcome: 'block',
  });
  expect(records[0]?.reviewers[0]?.rawOutput).toContain('VERDICT: block');
  expect(records[0]?.reviewers[0]?.rawOutput).toContain('[REDACTED]');
  expect(records[0]?.action).toEqual({ status: 'written', autoMerge: 'not-requested' });
  expect(readFileSync(join(dir, 'gate-runs/build-1.jsonl'), 'utf8')).not.toContain('ghp_');
});

test('a merged head blocked by its last run creates one deduplicated mismatch issue', async () => {
  const dir = directory();
  appendGateRun(dir, run());
  const issues: { number: number; body: string }[] = [];
  const port = {
    readIssuePage: async () => ({ issues, hasMore: false }),
    createIssue: async (input: { title: string; body: string }) => {
      expect(input.title).toContain('gate mismatch');
      expect(input.body).toContain('review-blocking');
      issues.push({ number: 9, body: input.body });
      return 9;
    },
  };
  const input = { buildId: 'build-1', prNumber: 7, headSha: 'a'.repeat(40), merged: true };
  expect(await auditMergedGate((id) => readGateRuns(dir, id), input, port)).toBe(9);
  expect(await auditMergedGate((id) => readGateRuns(dir, id), input, port)).toBe(9);
  expect(issues).toHaveLength(1);
  expect(
    await auditMergedGate((id) => readGateRuns(dir, id), { ...input, merged: false }, port),
  ).toBeNull();
});

test('a matching ready run does not create an issue, while a pass for another head cannot clear a block', async () => {
  const dir = directory();
  appendGateRun(dir, run(true));
  const port = {
    readIssuePage: async () => ({ issues: [], hasMore: false }),
    createIssue: async () => {
      throw new Error('unexpected issue');
    },
  };
  const input = { buildId: 'build-1', prNumber: 7, headSha: 'a'.repeat(40), merged: true };
  expect(await auditMergedGate((id) => readGateRuns(dir, id), input, port)).toBeNull();
  expect(
    await auditMergedGate(
      (id) => readGateRuns(dir, id),
      { ...input, headSha: 'b'.repeat(40) },
      port,
    ),
  ).toBeNull();
});
