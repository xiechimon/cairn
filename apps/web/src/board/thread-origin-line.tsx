import { useI18n } from '../i18n/provider.js';
import { clockTime, type ThreadOrigin } from './thread-panel-model.js';

export function ThreadOriginLine({ origin, onJump }: { origin: ThreadOrigin; onJump: () => void }) {
  const { t, locale } = useI18n();
  return (
    <div
      data-testid="thread-origin"
      className="mx-4 mt-3 flex flex-none items-baseline justify-between gap-3 text-meta text-content-tertiary"
    >
      <span className="min-w-0 truncate">
        {origin.at === null
          ? t('来自主对话')
          : t('来自主对话 · {time}', { time: clockTime(origin.at, locale) })}
      </span>
      <button
        type="button"
        data-testid="thread-origin-jump"
        onClick={onJump}
        className="flex-none cursor-pointer border-0 bg-transparent p-0 text-meta font-medium text-foreground underline-offset-3 hover:underline"
      >
        {t('在主对话中查看')}
      </button>
    </div>
  );
}
