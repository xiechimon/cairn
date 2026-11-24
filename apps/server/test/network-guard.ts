import {
  installNetworkGuard as installSharedNetworkGuard,
  recordUnstubbedNetworkCall,
  takeUnstubbedNetworkCalls,
} from '../../../scripts/test-network-guard.mjs';
import type { FetchLike } from '../src/lib/github.js';

export function takeUnstubbedCalls(): string[] {
  return takeUnstubbedNetworkCalls();
}

export const rejectingGithubFetch: FetchLike = async (input, init) => {
  throw recordUnstubbedNetworkCall(
    `githubFetch ${init?.method ?? 'GET'} ${String(input)}`,
    'server',
  );
};

export function installNetworkGuard(): void {
  installSharedNetworkGuard({ suite: 'server' });
}
