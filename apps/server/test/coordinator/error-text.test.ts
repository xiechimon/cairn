import { describe, expect, it } from 'vitest';
import { thrownErrorText } from '../../src/coordinator/runtime/error-text.js';

describe('thrownErrorText', () => {
  it('keeps the message of an ordinary Error', () => {
    expect(thrownErrorText(new Error('boom'))).toBe('boom');
  });

  it('falls back to the name when an Error has a blank message', () => {
    expect(thrownErrorText(new Error(''))).toBe('Error');
    expect(thrownErrorText(new TypeError('   '))).toBe('TypeError');
  });

  it('describes thrown non-Error values', () => {
    expect(thrownErrorText('cut off')).toBe('cut off');
    expect(thrownErrorText(null)).toBe('null');
    expect(thrownErrorText(0)).toBe('0');
    expect(thrownErrorText(Object.create(null))).toBe('[object Object]');
  });

  it('never returns a blank text', () => {
    for (const value of ['', '   ', {}, { toString: () => '' }]) {
      expect(thrownErrorText(value).trim()).not.toBe('');
    }
  });
});
