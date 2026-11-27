import { describe, expect, test } from 'vitest';
import { checkUiGuidelines } from '../../../scripts/ui-guidelines-gate.mjs';

describe('static UI guideline gate', () => {
  test('every automated foundation and desktop rule passes with zero violations', () => {
    const result = checkUiGuidelines();
    const formatted = result.violations.map((v) => `${v.rule} ${v.file}:${v.line}: ${v.message}`);
    expect(formatted).toEqual([]);
  }, 30_000);
});
