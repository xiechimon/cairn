import { describe, expect, test } from 'vitest';
import { workOutcome, workPurposes } from '../src/detail/work-trace.js';
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

describe('workPurposes from reasoning headings', () => {
  const think = (id: string, text: string): WorkStep => ({ kind: 'think', id, text, seconds: 2 });

  test('bold headings of a reasoning summary speak in order, at most two', () => {
    const steps = [
      think('a', '**Comparing Medusa and Saleor**\n\n**Reading the export services**'),
      think('b', '**Running the export tests**'),
    ];
    expect(workPurposes(steps, false, t)).toEqual([
      'Comparing Medusa and Saleor',
      'Reading the export services',
    ]);
  });

  test('raw prose thinking is not guessed at, and a heading with trailing text is not a heading', () => {
    const steps = [think('a', 'Let me look at the files first.'), think('b', '**Not alone** on a line')];
    expect(workPurposes(steps, false, t)).toEqual([]);
  });

  test('headings and command descriptions share the two-purpose budget, once each', () => {
    const steps = [
      think('a', '**Checking the export**'),
      call({ id: 'b', command: 'pnpm test', description: 'Checking the export' }),
      call({ id: 'c', command: 'pnpm lint', description: 'Check formatting' }),
    ];
    expect(workPurposes(steps, false, t)).toEqual(['Checking the export', 'Check formatting']);
  });

  test('while the group runs only the latest heading of a trailing thought speaks', () => {
    const steps = [
      think('a', '**Old heading**'),
      call({ id: 'b', command: 'ls', description: 'List files' }),
      think('c', '**First**\n\n**Latest**'),
    ];
    expect(workPurposes(steps, true, t)).toEqual(['Latest']);
    expect(workPurposes(steps.slice(0, 2), true, t)).toEqual([]);
  });
});

describe('workOutcome', () => {
  const edit = (id: string, target: string) => call({ id, action: 'edit', label: 'edit', target });

  test('edits plus a finished test run read as one outcome, the last run deciding', () => {
    const steps = [
      edit('a', 'src/a.ts'),
      call({ id: 'd', command: 'pnpm test', error: true }),
      call({ id: 'e', command: 'pnpm exec vitest run orders', error: false }),
    ];
    expect(workOutcome(steps, t)).toEqual(['改完测试通过']);
    expect(workOutcome([...steps, call({ id: 'f', command: 'cargo test', error: true })], t)).toEqual([
      '改完测试未通过',
    ]);
  });

  test('a test run alone, edits alone, and neither', () => {
    expect(workOutcome([call({ id: 'a', command: 'go test ./...', error: true })], t)).toEqual(['测试未通过']);
    expect(workOutcome([call({ id: 'a', command: 'pytest' })], t)).toEqual(['测试通过']);
    expect(
      workOutcome([edit('a', 'src/a.ts'), edit('b', 'src/a.ts'), edit('c', 'src/b.ts')], t),
    ).toEqual(['改了 {n} 个文件']);
    expect(workOutcome([call({ id: 'a', command: 'pnpm build' })], t)).toEqual([]);
  });

  test('a test run still running or never finished is not an outcome', () => {
    const steps = [
      call({ id: 'b', command: 'pnpm test', unfinished: true }),
      call({ id: 'c', command: 'pnpm test', running: true }),
    ];
    expect(workOutcome(steps, t)).toEqual([]);
  });
});
