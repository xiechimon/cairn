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
      onMutate: (models) => store({ models }),
      onSuccess: store,
      onError: () => client.invalidateQueries({ queryKey: key }),
    }),
  };
}
