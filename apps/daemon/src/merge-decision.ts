export interface LocalMergeFacts {
  defaultBranch: string;
  currentBranch: string | null;
  worktreeClean: boolean;
  defaultHead: string;
  judgedBase: string;
  patchDigest: string;
  judgedPatchDigest: string;
}

export type LocalMergeDecision =
  | { action: 'fast-forward' }
  | { action: 'update-ref' }
  | { action: 'hold'; reason: 'worktree-dirty' | 'checkout-unknown' }
  | { action: 'recheck'; reason: 'default-head-moved' | 'patch-stale' };

export function decideLocalMerge(facts: LocalMergeFacts): LocalMergeDecision {
  if (facts.patchDigest !== facts.judgedPatchDigest) {
    return { action: 'recheck', reason: 'patch-stale' };
  }
  if (facts.defaultHead !== facts.judgedBase) {
    return { action: 'recheck', reason: 'default-head-moved' };
  }
  if (facts.currentBranch === null) return { action: 'hold', reason: 'checkout-unknown' };
  if (!facts.worktreeClean) return { action: 'hold', reason: 'worktree-dirty' };
  if (facts.currentBranch !== facts.defaultBranch) return { action: 'update-ref' };
  return { action: 'fast-forward' };
}
