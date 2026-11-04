import {
  type DefaultError,
  type Query,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  type QueryOptions,
  type QueryState,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import {
  AUTONOMY,
  BRANCHES,
  FS_ROOT,
  fsListing,
  GITHUB_ISSUES,
  ISSUE_ECHO,
} from './product-fixtures.js';

function fixtureFor(key: QueryKey): unknown {
  switch (key[0]) {
    case 'project-autonomy':
      return AUTONOMY;
    case 'github-issues': {
      const page = Number(key[3] ?? 1);
      return { ...GITHUB_ISSUES, page, hasMore: page < 2 };
    }
    case 'fs-list':
      return fsListing(typeof key[1] === 'string' ? key[1] : FS_ROOT);
    case 'memories':
      return [];
    case 'github-issue-echo':
      return ISSUE_ECHO;
    case 'project-branches':
      return BRANCHES;
    default:
      return undefined;
  }
}

class FixtureQueryCache extends QueryCache {
  override build<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    client: QueryClient,
    options: QueryOptions<TQueryFnData, TError, TData, TQueryKey> & { queryKey: TQueryKey },
    state?: QueryState<TData, TError>,
  ): Query<TQueryFnData, TError, TData, TQueryKey> {
    const query = super.build(client, options, state);
    if (query.state.data === undefined) {
      const data = fixtureFor(query.queryKey);
      if (data !== undefined) query.setData(data as TData);
    }
    return query;
  }
}

const client = new QueryClient({
  queryCache: new FixtureQueryCache(),
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});

export function ProductProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
