import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { clockTime, type ThreadOrigin } from './thread-panel-model.js';

export function ThreadOriginLine({ origin, onJump }: { origin: ThreadOrigin; onJump: () => void }) {
  const { t, locale } = useI18n();
  return (
    <div
      data-testid="thread-origin"
      className="mt-1.5 flex flex-wrap items-baseline justify-end gap-x-2 text-meta text-content-tertiary"
    >
      <span className="min-w-0 truncate">
        {origin.at === null
          ? t('来自主对话')
          : t('来自主对话 · {time}', { time: clockTime(origin.at, locale) })}
      </span>
      <Button
        variant="ghost"
        data-testid="thread-origin-jump"
        onClick={onJump}
        className="h-auto flex-none rounded-none bg-transparent p-0 text-meta font-normal text-foreground hover:bg-transparent hover:underline dark:hover:bg-transparent"
      >
        {t('在主对话中查看')}
      </Button>
    </div>
  );
}
