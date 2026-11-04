import { describe, expect, test } from 'vitest';
import { decideLocalMerge, type LocalMergeFacts } from '../src/merge-decision.js';

const base = (overrides: Partial<LocalMergeFacts> = {}): LocalMergeFacts => ({
  defaultBranch: 'main',
  currentBranch: 'main',
  worktreeClean: true,
  defaultHead: 'base',
  judgedBase: 'base',
  patchDigest: 'pd2:current',
  judgedPatchDigest: 'pd2:current',
  ...overrides,
});

describe('local merge decision', () => {
  test('clean default checkout with matching base and patch is fast-forwardable', () => {
    expect(decideLocalMerge(base())).toEqual({ action: 'fast-forward' });
  });

  test('checkout on another branch updates only the default ref', () => {
    expect(decideLocalMerge(base({ currentBranch: 'feature' }))).toEqual({
      action: 'update-ref',
    });
  });

  test('dirty default checkout is held without touching the workspace', () => {
    expect(decideLocalMerge(base({ worktreeClean: false }))).toEqual({
      action: 'hold',
      reason: 'worktree-dirty',
    });
  });

  test('a dirty tree on another branch holds with worktree-dirty', () => {
    expect(decideLocalMerge(base({ currentBranch: 'feature', worktreeClean: false }))).toEqual({
      action: 'hold',
      reason: 'worktree-dirty',
    });
  });

  test('unknown checkout is held without touching the workspace', () => {
    expect(decideLocalMerge(base({ currentBranch: null }))).toEqual({
      action: 'hold',
      reason: 'checkout-unknown',
    });
  });

  test('changed default head is rechecked before landing', () => {
    expect(decideLocalMerge(base({ defaultHead: 'new' }))).toEqual({
      action: 'recheck',
      reason: 'default-head-moved',
    });
  });

  test('changed patch digest is stale', () => {
    expect(decideLocalMerge(base({ patchDigest: 'pd2:new' }))).toEqual({
      action: 'recheck',
      reason: 'patch-stale',
    });
  });
});
