import { describe, expect, it } from 'vitest';
import { applyOrderedListEnter } from '../src/overlay/ordered-list.js';

// Ticket #814: ordered-list (`1. `) auto-continuation on Enter.
// Only the half-width `N. ` marker is recognized; full-width forms
// (`1、`/`1．`) are intentionally out of scope and must fall through
// to the native newline (caller gets null).
describe('applyOrderedListEnter', () => {
  it('continues the list with the next number at end of line', () => {
    expect(applyOrderedListEnter('1. foo', 6)).toEqual({ value: '1. foo\n2. ', caret: 10 });
  });

  it('carries 9 to 10', () => {
    expect(applyOrderedListEnter('9. foo', 6)).toEqual({ value: '9. foo\n10. ', caret: 11 });
  });

  it('splits at a mid-line caret and moves the tail onto the new item', () => {
    expect(applyOrderedListEnter('1. foobar', 5)).toEqual({
      value: '1. fo\n2. obar',
      caret: 9,
    });
  });

  it('removes the marker on an empty item (exit list)', () => {
    expect(applyOrderedListEnter('1. ', 3)).toEqual({ value: '', caret: 0 });
  });

  it('keeps the indent when exiting a nested empty item', () => {
    expect(applyOrderedListEnter('  2. ', 5)).toEqual({ value: '  ', caret: 2 });
  });

  it('keeps the indent on continuation', () => {
    expect(applyOrderedListEnter('  1. foo', 8)).toEqual({
      value: '  1. foo\n  2. ',
      caret: 14,
    });
  });

  it('renumbers same-indent following siblings from the inserted number', () => {
    expect(applyOrderedListEnter('1. a\n2. b\n9. c', 9)).toEqual({
      value: '1. a\n2. b\n3. \n4. c',
      caret: 13,
    });
  });

  it('leaves deeper-indented sub-lists alone during renumber', () => {
    expect(applyOrderedListEnter('1. a\n2. b\n  1. sub', 9)).toEqual({
      value: '1. a\n2. b\n3. \n  1. sub',
      caret: 13,
    });
  });

  it('stops renumbering at a blank line', () => {
    expect(applyOrderedListEnter('1. a\n2. b\n\n3. c', 9)).toEqual({
      value: '1. a\n2. b\n3. \n\n3. c',
      caret: 13,
    });
  });

  it('returns null on a plain line', () => {
    expect(applyOrderedListEnter('hello', 5)).toBeNull();
  });

  it('returns null without a trailing space after the dot', () => {
    expect(applyOrderedListEnter('1.foo', 5)).toBeNull();
  });

  it('returns null for full-width markers', () => {
    expect(applyOrderedListEnter('1、foo', 5)).toBeNull();
    expect(applyOrderedListEnter('1． foo', 6)).toBeNull();
  });

  it('returns null for a mid-line marker', () => {
    expect(applyOrderedListEnter('foo 1. bar', 10)).toBeNull();
  });

  it('returns null when the caret sits inside the marker span', () => {
    expect(applyOrderedListEnter('1. foo', 1)).toBeNull();
  });
});
