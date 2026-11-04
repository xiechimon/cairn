import { describe, expect, it } from 'vitest';
import { substantiveChangesOf } from '../src/detail/empty-commit.js';

describe('substantiveChangesOf', () => {
  it('query unfinished or failed = unknown, an empty set is not read as zero changes', () => {
    expect(substantiveChangesOf({ files: [], reported: true }, false)).toBeNull();
    expect(substantiveChangesOf(undefined, true)).toBeNull();
    expect(substantiveChangesOf(null, true)).toBeNull();
  });

  it('response without reported (old server / unreported folded into files:[]) = unknown', () => {
    expect(substantiveChangesOf({ files: [] }, true)).toBeNull();
    expect(substantiveChangesOf({ files: [], reported: false }, true)).toBeNull();
  });

  it('reported with an empty file set and no changed = no substantive changes (empty commit)', () => {
    expect(substantiveChangesOf({ files: [], reported: true }, true)).toBe(false);
  });

  it('changed false = git diff has no file headers, empty commit', () => {
    expect(substantiveChangesOf({ files: [], reported: true, changed: false }, true)).toBe(false);
  });

  it('changed true = git has file headers, changes the parser lost must still merge', () => {
    expect(substantiveChangesOf({ files: [], reported: true, changed: true }, true)).toBe(true);
  });

  it('reported with files = has substantive changes', () => {
    expect(substantiveChangesOf({ files: [{ path: 'README.md' }], reported: true }, true)).toBe(
      true,
    );
  });
});
