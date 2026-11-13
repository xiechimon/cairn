import { join } from 'node:path';
import {
  appendPlanLocationNote,
  appendReportLocationNote,
  type ClaimedStep,
  PLAN_FILE_NAME,
  REPORT_FILE_NAME,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  buildTaskPrompt,
  degradedFreshPrompt,
  freshSessionPrompt,
  planStepPrompt,
} from '../src/step-prompt.js';

const paths = { plansDir: '/state/plans', reportsDir: '/state/reports' };
const repo = { cloneUrl: 'https://github.com/octo/alpha.git', baseBranch: 'main' };

function claimed(opts: {
  kind: ClaimedStep['step']['kind'];
  instruction?: string;
  output?: 'info';
  withRepo?: boolean;
}): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: opts.kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    ...(opts.instruction !== undefined ? { instruction: opts.instruction } : {}),
    todo: {
      id: 't1',
      seqNum: 7,
      title: 'Round the login button',
      spec: 'Use 8px corners.',
      sourceKind: null,
      sourceRef: null,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
    },
    remoteTools: [],
    project: { id: 'p1', name: 'demo', repo: opts.withRepo === true ? repo : null },
  } as unknown as ClaimedStep;
}

describe('planStepPrompt', () => {
  test('a chief step sends its instruction unchanged and keeps a writable workspace', () => {
    const plan = planStepPrompt(claimed({ kind: 'chief', instruction: 'hello' }), undefined, paths);
    expect(plan.prompt).toBe('hello');
    expect(plan.isChief).toBe(true);
    expect(plan.readonlyWorkspace).toBe(false);
  });

  test('a plan step points at the plan file', () => {
    const step = claimed({ kind: 'plan' });
    const plan = planStepPrompt(step, undefined, paths);
    expect(plan.prompt).toBe(
      appendPlanLocationNote(buildTaskPrompt(step), join(paths.plansDir, 'conv-1', PLAN_FILE_NAME)),
    );
  });

  test('an info build points at the report file, skips the branch note and is read-only', () => {
    const step = claimed({ kind: 'build', output: 'info', withRepo: true });
    const plan = planStepPrompt(step, undefined, paths);
    const reportFile = join(paths.reportsDir, 'conv-1', REPORT_FILE_NAME);
    expect(plan.reportFile).toBe(reportFile);
    expect(plan.isInfoBuild).toBe(true);
    expect(plan.readonlyWorkspace).toBe(true);
    expect(plan.prompt).toBe(appendReportLocationNote(buildTaskPrompt(step), reportFile));
  });

  test('a repo-bound build gets the work branch note; one without a repo does not', () => {
    const bound = planStepPrompt(claimed({ kind: 'build', withRepo: true }), undefined, paths);
    const unbound = planStepPrompt(claimed({ kind: 'build' }), undefined, paths);
    expect(bound.prompt.length).toBeGreaterThan(unbound.prompt.length);
    expect(bound.prompt.startsWith(unbound.prompt)).toBe(true);
  });

  test('a resume prompt replaces the composed task prompt', () => {
    const plan = planStepPrompt(claimed({ kind: 'review' }), 'resume here', paths);
    expect(plan.prompt).toBe('resume here');
    expect(plan.reviewGate).toBe('confirm');
  });
});

describe('freshSessionPrompt', () => {
  const reportFile = '/state/reports/conv-1/report.md';
  const input = { reportFile, plansDir: paths.plansDir, convId: 'conv-1' };

  test('an info build resends the task with the report location', () => {
    const step = claimed({ kind: 'build', output: 'info', withRepo: true });
    expect(freshSessionPrompt(step, { ...input, isInfoBuild: true })).toBe(
      appendReportLocationNote(buildTaskPrompt(step), reportFile),
    );
  });

  test('any other step resends the degraded fresh prompt', () => {
    const step = claimed({ kind: 'plan' });
    expect(freshSessionPrompt(step, { ...input, isInfoBuild: false })).toBe(
      degradedFreshPrompt(step, paths.plansDir, 'conv-1'),
    );
  });
});
