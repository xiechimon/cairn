import { describe, expect, test } from 'vitest';
import { computeUnifiedDiff } from '../src/services/documents.js';

const V1 = [
  '# 方案',
  '',
  'Context: keep this line.',
  '',
  '---',
  '',
  'Changes: keep this line.',
].join('\n');
const V2 = [
  '# 方案',
  '',
  'Context: keep this line.',
  '',
  '++x',
  '',
  'Changes: keep this line.',
].join('\n');

describe('computeUnifiedDiff line counts', () => {
  test('counts a deleted --- separator and an added ++x line', () => {
    const diff = computeUnifiedDiff(V1, V2, 1, 2);
    const file = diff.files[0]!;
    expect(file.path).toBe('plan.md');
    expect(file.hunks[0]!.lines).toContain('----');
    expect(file.hunks[0]!.lines).toContain('+++x');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });
});
