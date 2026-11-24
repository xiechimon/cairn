import type { PrPanelRow } from '@cairn/shared';
import { TraceCard } from '../components/chat/trace-parts.js';
import { PrCard } from '../components/thread/pr-card.js';
import { prCardModelOfRow } from '../components/thread/pr-panel-model.js';
import { Button } from '../components/ui/button.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';

export interface ThreadPrPanelProps {
  status: 'pending' | 'error' | 'success';
  rows: readonly PrPanelRow[];
  onViewChanges: (() => void) | undefined;
  onRetry: () => void;
}

export function ThreadPrPanel({ status, rows, onViewChanges, onRetry }: ThreadPrPanelProps) {
  const { t } = useI18n();
  const now = useMinuteClock();
  if (status === 'pending') return null;
  if (status === 'error') {
    return (
      <TraceCard
        data-testid="thread-pr-error"
        className="mt-5 flex items-center gap-2 py-1 pr-1.5 pl-3 text-meta text-content-tertiary"
      >
        <span className="min-w-0 flex-1 tabular-nums">
          {t('PR 状态未能加载，30 秒后自动重试。')}
        </span>
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-6.5 text-meta">
          {t('立即重试')}
        </Button>
      </TraceCard>
    );
  }
  if (rows.length === 0) return null;
  return (
    <TraceCard data-testid="thread-pr-panel" className="mt-5 px-1 py-0.5">
      {rows.map((row) => (
        <PrCard
          key={row.buildId}
          pr={prCardModelOfRow(row, now)}
          githubHref={row.url}
          readOnly
          {...(onViewChanges !== undefined ? { onViewDiff: onViewChanges } : {})}
        />
      ))}
    </TraceCard>
  );
}
