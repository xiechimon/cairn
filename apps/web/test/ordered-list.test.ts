import { describe, expect, it } from 'vitest';
import {
  applyOrderedListBackspace,
  applyOrderedListEnter,
  findListMarkers,
} from '../src/overlay/ordered-list.js';

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

  it('continues a bullet list item and exits on an empty bullet item', () => {
    expect(applyOrderedListEnter('- foo', 5)).toEqual({ value: '- foo\n- ', caret: 8 });
    expect(applyOrderedListEnter('  - foo', 7)).toEqual({ value: '  - foo\n  - ', caret: 12 });
    expect(applyOrderedListEnter('- ', 2)).toEqual({ value: '', caret: 0 });
    expect(applyOrderedListEnter('  - ', 4)).toEqual({ value: '  ', caret: 2 });
  });

  it('returns null on a plain line', () => {
    expect(applyOrderedListEnter('hello', 5)).toBeNull();
  });

  it('returns null without a trailing space after the dot or dash', () => {
    expect(applyOrderedListEnter('1.foo', 5)).toBeNull();
    expect(applyOrderedListEnter('-foo', 4)).toBeNull();
  });

  it('returns null for full-width markers', () => {
    expect(applyOrderedListEnter('1、foo', 5)).toBeNull();
    expect(applyOrderedListEnter('1． foo', 6)).toBeNull();
  });

  it('returns null for a mid-line marker', () => {
    expect(applyOrderedListEnter('foo 1. bar', 10)).toBeNull();
    expect(applyOrderedListEnter('foo - bar', 9)).toBeNull();
  });

  it('returns null when the caret sits inside the marker span', () => {
    expect(applyOrderedListEnter('1. foo', 1)).toBeNull();
    expect(applyOrderedListEnter('- foo', 1)).toBeNull();
  });
});

describe('applyOrderedListBackspace', () => {
  it('removes an auto-continued marker left by Enter', () => {
    expect(applyOrderedListBackspace('1. foo\n2. ', 10)).toEqual({
      value: '1. foo\n',
      caret: 7,
    });
  });

  it('removes the marker before content', () => {
    expect(applyOrderedListBackspace('2. foo', 3)).toEqual({ value: 'foo', caret: 0 });
  });

  it('keeps the indent when removing a nested marker', () => {
    expect(applyOrderedListBackspace('  2. foo', 5)).toEqual({ value: '  foo', caret: 2 });
  });

  it('removes a multi-digit marker', () => {
    expect(applyOrderedListBackspace('12. foo', 4)).toEqual({ value: 'foo', caret: 0 });
  });

  it('removes the marker on a middle line', () => {
    expect(applyOrderedListBackspace('intro\n2. bar\ntail', 9)).toEqual({
      value: 'intro\nbar\ntail',
      caret: 6,
    });
  });

  it('removes the whole marker run of extra spaces', () => {
    expect(applyOrderedListBackspace('2.   foo', 5)).toEqual({ value: 'foo', caret: 0 });
  });

  it('removes a bullet marker cleanly on the unified path', () => {
    expect(applyOrderedListBackspace('- foo', 2)).toEqual({ value: 'foo', caret: 0 });
    expect(applyOrderedListBackspace('1. a\n- ', 7)).toEqual({ value: '1. a\n', caret: 5 });
    expect(applyOrderedListBackspace('  - bar', 4)).toEqual({ value: '  bar', caret: 2 });
  });

  it('returns null inside the content', () => {
    expect(applyOrderedListBackspace('2. foo', 5)).toBeNull();
  });

  it('returns null inside the marker span', () => {
    expect(applyOrderedListBackspace('2. foo', 2)).toBeNull();
  });

  it('returns null on a plain line', () => {
    expect(applyOrderedListBackspace('foo', 3)).toBeNull();
  });
});

describe('findListMarkers', () => {
  it('matches ordered and bullet prefixes only after a trailing space', () => {
    expect(findListMarkers('1.')).toEqual([]);
    expect(findListMarkers('1.foo')).toEqual([]);
    expect(findListMarkers('-')).toEqual([]);
    expect(findListMarkers('-foo')).toEqual([]);
    expect(findListMarkers('1. ')).toEqual([
      { kind: 'ordered', lineStart: 0, start: 0, end: 2, text: '1.' },
    ]);
    expect(findListMarkers('- ')).toEqual([
      { kind: 'bullet', lineStart: 0, start: 0, end: 1, text: '-' },
    ]);
  });

  it('matches multi-digit, indented, and multi-line ordered/bullet items', () => {
    const text = '1. one\n2. two\n10. ten\n  - sub';
    expect(findListMarkers(text)).toEqual([
      { kind: 'ordered', lineStart: 0, start: 0, end: 2, text: '1.' },
      { kind: 'ordered', lineStart: 7, start: 7, end: 9, text: '2.' },
      { kind: 'ordered', lineStart: 14, start: 14, end: 17, text: '10.' },
      { kind: 'bullet', lineStart: 22, start: 24, end: 25, text: '-' },
    ]);
  });

  it('does not match mid-line numbers or full-width punctuation', () => {
    expect(findListMarkers('hello 1. world')).toEqual([]);
    expect(findListMarkers('1、你好')).toEqual([]);
    expect(findListMarkers('1． 你好')).toEqual([]);
  });

  it('suppresses specified lines while IME composition is active', () => {
    expect(findListMarkers('1. ready\n2. composing', new Set([9]))).toEqual([
      { kind: 'ordered', lineStart: 0, start: 0, end: 2, text: '1.' },
    ]);
  });
});
