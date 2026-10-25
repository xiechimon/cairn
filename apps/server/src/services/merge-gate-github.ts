import {
  type FetchLike,
  githubBranchRaw,
  githubBranchRulesRaw,
  githubCheckRunsRaw,
  githubCombinedStatusRaw,
  githubCompareRaw,
  githubContentsRaw,
  githubCreateCommitStatus,
  githubPullRaw,
} from '../lib/github.js';
import type { GateGithubPort } from './merge-gate/github-port.js';

export function githubGatePort(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  timeoutMs: number,
): GateGithubPort {
  return {
    pull: (n, o) => githubPullRaw(fetchImpl, token, owner, repo, n, { ...o, timeoutMs }),
    branch: (name, o) => githubBranchRaw(fetchImpl, token, owner, repo, name, { ...o, timeoutMs }),
    branchRules: (name, o) =>
      githubBranchRulesRaw(fetchImpl, token, owner, repo, name, { ...o, timeoutMs }),
    compare: (base, head, o) =>
      githubCompareRaw(fetchImpl, token, owner, repo, base, head, { ...o, timeoutMs }),
    checkRuns: (sha, o) =>
      githubCheckRunsRaw(fetchImpl, token, owner, repo, sha, { ...o, timeoutMs }),
    combinedStatus: (sha, o) =>
      githubCombinedStatusRaw(fetchImpl, token, owner, repo, sha, { ...o, timeoutMs }),
    contents: (path, ref) =>
      githubContentsRaw(fetchImpl, token, owner, repo, path, ref, { timeoutMs }),
    createStatus: (sha, s) =>
      githubCreateCommitStatus(fetchImpl, token, owner, repo, sha, s, { timeoutMs }),
  };
}
