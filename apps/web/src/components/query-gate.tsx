import type { ReactNode } from 'react';
import { useI18n } from '../i18n/provider.js';
import { Button } from './ui/button.js';
import { Skeleton } from './ui/skeleton.js';

export interface GateQuery {
  data: unknown;
  isError: boolean;
  isPending: boolean;
  refetch: () => unknown;
}

export function QueryLoading({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="query-loading"
      role="status"
      aria-busy="true"
      aria-label={t('正在加载')}
      className="mt-4 flex flex-col gap-2"
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={`row-${index + 1}`} className="h-12 w-full rounded-(--radius-card)" />
      ))}
    </div>
  );
}

export function QueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="query-error"
      role="alert"
      className="mt-4 flex items-center gap-3 rounded-(--radius-card) px-4 py-3 text-ui text-content-secondary ring-1 ring-border"
    >
      <span className="min-w-0 flex-auto">{t('无法加载，请重试。')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('重试')}
      </Button>
    </div>
  );
}

export function QueryGate({
  query,
  live,
  rows,
  children,
}: {
  query: GateQuery;
  live: boolean;
  rows?: number;
  children: ReactNode;
}) {
  if (!live || query.data !== undefined) return children;
  if (query.isError) return <QueryError onRetry={() => void query.refetch()} />;
  if (query.isPending) return <QueryLoading rows={rows} />;
  return children;
}
