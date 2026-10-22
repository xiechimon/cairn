// 合并就绪闸 GitHub 端口的生产绑定（#1404 S4b）：把 lib/github.ts 的 S4a 传输函数绑上 fetch、
// 团队 token、仓库与超时，交给闸的外壳（merge-gate/github-facts.ts、gate-status.ts）。放在
// merge-gate/ 之外：闸的源码不 import lib/github.ts（ADR 0021 D4 ④，测试 merge-gate-imports）；
// 这里只做参数转交，不判任何应答。调用方（求值器 S6a、状态写入 S7）给 token 与超时。

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
