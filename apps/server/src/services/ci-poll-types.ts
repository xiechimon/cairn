import type { FetchLike, GithubPull } from '../lib/github.js';

export interface CiPollTally {
  candidates: number;
  pending: number;
  appended: number;
  advanced: number;
  failed: number;
  skipped: number;
  unreadable: number;
  errors: number;
  reviewCandidates: number;
  reviewPending: number;
  reviewSkipped: number;
  reviewUnreadable: number;
  reviewForeign: number;
  merged: number;
  closedUnmerged: number;
  hinted: number;
  settledBefore: number;
  adopted: number;
}

export interface PullCacheEntry {
  etag: string | null;
  pull: GithubPull | null;
}

export interface CiPollCandidate {
  buildId: string;
  todoId: string;
}

export interface CiPollRun {
  githubFetch: FetchLike;
  threadPrWakes?: boolean;
}
