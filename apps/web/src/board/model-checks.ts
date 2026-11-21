import type { ProviderFailure } from '@cairn/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';

export type ModelCheck =
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'failed'; failure: ProviderFailure; reason: string | null };

export interface CheckedProvider {
  id: string;
  providerId: string;
  models: readonly { id: string }[];
}

const TEST_WINDOW_MS = 60_000;
const TESTS_PER_WINDOW = 5;
const PROVIDER_WIDE: ReadonlySet<ProviderFailure> = new Set(['auth', 'network', 'invalid']);
const BUSY: ReadonlySet<ProviderFailure> = new Set(['rate-limit', 'timeout', 'upstream']);

export function checkKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function providerWide(check: ModelCheck | undefined): boolean {
  return check?.state === 'failed' && PROVIDER_WIDE.has(check.failure);
}

export function rejectedProviders(checks: ReadonlyMap<string, ModelCheck>): ReadonlySet<string> {
  const rejected = new Set<string>();
  for (const [key, check] of checks) {
    if (providerWide(check)) rejected.add(key.slice(0, key.indexOf('/')));
  }
  return rejected;
}

export function hiddenFromPicker(
  checks: ReadonlyMap<string, ModelCheck>,
  rejected: ReadonlySet<string>,
  providerId: string,
  modelId: string,
): boolean {
  if (rejected.has(providerId)) return true;
  const check = checks.get(checkKey(providerId, modelId));
  return check?.state === 'failed' && !BUSY.has(check.failure);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useModelChecks(teamId: string | undefined) {
  const { testProvider } = useApiMutations(teamId);
  const test = useRef(testProvider.mutateAsync);
  test.current = testProvider.mutateAsync;
  const [checks, setChecks] = useState<ReadonlyMap<string, ModelCheck>>(new Map());
  const hits = useRef(new Map<string, number[]>());
  const started = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const record = useCallback((key: string, check: ModelCheck) => {
    if (alive.current) setChecks((prev) => new Map(prev).set(key, check));
  }, []);

  const takeSlot = useCallback(async (recordId: string) => {
    for (;;) {
      const now = Date.now();
      const recent = (hits.current.get(recordId) ?? []).filter((at) => now - at < TEST_WINDOW_MS);
      if (recent.length < TESTS_PER_WINDOW) {
        hits.current.set(recordId, [...recent, now]);
        return;
      }
      hits.current.set(recordId, recent);
      await wait((recent[0] ?? now) + TEST_WINDOW_MS - now);
    }
  }, []);

  const checkModel = useCallback(
    async (provider: CheckedProvider, modelId: string): Promise<ModelCheck> => {
      const key = checkKey(provider.providerId, modelId);
      record(key, { state: 'checking' });
      for (;;) {
        await takeSlot(provider.id);
        if (!alive.current) return { state: 'checking' };
        try {
          const result = await test.current({ id: provider.id, model: modelId });
          const check: ModelCheck =
            result.status === 'ok'
              ? { state: 'ok' }
              : { state: 'failed', failure: result.failure ?? 'network', reason: result.reason };
          record(key, check);
          return check;
        } catch (error) {
          if (error instanceof ApiError && error.status === 429) continue;
          const check: ModelCheck = {
            state: 'failed',
            failure: 'network',
            reason: error instanceof Error ? error.message : null,
          };
          record(key, check);
          return check;
        }
      }
    },
    [record, takeSlot],
  );

  const checkProvider = useCallback(
    async (provider: CheckedProvider) => {
      if (started.current.has(provider.id)) return;
      started.current.add(provider.id);
      for (const model of provider.models) {
        if (!alive.current) return;
        const check = await checkModel(provider, model.id);
        if (providerWide(check)) return;
      }
    },
    [checkModel],
  );

  return { checks, checkModel, checkProvider };
}

export type ModelChecks = ReturnType<typeof useModelChecks>;
