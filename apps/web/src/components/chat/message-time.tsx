import { cn } from 'cn';
import { isUsableTimestamp } from '../../board/rel-time.js';
import { useMinuteClock } from '../../hooks/use-minute-clock.js';
import { useI18n } from '../../i18n/provider.js';
import { dateTimeFormat } from '../../lib/date-format.js';
import { messageStampLabel, timeDividerLabel } from '../../lib/message-time.js';

const STAMP_CLS = 'text-caption whitespace-nowrap tabular-nums';

export function MessageTime({
  at,
  fallback,
  className,
}: {
  at?: number | null | undefined;
  fallback?: string | null | undefined;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const now = useMinuteClock();
  if (at == null || !isUsableTimestamp(at, now)) {
    return fallback == null ? null : (
      <span className={cn(STAMP_CLS, className)} data-testid="msg-stamp">
        {fallback}
      </span>
    );
  }
  const absolute = dateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at);
  return (
    <time
      className={cn(STAMP_CLS, className)}
      data-testid="msg-stamp"
      dateTime={new Date(at).toISOString()}
      title={absolute}
    >
      {messageStampLabel(at, Math.max(now, at), locale, t)}
    </time>
  );
}

export function TimeDivider({ at, className }: { at: number; className?: string }) {
  const { t, locale } = useI18n();
  const now = useMinuteClock();
  return (
    <div
      data-testid="chief-time-divider"
      className={cn('text-center text-caption tabular-nums text-(--text-tertiary)', className)}
    >
      <time dateTime={new Date(at).toISOString()}>
        {timeDividerLabel(at, Math.max(now, at), locale, t)}
      </time>
    </div>
  );
}
