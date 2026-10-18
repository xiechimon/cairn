// 来源行（#452 / ADR 0006 D5/D6 + #640 / r14 §5.4 编排档）：任务详情页的
// 来源面，live 专属（fixture 面无来源数据源，不渲染）。四态：
// - 编排来源（sourceKind='orchestration'，#640）：一行「来源 · 总管编排
//   会话」，点击开总管抽屉定位该会话（sourceRef = chief:<uuid> 反解单源
//   parseOrchestrationSourceRef）——比参考站多给的一面（它详情页零来源，
//   r14 §5.4：pacman 的 sourceRef 有会话粒度，链回编排回合）；
// - 未建成（sourceKind='github-issue-self' 且 sourceRef=null）：一行状态 +
//   重试按钮（AC3 重试入口；POST retry 成功后查询失效重取，行自动升级）；
// - 已建成/导入：进入时拉一次回显（useGithubIssueEcho，staleTime ∞ 不轮询）
//   → issue 当前标题 + 状态；与本地标题不一致 → 一行中性提示，**不自动覆盖
//   本地值**（D5：issue 侧为真值，pacman 侧只显示差异）；
// - 拉不到（未连接/token 失效/限流/issue 被删）→ 整行隐藏，不显示陈旧值、
//   不弹错（D6：回显是补充信息，不该把详情页变成错误现场）。

import { parseOrchestrationSourceRef, type TodoRecord } from '@pacman/shared';
import { useGithubIssueEcho } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

interface SourceIssueLineProps {
  todo: TodoRecord;
  /** 未建成态的重试触发（mutations.retryGithubIssue）。 */
  onRetry: () => void;
  retryPending: boolean;
  /** #640 编排档：点开总管抽屉定位编排会话（缺省 = 静态行，不可点）。 */
  onOpenThread?: (threadId: string) => void;
}

export function SourceIssueLine({
  todo,
  onRetry,
  retryPending,
  onOpenThread,
}: SourceIssueLineProps) {
  const { t } = useI18n();
  // github 回显查询只吃 github 档（编排档无 issue 可拉，enabled 恒 false）。
  const echoQ = useGithubIssueEcho(
    todo.id,
    todo.sourceRef !== null && todo.sourceKind !== 'orchestration',
  );
  if (todo.sourceKind === null) return null;
  if (todo.sourceKind === 'orchestration') {
    // 畸形 ref（理论上不达——写入面走 orchestrationSourceRef 单源）退静态
    // 行不可点，不弹错（D6 同律）。
    const parsed = todo.sourceRef !== null ? parseOrchestrationSourceRef(todo.sourceRef) : null;
    return (
      <div
        className="flex min-w-0 items-center gap-2 px-4 pt-2 text-meta text-(--text-tertiary)"
        data-testid="source-orchestration"
      >
        <span className="flex-none text-(--text-tertiary)">{t('来源')}</span>
        {/* #1006 原型（#980 前提②④）：ghost 中和成文字链的老面 → registry
            Button link 档（text-primary + hover:underline 原生形态）；
            --card-button 品牌墨与 disabled 中性化退役（禁用态走 registry
            opacity 降档）。品牌色若要在链接位回来，走 token 层（前提④），
            实审裁。 */}
        <Button
          variant="link"
          className="h-auto p-0"
          data-testid="source-orchestration-link"
          onClick={
            parsed !== null && onOpenThread ? () => onOpenThread(parsed.threadId) : undefined
          }
          disabled={parsed === null || onOpenThread === undefined}
        >
          {t('总管编排会话')}
        </Button>
      </div>
    );
  }
  if (todo.sourceRef === null) {
    return (
      <div
        className="flex min-w-0 items-center gap-2 px-4 pt-2 text-meta text-(--text-tertiary)"
        data-testid="source-issue-pending"
      >
        <span className="flex-none text-(--text-tertiary)">{t('GitHub issue 未建成')}</span>
        {/* #1006 原型：registry Button link 档（同上）——老 text 变体的
            品牌墨/无降档中和退役。 */}
        <Button
          variant="link"
          className="h-auto p-0"
          data-testid="source-issue-retry"
          onClick={onRetry}
          disabled={retryPending}
        >
          {t('重试')}
        </Button>
      </div>
    );
  }
  // 拉不到（含首拉在飞——防闪半态）→ 整行隐藏（D6）。
  if (!echoQ.data) return null;
  const echo = echoQ.data;
  const mismatch = echo.title !== todo.title;
  return (
    <div
      className="flex min-w-0 items-center gap-2 px-4 pt-2 text-meta text-(--text-tertiary)"
      data-testid="source-issue-echo"
    >
      <span className="flex-none text-(--text-tertiary)">{t('来源 issue')}</span>
      <span className="flex-none text-(--text-secondary)">#{echo.number}</span>
      <span className="flex-none">{echo.state === 'open' ? t('打开') : t('已关闭')}</span>
      <span className="truncate">{echo.title}</span>
      {mismatch && (
        <span className="flex-none text-(--text-tertiary) italic" data-testid="source-issue-drift">
          {t('与本地标题不一致')}
        </span>
      )}
    </div>
  );
}
