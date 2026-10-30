import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReplanPrompt } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { isLearnCase } from '../eval/learn/grade.mts';
import { isMemoryCase } from '../eval/memory-regression/grade.mts';
import { isPlanCase } from '../eval/plan/grade.mts';
import { planFileAt } from '../eval/plan/revision-arm.mts';
import {
  gradeRevisionArm,
  gradeRevisionCase,
  isRevisionCase,
  type RevisionCase,
} from '../eval/plan/revision-grade.mts';
import { isRoutingCase } from '../eval/project-routing/grade.mts';

const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/plan-revision');
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  roster: { key: string }[];
  cases: RevisionCase[];
};
const state = JSON.parse(readFileSync(join(FLOW_DIR, '_state.json'), 'utf8')) as {
  metrics: { id: string }[];
  perf_fields: { id: string }[];
  harness_paths: string[];
};
const cases = flow.cases;

const PRIOR = [
  '## Context',
  'Safari ignores the download attribute on a blob URL, so the export silently does nothing.',
  '',
  '## Changes',
  'Append more logging around the download path.',
  '',
  '## Edge cases',
  '- Empty export payload.',
  '',
  '## Verification',
  '- `apps/web/e2e/export-download.spec.ts` passes',
].join('\n');

const baseCase: RevisionCase = {
  id: 'sample',
  tags: ['revision'],
  prompt: 'Export button does nothing on Safari.',
  priorPlan: PRIOR,
  feedback: 'It is the download attribute on a blob URL.',
  expect: {
    kind: 'revision',
    defect: ['download attribute', 'blob url'],
    drop: ['logging'],
    keep: ['export-download.spec.ts'],
    minPlanChars: 120,
  },
};

const revised = [
  '## Context',
  'Safari ignores the download attribute on a blob URL, so the export silently does nothing.',
  '',
  '## Changes',
  'Replace the download attribute with a blob URL plus an explicit anchor click.',
  '',
  '## Edge cases',
  '- Empty export payload.',
  '',
  '## Verification',
  '- `apps/web/e2e/export-download.spec.ts` passes',
].join('\n');

describe('revision case ledger', () => {
  test('ids are unique and every case is a revision case only', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(flow.roster.length).toBeGreaterThan(0);
    for (const c of cases) {
      expect(isRevisionCase(c), c.id).toBe(true);
      expect(isPlanCase(c), c.id).toBe(false);
      expect(isMemoryCase(c), c.id).toBe(false);
      expect(isRoutingCase(c), c.id).toBe(false);
      expect(isLearnCase(c), c.id).toBe(false);
    }
  });

  test('the prior plan fails the revision requirements on its own', () => {
    const g = gradeRevisionArm(baseCase, { planContent: PRIOR, stepStatus: 'done' });
    expect(g.grade.revision_arm_ok).toBe(0);
    expect(g.explanation.revision_arm_ok).toMatch(/rejected approach.*defect not addressed/i);
  });

  test('state declares the revision metrics and the harness paths', () => {
    expect(state.metrics.map((m) => m.id)).toEqual(
      expect.arrayContaining(['revision_ok', 'control_flipped']),
    );
    for (const id of [
      'in_tokens',
      'out_tokens',
      'cache_read_tokens',
      'tool_calls',
      'cost_usd',
      'latency_s',
    ]) {
      expect(state.perf_fields.map((p) => p.id)).toContain(id);
    }
    expect(state.harness_paths).toContain('integration/eval/plan/revision-run.mts');
  });

  test('every case names a defect and keeps a requirement that is already correct', () => {
    for (const c of cases) {
      expect(c.expect.defect.length, c.id).toBeGreaterThan(0);
      expect(c.expect.keep.length, c.id).toBeGreaterThan(0);
      const readonly = gradeRevisionArm(c, { planContent: c.priorPlan, stepStatus: 'done' });
      expect(readonly.grade.revision_arm_ok, c.id).toBe(0);
    }
  });
});

describe('gradeRevisionCase negative controls', () => {
  test('a feedback arm that addresses the defect while keeping the test step passes', () => {
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: revised, stepStatus: 'done' },
      controlArm: { planContent: PRIOR, stepStatus: 'done' },
    });
    expect(g.grade.revision_ok).toBe(1);
    expect(g.grade.control_flipped).toBe(1);
  });

  test('an already-correct requirement dropped by the feedback arm fails', () => {
    const dropped = revised.replace('- `apps/web/e2e/export-download.spec.ts` passes', '');
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: dropped, stepStatus: 'done' },
      controlArm: { planContent: PRIOR, stepStatus: 'done' },
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/dropped/i);
  });

  test('a prior plan returned unchanged fails the feedback arm', () => {
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: PRIOR, stepStatus: 'done' },
      controlArm: { planContent: PRIOR, stepStatus: 'done' },
    });
    expect(g.grade.revision_ok).toBe(0);
  });

  test('a control arm that also produces an acceptable revision cannot attribute the fix', () => {
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: revised, stepStatus: 'done' },
      controlArm: { planContent: revised, stepStatus: 'done' },
    });
    expect(g.grade.control_flipped).toBe(0);
    expect(g.explanation.control_flipped).toMatch(/cannot attribute/i);
  });

  test('a missing or failed arm never scores as a pass', () => {
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: null, stepStatus: 'failed' },
      controlArm: { planContent: null, stepStatus: 'missing' },
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.grade.control_flipped).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/harness error|step not done/i);
    expect(g.explanation.control_flipped).toMatch(/harness error/i);
  });

  test('a failed control arm alone is a harness error, not a successful control', () => {
    const g = gradeRevisionCase(baseCase, {
      feedbackArm: { planContent: revised, stepStatus: 'done' },
      controlArm: { planContent: PRIOR, stepStatus: 'failed' },
    });
    expect(g.grade.control_flipped).toBe(0);
    expect(g.explanation.control_flipped).toMatch(/harness error/i);
  });

  test('assistant-only text is not part of the artifact', () => {
    const g = gradeRevisionArm(baseCase, { planContent: '', stepStatus: 'done' });
    expect(g.grade.revision_arm_ok).toBe(0);
  });
});

describe('planFileAt', () => {
  test('reads a file from a git ref and returns null when the ref has no such file', () => {
    const repo = join(import.meta.dirname, '../..');
    const head = readFileSync(join(repo, 'package.json'), 'utf8');
    const atHead = planFileAt(repo, `HEAD:${'package.json'}`);
    expect(atHead ?? head).toBeTruthy();
    expect(planFileAt(repo, 'HEAD:definitely-not-a-file-1966')).toBeNull();
  });
});

describe('the rejection prompt carries the feedback verbatim', () => {
  test('the replan prompt embeds the case feedback', () => {
    for (const c of cases) {
      expect(buildReplanPrompt(c.feedback)).toContain(c.feedback);
    }
  });
});
