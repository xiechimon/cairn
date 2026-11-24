import { describe, expect, it } from 'vitest';
import { thinkingPreview } from '../src/components/chat/agent-rows.js';

describe('thinkingPreview', () => {
  it('replaces generic English thinking filler lines with the localized fallback', () => {
    expect(
      thinkingPreview(
        'I\'m thinking through how to approach this.\n\n\nThe direct instruction is to respond with "ANTIGRAVITY_OK" only.',
        '思考',
      ),
    ).toBe('思考');
    expect(thinkingPreview('I am thinking about this carefully.\nNext step...', '思考')).toBe(
      '思考',
    );
    expect(thinkingPreview('Let me think through how to answer.\nDetails', '思考')).toBe('思考');
    expect(thinkingPreview('Thinking...\nMore details', '思考')).toBe('思考');
    expect(thinkingPreview('   ', '思考')).toBe('思考');
  });

  it('keeps substantive Chinese and English thinking lines intact', () => {
    expect(thinkingPreview('先把凭证面捋一遍\n再看日志', '思考')).toBe('先把凭证面捋一遍');
    expect(thinkingPreview('Check the final output.', '思考')).toBe('Check the final output.');
    expect(
      thinkingPreview(
        '> The user just said "你好" — pure greeting. No task.',
        '思考',
      ),
    ).toBe('> The user just said "你好" — pure greeting. No task.');
  });
});
