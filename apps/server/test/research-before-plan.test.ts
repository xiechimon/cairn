import { describe, expect, test } from 'vitest';
import { researchBeforePlanReason } from '../src/services/research-before-plan.js';

describe('researchBeforePlanReason', () => {
  test('flags performance and mechanism work and leaves ordinary work alone', () => {
    expect(researchBeforePlanReason('make the export faster', 'The board export is slow.')).toBe(
      'performance',
    );
    expect(researchBeforePlanReason('Add a dependency', 'Choose a parser library.')).toBe(
      'mechanism',
    );
    expect(researchBeforePlanReason('technology choice for the queue', null)).toBe('mechanism');
    expect(researchBeforePlanReason('Export the board', 'Add an export.')).toBeNull();
  });
});
