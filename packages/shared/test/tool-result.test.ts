import { describe, expect, test } from 'vitest';
import { toolResultText, toolResultValue } from '../src/tool-result.js';

describe('stored tool results', () => {
  test.each([
    { id: 'task-1' },
    '{"id":"task-1"}',
    [{ type: 'text', text: '{"id":"task-1"}' }],
    [
      { type: 'image', data: 'ignored' },
      { type: 'text', text: '{"id":"task-1"}' },
    ],
  ])('decodes structured result %j', (result) => {
    expect(toolResultValue(result)).toEqual({ id: 'task-1' });
  });

  test.each([undefined, null, '', 'not JSON', [], [{ type: 'image', data: 'ignored' }]])(
    'does not invent a structured result for %j',
    (result) => {
      expect(toolResultValue(result) == null).toBe(true);
    },
  );

  test('preserves multiple text blocks for tool output', () => {
    expect(
      toolResultText([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]),
    ).toBe('first\nsecond');
    expect(
      toolResultValue([
        { type: 'text', text: '{"id":"one"}' },
        { type: 'text', text: '{"id":"two"}' },
      ]),
    ).toBeNull();
  });
});
