import { parseOrchestrationSourceRef, type TodoRecord } from '@cairn/shared';
import { useGithubIssueEcho } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

interface SourceIssueLineProps {
  todo: TodoRecord;
  onRetry: () => void;
  retryPending: boolean;
  onOpenThread?: (threadId: string) => void;
}

export function SourceIssueLine({
  todo,
  onRetry,
  retryPending,
  onOpenThread,
}: SourceIssueLineProps) {
  const { t } = useI18n();
  const echoQ = useGithubIssueEcho(
    todo.id,
    todo.sourceRef !== null && todo.sourceKind !== 'orchestration',
  );
  if (todo.sourceKind === null) return null;
  if (todo.sourceKind === 'orchestration') {
    const parsed = todo.sourceRef !== null ? parseOrchestrationSourceRef(todo.sourceRef) : null;
    return (
      <div
        className="flex min-w-0 items-center gap-2 px-4 pt-2 text-meta text-(--text-tertiary)"
        data-testid="source-orchestration"
      >
        <span className="flex-none text-(--text-tertiary)">{t('来源')}</span>
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
