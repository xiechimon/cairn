import { describe, expect, test } from 'vitest';
import { workResult } from '../src/detail/work-trace.js';
import type { WorkStep } from '../src/fixtures/records.js';
import type { TFunc } from '../src/i18n/translate.js';

const t: TFunc = (key, vars) =>
  vars === undefined ? key : `${key} ${Object.values(vars).join(' ')}`;

function read(target: string): WorkStep {
  return {
    kind: 'call',
    id: target.slice(0, 20),
    action: 'read',
    label: 'read',
    target,
    output: null,
    error: false,
    running: false,
    unfinished: false,
    seconds: 1,
  };
}

describe('the file a step read is named without its line range', () => {
  test.each([
    ['src/a.ts L1–40', 'a.ts'],
    ['src/a.ts L12+', 'a.ts'],
    ['notes L2 draft.md L1–3', 'notes'],
    ['two\nlines.md L4+', 'lines.md'],
    ['odd L1\nname.md', 'name.md'],
  ])('%j', (target, name) => {
    const result = workResult([read(target)], t);
    expect(result).toContain(name);
    expect(result).not.toMatch(/ L\d+[+–]/);
  });

  test('a long hostile target is handled in linear time', () => {
    const started = performance.now();
    workResult([read(`${' L1'.repeat(60_000)}\nend.md`)], t);
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 120_000);
});
