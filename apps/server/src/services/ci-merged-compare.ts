import { type FetchLike, githubCompareStatus, isFullSha } from '../lib/github.js';
import type { AnonReadBudget } from './ci-anon-budget.js';

export const CI_MISSING_COMPARE_RECHECK_MS = 600_000;

interface CompareEntry {
  status: string;
  at: number;
  failures: number;
}

export interface CompareRead {
  status: string;
  failures: number;
}

export class MergedCompareCache {
  private readonly byPr = new Map<string, Map<string, CompareEntry>>();

  constructor(
    private readonly githubFetch: FetchLike,
    private readonly budget: AnonReadBudget,
  ) {}

  async read(
    prKey: string,
    target: { owner: string; repo: string },
    token: string | null,
    checkpoint: string,
    headSha: string,
    now: number,
  ): Promise<CompareRead | 'skipped'> {
    const pairs = this.byPr.get(prKey) ?? new Map<string, CompareEntry>();
    this.byPr.set(prKey, pairs);
    const cmpKey = `${checkpoint}...${headSha}`;
    const cached = pairs.get(cmpKey);
    const stale =
      cached === undefined ||
      ((cached.status === 'missing' || cached.status === 'unreadable') &&
        now - cached.at >= CI_MISSING_COMPARE_RECHECK_MS);
    if (!stale) return { status: cached.status, failures: cached.failures };
    const sendsRequest = isFullSha(checkpoint) && isFullSha(headSha);
    if (token === null && sendsRequest && !this.budget.take(now)) return 'skipped';
    const status =
      (await githubCompareStatus(
        this.githubFetch,
        token,
        target.owner,
        target.repo,
        checkpoint,
        headSha,
      )) ?? 'unreadable';
    const failures = status === 'unreadable' ? (cached?.failures ?? 0) + 1 : 0;
    pairs.set(cmpKey, { status, at: now, failures });
    return { status, failures };
  }

  retain(prKeys: ReadonlySet<string>): void {
    for (const k of this.byPr.keys()) if (!prKeys.has(k)) this.byPr.delete(k);
  }
}

export function mergedCheckpointHint(
  prNumber: number,
  status: string,
  checkpoint: string,
  headSha: string,
): string {
  const head = headSha.slice(0, 7);
  const cp = checkpoint.slice(0, 7);
  if (status === 'unreadable')
    return `PR #${prNumber} 已在 GitHub 合并，但暂时读不到 compare（GitHub 出错、超时或限流），无法确认分支提交 ${cp} 在这次合并里；稍后重试。`;
  if (status === 'missing')
    return `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但 GitHub 上找不到分支提交 ${cp}（可能从没推送过），无法确认它在这次合并里。任务留在审核关口。`;
  if (status === 'invalid')
    return `PR #${prNumber} 已在 GitHub 合并，但机器回报的分支提交不是有效的提交 SHA，无法核对它是否在这次合并里。任务留在审核关口。`;
  return `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但分支提交 ${cp} 不是那个 head 的祖先：合并之后又推了提交，或分支被改写过。这部分改动可能还没进默认分支；任务留在审核关口，由人把这个提交另行合入默认分支。`;
}
