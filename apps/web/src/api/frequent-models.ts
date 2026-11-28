import type { TopModel, TopModelsEnvelope } from '@cairn/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const FREQUENT_MODELS_KEY = 'frequent-models';

export function useFrequentModels(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: [FREQUENT_MODELS_KEY, teamId],
    queryFn: () => api.get<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`),
    enabled: live && teamId !== undefined,
  });
}

const pendingSaves = new Map<string, Promise<TopModelsEnvelope>>();
const savedEnvelopes = new Map<string, TopModelsEnvelope>();

export function saveFrequentModels(
  client: QueryClient,
  key: readonly unknown[],
  teamId: string,
  models: TopModel[],
): Promise<TopModelsEnvelope> {
  const prior = pendingSaves.get(teamId) ?? Promise.resolve();
  const run = prior
    .catch((error: unknown) => {
      console.warn('cairn: previous frequent-model save failed', error);
    })
    .then(async () => {
      const current = savedEnvelopes.get(teamId) ?? client.getQueryData<TopModelsEnvelope>(key);
      const saved = await api.put<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`, {
        models,
        updatedAt: current?.updatedAt ?? null,
      });
      savedEnvelopes.set(teamId, saved);
      return saved;
    });
  pendingSaves.set(teamId, run);
  return run;
}

export function useFrequentModelsMutations(teamId: string | undefined) {
  const client = useQueryClient();
  const key = [FREQUENT_MODELS_KEY, teamId];
  const store = (data: TopModelsEnvelope) => client.setQueryData(key, data);
  return {
    put: useMutation({
      meta: { action: '保存常用模型' },
      mutationFn: (models: TopModel[]) => saveFrequentModels(client, key, teamId ?? '', models),
      onMutate: async (models) => {
        await client.cancelQueries({ queryKey: key });
        const previous = client.getQueryData<TopModelsEnvelope>(key);
        store({ models, updatedAt: previous?.updatedAt ?? null });
        return { previous };
      },
      onSuccess: store,
      onError: (_error, _models, context) => {
        if (context?.previous !== undefined) store(context.previous);
        void client.invalidateQueries({ queryKey: key });
      },
    }),
  };
}
