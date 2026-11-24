import { Button } from '../../components/ui/button.js';
import { Kbd } from '../../components/ui/kbd.js';
import { useI18n } from '../../i18n/provider.js';

export function CommentStrip({
  hint,
  tool,
  onExit,
}: {
  hint: string;
  tool?: { label: string; testId: string; onClick: () => void };
  onExit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="artifact-comment-strip"
      role="status"
      className="flex h-9 flex-none items-center gap-2 border-b border-border bg-(--surface-1) pr-2 pl-4 text-ui text-foreground"
    >
      <span className="min-w-0 flex-1 truncate">{hint}</span>
      {tool !== undefined && (
        <Button
          variant="ghost"
          size="xs"
          data-testid={tool.testId}
          onClick={tool.onClick}
          className="text-content-secondary"
        >
          {tool.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        data-testid="artifact-comment-exit"
        onClick={onExit}
        className="gap-1 text-content-secondary"
      >
        <Kbd>Esc</Kbd>
        {t('退出')}
      </Button>
    </div>
  );
}
