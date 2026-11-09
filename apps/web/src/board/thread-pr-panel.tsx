import type { PrPanelRow } from '@cairn/shared';
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
      <div
        data-testid="thread-pr-error"
        className="flex flex-none items-center gap-2 border-b border-border px-4 py-2 text-meta text-content-tertiary"
      >
        <span className="min-w-0 flex-1">{t('PR 状态加载失败，稍后会自动重试。')}</span>
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-6.5 text-meta">
          {t('重试')}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <div
      data-testid="thread-pr-panel"
      className="flex max-h-[40%] flex-none flex-col gap-2 overflow-y-auto border-b border-border px-3 py-2.5"
    >
      {rows.map((row) => (
        <PrCard
          key={row.buildId}
          pr={prCardModelOfRow(row, now)}
          githubHref={row.url}
          readOnly
          {...(onViewChanges !== undefined ? { onViewDiff: onViewChanges } : {})}
        />
      ))}
    </div>
  );
}
