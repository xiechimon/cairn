import { describe, expect, it } from 'vitest';
import { formatModelDisplayName } from '../src/records/model-display.js';

describe('formatModelDisplayName for Devin SWE variants', () => {
  it.each([
    ['swe-2-high', 'SWE-2'],
    ['swe-2-flash-medium', 'SWE-2 Flash'],
    ['swe-2-1-xhigh', 'SWE-2.1'],
    ['swe-2-none', 'SWE-2'],
    ['devin/swe-2-minimal', 'SWE-2'],
  ])('reads %s as the family without its effort: %s', (id, label) => {
    expect(formatModelDisplayName(id)).toBe(label);
  });
});
