import { useI18n } from '../i18n/provider.js';
import { clockTime, type ThreadUpdates } from './thread-panel-model.js';

export function ThreadUpdatesBlock({ updates }: { updates: ThreadUpdates }) {
  const { t, locale } = useI18n();
  return (
    <section
      data-testid="thread-updates"
      aria-label={t('决定与更新')}
      className="mx-4 mt-3 flex-none rounded-(--radius-card) border border-border px-3.5 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-ui font-semibold text-foreground">{t('决定与更新')}</h3>
        {updates.at !== null && (
          <time
            dateTime={new Date(updates.at).toISOString()}
            className="text-meta text-content-tertiary tabular-nums"
          >
            {t('{time} 更新', { time: clockTime(updates.at, locale) })}
          </time>
        )}
      </div>
      <ul className="m-0 mt-1.5 flex list-disc flex-col gap-0.5 pl-4.5 text-ui text-content-secondary">
        {updates.lines.map((line) => (
          <li key={line} className="[overflow-wrap:anywhere]">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
