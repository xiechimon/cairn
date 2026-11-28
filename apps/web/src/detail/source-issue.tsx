import { parseOrchestrationSourceRef, type TodoRecord } from '@cairn/shared';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

interface SourceIssueLineProps {
  todo: TodoRecord;
  onOpenThread?: (threadId: string) => void;
}

export function SourceIssueLine({ todo, onOpenThread }: SourceIssueLineProps) {
  const { t } = useI18n();
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
          className="h-auto p-0 text-meta text-content-secondary decoration-content-tertiary hover:text-foreground"
          data-testid="source-orchestration-link"
          onClick={
            parsed !== null && onOpenThread ? () => onOpenThread(parsed.threadId) : undefined
          }
          disabled={parsed === null || onOpenThread === undefined}
        >
          {t('Coordinator 编排会话')}
        </Button>
      </div>
    );
  }
  return null;
}
