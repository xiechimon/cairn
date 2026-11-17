import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export function ThreadOriginLine({ onJump }: { onJump: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="thread-origin" className="mt-2 flex text-meta">
      <Button
        variant="link"
        data-testid="thread-origin-jump"
        onClick={onJump}
        className="h-auto p-0 text-meta text-content-secondary decoration-content-tertiary hover:text-foreground"
      >
        {t('在主对话中查看')}
      </Button>
    </div>
  );
}
