// 合并就绪闸的 GitHub 端口（#1404 S4b，计划 docs/verify/1404/s4-plan.md §4.2）。闸的源码不
// import lib/github.ts（ADR 0021 D4 ④，测试 merge-gate-imports 钉着），GitHub 的读写经这个
// 端口注入：生产里由 services/merge-gate-github.ts 把 S4a 的传输函数绑上 fetch、token、仓库
// 与超时后传进来，测试里传假端口。端口只发请求、把应答原样交回；应答说明什么由闸判。
// 本文件只有类型。

/** 端口一次请求的失败（与 lib/github.ts 的 GithubRawFailure 同形）。 */
export type GateRawFailure =
  | { kind: 'invalid'; field: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | {
      kind: 'rate-limited';
      status: number;
      resetAt: number | null;
      retryAfterSeconds: number | null;
    }
  | { kind: 'status'; status: number; message: string | null }
  | { kind: 'not-json' };

/** 端口一次请求的结果（与 lib/github.ts 的 GithubRawResult 同形）。not-modified 只在发了
 * etag 时出现。 */
export type GateRaw =
  | { kind: 'ok'; status: number; etag: string | null; link: string | null; body: unknown }
  | { kind: 'not-modified' }
  | { kind: 'failed'; failure: GateRawFailure };

export type GateStatusState = 'error' | 'failure' | 'pending' | 'success';

/** 绑在一个仓库上的 GitHub 读写。每个方法发一个请求；改变闸看到什么的参数都由闸给。 */
export interface GateGithubPort {
  /** GET pulls/{n}。 */
  pull(prNumber: number, o: { etag: string | null }): Promise<GateRaw>;
  /** GET branches/{branch}：分支头提交与 protection 摘要。 */
  branch(name: string, o: { etag: string | null }): Promise<GateRaw>;
  /** GET rules/branches/{branch} 的一页。 */
  branchRules(
    name: string,
    o: { page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  /** GET compare/{base}...{head} 的一页（两头都是 SHA，不发 etag）。 */
  compare(base: string, head: string, o: { page: number; perPage: number }): Promise<GateRaw>;
  /** GET commits/{sha}/check-runs 的一页。 */
  checkRuns(
    sha: string,
    o: { filter: 'latest'; page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  /** GET commits/{sha}/status 的一页。 */
  combinedStatus(
    sha: string,
    o: { page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  /** GET contents/{path}?ref={sha}。 */
  contents(path: string, ref: string): Promise<GateRaw>;
  /** POST statuses/{sha}。 */
  createStatus(
    sha: string,
    s: { state: GateStatusState; context: string; description: string },
  ): Promise<GateRaw>;
}
