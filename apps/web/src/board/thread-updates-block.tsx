import { useI18n } from '../i18n/provider.js';
import { clockTime, type ThreadUpdates } from './thread-panel-model.js';

export function ThreadUpdatesBlock({ updates }: { updates: ThreadUpdates }) {
  const { t, locale } = useI18n();
  return (
    <section
      data-testid="thread-updates"
      aria-label={t('决定与更新')}
      className="mt-5 flex flex-col gap-1.5 first:mt-0"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-ui font-medium text-foreground">{t('决定与更新')}</h3>
        {updates.at !== null && (
          <time
            dateTime={new Date(updates.at).toISOString()}
            className="flex-none text-meta text-content-tertiary tabular-nums"
          >
            {t('{time} 更新', { time: clockTime(updates.at, locale) })}
          </time>
        )}
      </div>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-ui text-foreground">
        {updates.lines.map((line) => (
          <li key={line} className="[overflow-wrap:anywhere]">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
