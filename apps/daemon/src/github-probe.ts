// GitHub PR 只读探测（#704 / B-C16，Multica link-back 方向：发现与关联只读，
// 不代操作——本模块永不写 GitHub）。daemon 在 github 形态步收尾时回答
// 「这个 conv 分支上有没有 PR」，答案随 done 通道回填 build.prUrl/prNumber。
//
// 凭据阶梯（全部只读，不引入新凭据面）：
// ① 机器 gh CLI（agent 开 PR 用的就是它——同源凭据最可能看到同一个 PR）；
// ② REST api.github.com + per-step token（github_connection 下发时）；
// ③ REST 匿名（公开仓可达；私仓 404 = 未知）。
// 任一失败 = null（面板显示分支名、PR 槽留空），单次尝试、有界超时，不重试。

import { spawn } from 'node:child_process';
import { isGithubRepoRef } from '@cairn/shared';

/** 探测结果：null = 未知/无 PR（两者不区分——「查不到」与「没有」都按
 * 「面板留空」处理，不造数据）。 */
export interface GithubPrProbe {
  number: number;
  url: string;
}

const PROBE_TIMEOUT_MS = 10_000;

/** fetch 结构子集（测试注入；globalThis.fetch 天然满足）。 */
export type ProbeFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** github cloneUrl（`https://github.com/owner/repo.git`）→ owner/repo；
 * 非 github 形状 = null（探测前置闸，调用方直接跳过）。 */
export function githubRepoRefOf(cloneUrl: string): { owner: string; repo: string } | null {
  let path: string;
  try {
    path = new URL(cloneUrl).pathname;
  } catch {
    return null;
  }
  const ref = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  if (!isGithubRepoRef(ref)) return null;
  const slash = ref.indexOf('/');
  return { owner: ref.slice(0, slash), repo: ref.slice(slash + 1) };
}

interface ProbeOpts {
  owner: string;
  repo: string;
  /** conv 分支名（head 匹配键）。 */
  branch: string;
  /** per-step GitHub token（github_connection 下发时非 null；匿名 = null）。 */
  token?: string | null;
  fetchImpl?: ProbeFetch;
  /** gh 可执行路径（测试注入；缺省 PATH 解析）。 */
  ghPath?: string;
}

/** gh CLI 单次探测：`gh pr list --json number,url,state`（--state all 含已
 * 合并/关闭——merge 步收尾时 PR 已合并，仍要能回填 URL）。 */
async function probeViaGh(opts: ProbeOpts, ghPath: string): Promise<GithubPrProbe | null> {
  const r = await new Promise<{ code: number; stdout: string } | null>((resolve) => {
    const child = spawn(
      ghPath,
      [
        'pr',
        'list',
        '--repo',
        `${opts.owner}/${opts.repo}`,
        '--head',
        opts.branch,
        '--state',
        'all',
        '--json',
        'number,url,state',
        '--limit',
        '5',
      ],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
    );
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('error', () => resolve(null)); // 未安装 / PATH 不可达
    child.on('close', (code) => {
      if (code === 0) resolve({ code, stdout: Buffer.concat(out).toString('utf8') });
      else resolve(null);
    });
  });
  if (r === null) return null;
  let rows: { number: number; url: string; state?: string }[];
  try {
    rows = JSON.parse(r.stdout) as { number: number; url: string; state?: string }[];
  } catch {
    return null;
  }
  return pickPr(rows);
}

/** REST 探测：`GET /repos/{o}/{r}/pulls?head={o}:{branch}&state=all`。 */
async function probeViaApi(opts: ProbeOpts, fetchImpl: ProbeFetch): Promise<GithubPrProbe | null> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls?head=${encodeURIComponent(
    `${opts.owner}:${opts.branch}`,
  )}&state=all`;
  let data: unknown;
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'cairn-daemon',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null; // 私仓匿名 404 / 限流 / 网络 = 未知
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const rows = data
    .filter((r): r is { number: number; html_url: string; state?: string } => {
      if (r === null || typeof r !== 'object') return false;
      const { number, html_url } = r as { number?: unknown; html_url?: unknown };
      return typeof number === 'number' && typeof html_url === 'string';
    })
    .map((r) => ({ number: r.number, url: r.html_url, state: r.state }));
  return pickPr(rows);
}

/** 候选取一条：open 优先（多个 open 取 number 最大——最近开的那个）。 */
function pickPr(rows: { number: number; url: string; state?: string }[]): GithubPrProbe | null {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => r.state === 'open');
  const pool = open.length > 0 ? open : rows;
  const best = pool.reduce((a, b) => (b.number > a.number ? b : a));
  return { number: best.number, url: best.url };
}

/** 只读探测主入口：gh → REST（token/匿名）双梯；全败 = null。 */
export async function probeGithubPr(opts: ProbeOpts): Promise<GithubPrProbe | null> {
  const gh = opts.ghPath ?? 'gh';
  const viaGh = await probeViaGh(opts, gh).catch(() => null);
  if (viaGh !== null) return viaGh;
  return probeViaApi(opts, opts.fetchImpl ?? fetch).catch(() => null);
}
