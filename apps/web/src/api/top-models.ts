import type { TopModel, TopModelsEnvelope } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const TOP_MODELS_KEY = 'top-models';

export function useTopModels(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: [TOP_MODELS_KEY, teamId],
    queryFn: () => api.get<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`),
    enabled: live && teamId !== undefined,
    refetchOnWindowFocus: true,
  });
}

export function useTopModelsMutations(teamId: string | undefined) {
  const client = useQueryClient();
  const store = (data: TopModelsEnvelope) => client.setQueryData([TOP_MODELS_KEY, teamId], data);
  return {
    put: useMutation({
      mutationFn: (models: TopModel[]) =>
        api.put<TopModelsEnvelope>(`/api/teams/${teamId}/top-models`, { models }),
      onMutate: (models) => store({ models }),
      onSuccess: store,
      onError: () => client.invalidateQueries({ queryKey: [TOP_MODELS_KEY, teamId] }),
    }),
  };
}
