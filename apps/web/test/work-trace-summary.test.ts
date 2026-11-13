import { describe, expect, test } from 'vitest';
import { workPurposes } from '../src/detail/work-trace.js';
import type { WorkStep } from '../src/fixtures/records.js';
import type { TFunc } from '../src/i18n/translate.js';

const t: TFunc = (key: string) => (key === '核对 README' ? 'Check the README' : key);

function call(over: Partial<Extract<WorkStep, { kind: 'call' }>>): WorkStep {
  return {
    kind: 'call',
    id: over.id ?? 'step',
    action: 'run',
    label: 'bash',
    output: null,
    error: false,
    running: false,
    unfinished: false,
    seconds: 1,
    ...over,
  };
}

describe('workPurposes', () => {
  test('a command the agent described lends its words, once, in the order run', () => {
    const steps = [
      call({ id: 'a', command: 'pnpm install', description: 'Install dependencies' }),
      call({ id: 'b', command: 'pnpm test', description: 'Run the unit tests' }),
      call({ id: 'c', command: 'pnpm test', description: 'Run the unit tests' }),
    ];
    expect(workPurposes(steps, false, t)).toEqual(['Install dependencies', 'Run the unit tests']);
  });

  test('a description that only repeats the command, a search label or a file target is not a purpose', () => {
    const steps: WorkStep[] = [
      { kind: 'think', id: 't', text: 'plan', seconds: 2 },
      call({ id: 'a', command: 'git status\ngit diff', description: 'git status' }),
      call({ id: 'b', action: 'search', description: 'grep ready src' }),
      call({ id: 'c', action: 'edit', target: 'README.md' }),
      call({ id: 'd', command: 'ls', description: '  ' }),
    ];
    expect(workPurposes(steps, false, t)).toEqual([]);
  });

  test('while the group runs only the running command speaks', () => {
    const steps = [
      call({ id: 'a', command: 'pnpm install', description: 'Install dependencies' }),
      call({ id: 'b', command: 'pnpm lint', description: 'Check formatting', running: true }),
    ];
    expect(workPurposes(steps, true, t)).toEqual(['Check formatting']);
    expect(workPurposes([steps[0] as WorkStep], true, t)).toEqual([]);
  });

  test('a localized description is translated', () => {
    const steps = [call({ command: 'cat README.md', description: '核对 README', localized: true })];
    expect(workPurposes(steps, false, t)).toEqual(['Check the README']);
  });
});
