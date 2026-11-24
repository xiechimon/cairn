import type { PatchProviderBody, ProviderRecord, TeamProviderTestResult } from '@cairn/shared';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, type ProvidersEnvelope, useApiMutations, useProviders, useSaveProviderOrder } from '../src/api/hooks.js';
import { providerRowStatus, teamProviderStatusView } from '../src/resources/subscription-detail.js';

const clients: QueryClient[] = [];
const QUERY_KEY = ['providers', 't1'];
const RECORD: ProviderRecord = {
  kind: 'custom', providerId: 'relay-fixture', id: 'prov-relay', label: 'Relay connection',
  baseUrl: 'https://gateway.example.invalid/v1', api: 'openai-completions', authHeader: false,
  compat: {}, models: [{ id: 'small-model', name: 'Small model' }],
  createdBy: 'test-owner', createdAt: 1, updatedAt: 1,
  configurationFingerprint: 'a'.repeat(32),
};
const OK: TeamProviderTestResult = {
  status: 'ok', failure: null, reason: null, detail: null, httpStatus: 200, latencyMs: 412,
  configurationFingerprint: RECORD.configurationFingerprint!,
};
const ENVELOPE: ProvidersEnvelope = {
  presets: [{ id: 'anthropic', auth: 'api_key' }],
  providers: [RECORD, { ...RECORD, id: 'other-provider' }],
  order: ['provider:other-provider', `provider:${RECORD.id}`],
  canTestConnection: true,
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(QUERY_KEY, ENVELOPE);
  let mutations: ApiMutations | undefined;
  let orderMutation: ReturnType<typeof useSaveProviderOrder> | undefined;
  function Harness() {
    mutations = useApiMutations('t1');
    orderMutation = useSaveProviderOrder('t1');
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Harness)));
  if (mutations === undefined || orderMutation === undefined) throw new Error('Mutation harness did not render');
  const row = () => {
    const record = client.getQueryData<ProvidersEnvelope>(QUERY_KEY)!.providers[0]!;
    const t = (key: string) => key;
    return providerRowStatus(teamProviderStatusView(record, [], {
      [OK.configurationFingerprint]: { 'small-model': OK },
    }, t), record.models, t);
  };
  function ProvidersHarness() {
    useProviders('t1', false);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(ProvidersHarness)));
  return { client, mutation: mutations.patchProvider, orderMutation, row };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.clear();
});

