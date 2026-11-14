import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLiveData } from '../api/provider.js';
import { useI18n } from '../i18n/provider.js';
import { EmptyState } from './empty-state.js';
import { Skeleton } from './ui/skeleton.js';

export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

export function mergeQueries(...queries: QueryLike[]): QueryLike {
  return {
    isPending: queries.some((q) => q.isPending),
    isError: queries.some((q) => q.isError),
    isFetching: queries.some((q) => q.isFetching),
    refetch: () => Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch())),
  };
}

export function withTeamsFailure(
  query: QueryLike | undefined,
  teamsQuery: { isError: boolean; isFetching: boolean; refetch: () => unknown } | undefined,
): QueryLike | undefined {
  if (query === undefined || teamsQuery === undefined) return query;
  if (!query.isPending || !teamsQuery.isError) return query;
  return {
    isPending: false,
    isError: true,
    isFetching: teamsQuery.isFetching,
    refetch: teamsQuery.refetch,
  };
}

export type QueryPhase = 'loading' | 'error' | 'empty' | 'ready';

export function queryPhase(
  query: Pick<QueryLike, 'isPending' | 'isError'> | undefined,
  isEmpty: boolean,
  errorWins = false,
): QueryPhase {
  if (query?.isPending) return 'loading';
  if (query?.isError && (isEmpty || errorWins)) return 'error';
  return isEmpty ? 'empty' : 'ready';
}

interface QueryBoundaryProps {
  query: QueryLike | undefined;
  isEmpty: boolean;
  empty: ReactNode;
  loadingLabel: string;
  errorTitle: string;
  errorWins?: boolean;
  className?: string;
  skeletonRows?: number;
  skeleton?: ReactNode;
  children: ReactNode;
}

export function QueryBoundary({
  query,
  isEmpty,
  empty,
  loadingLabel,
  errorTitle,
  errorWins,
  className,
  skeletonRows = 3,
  skeleton,
  children,
}: QueryBoundaryProps) {
  const { t } = useI18n();
  const { teamsQuery } = useLiveData();
  const effective = withTeamsFailure(query, teamsQuery);
  const phase = queryPhase(effective, isEmpty, errorWins);
  if (phase === 'loading') {
    return (
      <div
        data-testid="query-loading"
        aria-busy="true"
        className={`flex flex-col gap-3 pt-2 ${className ?? ''}`}
      >
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
        {skeleton ??
          Array.from({ length: skeletonRows }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full animate-none" />
          ))}
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <EmptyState
        testId="query-error"
        icon={TriangleAlert}
        title={errorTitle}
        description={t('检查网络后再试一次。')}
        action={{
          label: t('重试'),
          disabled: effective?.isFetching,
          onClick: () => void effective?.refetch(),
        }}
        className={className}
      />
    );
  }
  return phase === 'empty' ? empty : children;
}
