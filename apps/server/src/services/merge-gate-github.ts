import {
  type FetchLike,
  githubBranchRaw,
  githubBranchRulesRaw,
  githubCheckRunsRaw,
  githubCombinedStatusRaw,
} from '../lib/github.js';
import type { GateGithubPort } from './merge-gate/github-port.js';

export function githubGateReadPort(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  timeoutMs: number,
): GateGithubPort {
  return {
    branch: (name, o) => githubBranchRaw(fetchImpl, token, owner, repo, name, { ...o, timeoutMs }),
    branchRules: (name, o) =>
      githubBranchRulesRaw(fetchImpl, token, owner, repo, name, { ...o, timeoutMs }),
    checkRuns: (sha, o) =>
      githubCheckRunsRaw(fetchImpl, token, owner, repo, sha, { ...o, timeoutMs }),
    combinedStatus: (sha, o) =>
      githubCombinedStatusRaw(fetchImpl, token, owner, repo, sha, { ...o, timeoutMs }),
  };
}
