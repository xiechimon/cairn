import type { TopModel, TopModelsEnvelope } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const FREQUENT_MODELS_KEY = 'frequent-models';

export function useFrequentModels(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: [FREQUENT_MODELS_KEY, teamId],
    queryFn: () => api.get<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`),
    enabled: live && teamId !== undefined,
  });
}

export function useFrequentModelsMutations(teamId: string | undefined) {
  const client = useQueryClient();
  const key = [FREQUENT_MODELS_KEY, teamId];
  const store = (data: TopModelsEnvelope) => client.setQueryData(key, data);
  return {
    put: useMutation({
      mutationFn: (models: TopModel[]) =>
        api.put<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`, { models }),
      onMutate: async (models) => {
        await client.cancelQueries({ queryKey: key });
        const previous = client.getQueryData<TopModelsEnvelope>(key);
        store({ models });
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
