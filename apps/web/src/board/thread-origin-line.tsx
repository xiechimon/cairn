import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export function ThreadOriginLine({ onJump }: { onJump: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="thread-origin" className="-mb-0.5 mt-1.5 flex justify-end">
      <Button
        variant="ghost"
        data-testid="thread-origin-jump"
        onClick={onJump}
        className="h-6 flex-none rounded-none bg-transparent p-0 text-ui font-normal text-foreground hover:bg-transparent hover:underline dark:hover:bg-transparent"
      >
        {t('在主对话中查看')}
      </Button>
    </div>
  );
}
