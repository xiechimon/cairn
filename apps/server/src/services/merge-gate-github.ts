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
import {
  type AutonomousToken,
  isAppToken,
  type UserToken,
  unattributed,
} from '../lib/github-token.js';
import type { GateGithubPort } from './merge-gate/github-port.js';

export function githubGatePort(
  fetchImpl: FetchLike,
  token: AutonomousToken,
  owner: string,
  repo: string,
  timeoutMs: number,
  userFallback?: () => Promise<UserToken | null>,
): GateGithubPort {
  return {
    ...githubGateReadPort(fetchImpl, token, owner, repo, timeoutMs),
    createStatus: async (sha, status) => {
      const app = isAppToken(token);
      const result = await githubCreateCommitStatus(fetchImpl, token, owner, repo, sha, status, {
        timeoutMs,
      });
      if (
        !app ||
        result.kind !== 'failed' ||
        result.failure.kind !== 'status' ||
        result.failure.status !== 403 ||
        result.failure.message !== 'Resource not accessible by integration'
      )
        return result;
      const user = await userFallback?.();
      if (user == null) return result;
      return githubCreateCommitStatus(
        fetchImpl,
        unattributed(user, 'app-permission-missing', {
          owner,
          repo,
          callSite: 'githubGatePort.createStatus',
        }),
        owner,
        repo,
        sha,
        status,
        { timeoutMs },
      );
    },
  };
}

export function githubGateReadPort(
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
    createStatus: async () => {
      throw new Error('Read-only GitHub port');
    },
  };
}