it.each([
  { change: 'key', body: { apiKey: 'fixture-replacement-key' } },
  { change: 'endpoint', body: { baseUrl: 'https://new-gateway.example.invalid/v1' } },
].flatMap((change) => ['held', 'failed'].map((fetchState) => ({ ...change, fetchState }))))(
  'C1 C24: a saved $change cannot inherit Available while the list GET is $fetchState',
  async ({ body, fetchState }) => {
    const { client, mutation, row } = setup();
    expect(row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
    let failGet!: (error: Error) => void;
    const get = vi.spyOn(api, 'get').mockImplementation(() => new Promise<ProvidersEnvelope>((_resolve, reject) => {
      failGet = reject;
    }));
    const observer = new QueryObserver<ProvidersEnvelope>(client, {
      queryKey: QUERY_KEY,
      queryFn: () => api.get<ProvidersEnvelope>('/api/teams/t1/providers'),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    const saved = { ...RECORD, updatedAt: 3, ...('baseUrl' in body ? { baseUrl: body.baseUrl } : {}), configurationFingerprint: 'b'.repeat(32) };
    vi.spyOn(api, 'patch').mockResolvedValueOnce(saved);
    const atInvalidation: unknown[] = [];
    const invalidate = client.invalidateQueries.bind(client);
    vi.spyOn(client, 'invalidateQueries').mockImplementation((...args) => {
      atInvalidation.push(client.getQueryData(QUERY_KEY));
      return invalidate(...args);
    });
    try {
      await expect(mutation.mutateAsync({ id: RECORD.id, body: body as PatchProviderBody })).resolves.toEqual(saved);
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/api/teams/t1/providers/${RECORD.id}`, body);
      expect(get).toHaveBeenCalledExactlyOnceWith('/api/teams/t1/providers');
      expect(client.getQueryState(QUERY_KEY)?.fetchStatus).toBe('fetching');
      if (fetchState === 'failed') {
        failGet(new Error('List request failed'));
        await vi.waitFor(() => expect(client.getQueryState(QUERY_KEY)?.status).toBe('error'));
      }
      expect(row()).toMatchObject({ tone: 'off', statusLabel: '未检查' });
      const expected = { ...ENVELOPE, providers: [saved, ENVELOPE.providers[1]] };
      expect(client.getQueryData(QUERY_KEY)).toEqual(expected);
      expect(atInvalidation).toEqual([expected]);
    } finally {
      unsubscribe();
    }
  },
);

it.each(['held', 'failed'])('C1: ignores a late model PATCH after a newer configuration while GET is %s', async (fetchState) => {
  const { client, mutation, row } = setup();
  const newer = { ...RECORD, updatedAt: 3, configurationFingerprint: 'b'.repeat(32) };
  const older = { ...RECORD, updatedAt: 2, models: [] };
  let finish!: (record: ProviderRecord) => void;
  vi.spyOn(api, 'patch').mockImplementationOnce(() => new Promise<ProviderRecord>((resolve) => { finish = resolve; })).mockResolvedValueOnce(newer);
  vi.spyOn(api, 'get').mockImplementation(() => fetchState === 'failed' ? Promise.reject(new Error('List failed')) : new Promise(() => {}));
  const observer = new QueryObserver<ProvidersEnvelope>(client, { queryKey: QUERY_KEY, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const pending = mutation.mutateAsync({ id: RECORD.id, body: { models: [] } });
    await vi.waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await mutation.mutateAsync({ id: RECORD.id, body: { apiKey: 'fixture-replacement-key' } });
    expect(row().tone).toBe('off');
    finish(older);
    await pending;
    expect(client.getQueryData<ProvidersEnvelope>(QUERY_KEY)!.providers[0]).toEqual(newer);
    expect(row().tone).toBe('off');
  } finally {
    unsubscribe();
  }
});

it('C1: ignores an older GET finishing after a newer PATCH without losing envelope metadata', async () => {
  const { client, mutation, row } = setup();
  const newer = { ...RECORD, updatedAt: 3, configurationFingerprint: 'b'.repeat(32) };
  let finish!: (envelope: ProvidersEnvelope) => void;
  vi.spyOn(api, 'get').mockImplementation(() => new Promise<ProvidersEnvelope>((resolve) => { finish = resolve; }));
  vi.spyOn(api, 'patch').mockResolvedValueOnce(newer);
  const pending = client.refetchQueries({ queryKey: QUERY_KEY, type: 'all' });
  await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  await mutation.mutateAsync({ id: RECORD.id, body: { apiKey: 'fixture-replacement-key' } });
  finish({ ...ENVELOPE, canTestConnection: false });
  await pending;
  expect(client.getQueryData<ProvidersEnvelope>(QUERY_KEY)).toEqual({ ...ENVELOPE, canTestConnection: false, providers: [newer, ENVELOPE.providers[1]] });
  expect(row().tone).toBe('off');
});

it('C1 C24: a failed reorder rolls back only order, not a newer provider configuration', async () => {
  const { client, mutation, orderMutation, row } = setup();
  let fail!: (error: Error) => void;
  vi.spyOn(api, 'put').mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const pending = orderMutation.mutateAsync([`provider:${RECORD.id}`, 'provider:other-provider']);
  const rejected = expect(pending).rejects.toThrow('Order failed');
  await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  const newer = { ...RECORD, updatedAt: 3, configurationFingerprint: 'b'.repeat(32) };
  vi.spyOn(api, 'patch').mockResolvedValueOnce(newer);
  await mutation.mutateAsync({ id: RECORD.id, body: { apiKey: 'fixture-replacement-key' } });
  fail(new Error('Order failed'));
  await rejected;
  expect(client.getQueryData<ProvidersEnvelope>(QUERY_KEY)).toEqual({ ...ENVELOPE, providers: [newer, ENVELOPE.providers[1]] });
  expect(row().tone).toBe('off');
});

it('C1 C24: a failed save leaves the cached configuration and its passed check intact', async () => {
  const { client, mutation, row } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.spyOn(api, 'patch').mockRejectedValueOnce(new Error('Save failed'));
  await expect(mutation.mutateAsync({ id: RECORD.id, body: { apiKey: 'fixture-replacement-key' } })).rejects.toThrow('Save failed');
  expect(client.getQueryData(QUERY_KEY)).toBe(ENVELOPE);
  expect(row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
  expect(invalidate).not.toHaveBeenCalled();
});

it('C1: a successful rename keeps the passed check against the unchanged fingerprint', async () => {
  const { client, mutation, row } = setup();
  const saved = { ...RECORD, label: 'Renamed relay', updatedAt: 2 };
  vi.spyOn(api, 'patch').mockResolvedValueOnce(saved);
  await mutation.mutateAsync({ id: RECORD.id, body: { label: saved.label } });
  expect(client.getQueryData<ProvidersEnvelope>(QUERY_KEY)?.providers[0]).toEqual(saved);
  expect(row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
});
