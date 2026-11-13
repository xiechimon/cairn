import { describe, expect, it } from 'vitest';
import type { GithubBranchPull } from '../src/lib/github.js';
import { pickOwnBranchPull } from '../src/services/ci-pr-rounds.js';

const recorded = { number: 10, baseRepoId: 1, defaultBranch: 'main' };

function pull(over: Partial<GithubBranchPull>): GithubBranchPull {
  return {
    number: 10,
    state: 'open',
    merged: false,
    headRef: 'cairn/b1',
    headRepoId: 1,
    baseRef: 'main',
    baseRepoId: 1,
    authorAssociation: 'OWNER',
    ...over,
  };
}

describe('pickOwnBranchPull', () => {
  it('keeps the recorded pull while it is open or merged', () => {
    const own = pull({});
    expect(pickOwnBranchPull([pull({ number: 12 }), own], 'cairn/b1', recorded, 0)).toBe(own);
  });

  it('ignores pulls from forks, other branches and other bases', () => {
    const list = [
      pull({ number: 11, headRepoId: 2 }),
      pull({ number: 12, headRef: 'other' }),
      pull({ number: 13, baseRef: 'dev' }),
    ];
    expect(pickOwnBranchPull(list, 'cairn/b1', recorded, 0)).toBeNull();
  });

  it('adopts the newest open pull by a writer', () => {
    const list = [
      pull({ number: 10, state: 'closed' }),
      pull({ number: 11 }),
      pull({ number: 14 }),
      pull({ number: 15, authorAssociation: 'NONE' }),
    ];
    expect(pickOwnBranchPull(list, 'cairn/b1', recorded, 0)?.number).toBe(14);
  });

  it('adopts a merged pull only when it is newer than every rejected one', () => {
    const merged = pull({ number: 12, state: 'closed', merged: true });
    const rejected = pull({ number: 13, state: 'closed' });
    expect(pickOwnBranchPull([merged, rejected], 'cairn/b1', recorded, 0)).toBeNull();
    expect(pickOwnBranchPull([merged], 'cairn/b1', recorded, 12)).toBeNull();
    expect(pickOwnBranchPull([merged], 'cairn/b1', recorded, 11)).toBe(merged);
  });
});
