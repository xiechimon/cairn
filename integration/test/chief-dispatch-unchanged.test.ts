import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const CASES_PATH = join(import.meta.dirname, '../../.claude/hillclimb/chief-dispatch/cases.json');
const EXPECTED_SHA256 = 'ec4819f5337692225017db2a93d2d8e0bcb38714dc3533823ce717c485d475a8';
const EXPECTED_COUNT = 64;

describe('chief-dispatch regression gate unchanged', () => {
  test('integration/eval/chief-dispatch/cases.json still has 64 cases and an unchanged hash', () => {
    const body = readFileSync(CASES_PATH);
    const parsed = JSON.parse(body.toString('utf8')) as { cases?: unknown[] };
    expect(Array.isArray(parsed.cases)).toBe(true);
    expect(parsed.cases?.length).toBe(EXPECTED_COUNT);
    const hash = createHash('sha256').update(body).digest('hex');
    expect(hash).toBe(EXPECTED_SHA256);
  });
});
