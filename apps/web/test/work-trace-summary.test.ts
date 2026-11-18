import { describe, expect, test } from 'vitest';
import { formatLiveElapsed } from '../src/components/chat/live-row.js';
import { workPurposes, workResult } from '../src/detail/work-trace.js';
import type { WorkStep } from '../src/fixtures/records.js';
import { EN } from '../src/i18n/en.js';
import { type TFunc, translate } from '../src/i18n/translate.js';

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

  test('plain-text live thinking falls back to its trailing line only while running', () => {
    const steps = [think('a', 'First check config\n\nInspecting attachment headers')];
    expect(workPurposes(steps, true, t)).toEqual(['Inspecting attachment headers']);
    expect(workPurposes(steps, false, t)).toEqual([]);
  });
});

describe('formatLiveElapsed', () => {
  test('shows cumulative seconds starting at 5s and formats minutes above 60s', () => {
    expect(formatLiveElapsed(null)).toBe('');
    expect(formatLiveElapsed(0)).toBe('');
    expect(formatLiveElapsed(4)).toBe('');
    expect(formatLiveElapsed(5)).toBe('5s');
    expect(formatLiveElapsed(59)).toBe('59s');
    expect(formatLiveElapsed(65)).toBe('1m 5s');
  });
});

describe('workResult', () => {
  const edit = (id: string, target: string) => call({ id, action: 'edit', label: 'edit', target });
  const read = (id: string, target: string) => call({ id, action: 'read', label: 'read', target });
  const named: TFunc = (key, vars) =>
    Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);

  test('edited files name the result, with the last finished test run, and outrank what was read', () => {
    const steps = [
      read('a', 'src/notes.md L1-20'),
      edit('b', 'src/orders/export.ts'),
      edit('c', 'src/orders/export.ts'),
      call({ id: 'd', command: 'pnpm test', error: true }),
      call({ id: 'e', command: 'pnpm test' }),
    ];
    expect(workResult(steps, named)).toBe('改了 export.ts，测试通过');
  });

  test('more than two files name the first two and count the rest', () => {
    const steps = [edit('a', 'a/one.ts'), edit('b', 'b/two.ts'), edit('c', 'c/three.ts'), edit('d', 'd/four.ts')];
    expect(workResult(steps, named)).toBe('改了 one.ts、two.ts 等 4 个文件');
  });

  test('English reads as one sentence', () => {
    const en: TFunc = (key, vars) => translate('en', EN, key, vars);
    const steps = [edit('a', 'src/rate-limit.ts'), edit('b', 'src/login.ts'), call({ id: 'c', command: 'pnpm test auth' })];
    expect(workResult(steps, en)).toBe('Edited rate-limit.ts and login.ts, tests pass');
    expect(workResult([...steps, edit('d', 'a.ts'), call({ id: 'e', command: 'pnpm test', error: true })], en)).toBe(
      'Edited rate-limit.ts, login.ts and 1 more, tests fail',
    );
  });

  test('a test run alone gives its verdict; reads alone name the files without line ranges', () => {
    expect(workResult([read('a', 'README.md'), call({ id: 'b', command: 'go test ./...', error: true })], named)).toBe(
      '测试未通过',
    );
    expect(workResult([read('a', 'src/main.ts L10–29'), read('b', 'src/main.ts L40–52')], named)).toBe(
      '读了 main.ts',
    );
  });

  test('a failed edit changed nothing, and a test run before the last edit did not test it', () => {
    const failed = call({ id: 'x', action: 'edit', label: 'edit', target: 'src/other.ts', error: true });
    expect(workResult([failed, edit('a', 'src/a.ts'), call({ id: 'b', command: 'pnpm test' })], named)).toBe(
      '改了 a.ts，测试通过',
    );
    expect(workResult([call({ id: 'b', command: 'pnpm test' }), edit('a', 'src/a.ts')], named)).toBe('改了 a.ts');
    expect(workResult([failed], named)).toBeNull();
  });

  test('a test run still running or never finished gives no verdict', () => {
    const steps = [
      edit('a', 'src/a.ts'),
      call({ id: 'b', command: 'pnpm test', unfinished: true }),
      call({ id: 'c', command: 'pnpm test', running: true }),
    ];
    expect(workResult(steps, named)).toBe('改了 a.ts');
  });

  test('a group with nothing to name keeps the counts', () => {
    const steps: WorkStep[] = [
      { kind: 'think', id: 't', text: 'plan', seconds: 2 },
      call({ id: 'a', command: 'pnpm build' }),
      call({ id: 'b', action: 'search', description: 'grep ready src' }),
      call({ id: 'c', action: 'edit', label: 'edit', target: 'src/a.ts', running: true }),
    ];
    expect(workResult(steps, named)).toBeNull();
  });
});
