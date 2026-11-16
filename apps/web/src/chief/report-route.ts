import { useChiefThreads, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';

export interface Channel {
  projectId: string | null;
  name: string | null;
}

export function channelHref(projectId: string): string {
  return `/app?${new URLSearchParams({ project: projectId, chat: '1' })}`;
}

export function useChannelOf(): (threadId: string) => Channel | undefined {
  const { live, teamId } = useLiveData();
  const threads = useChiefThreads(teamId, live).data;
  const projects = useProjects(teamId, live).data;
  return (threadId) => {
    const thread = threads?.find((row) => row.id === threadId);
    if (thread === undefined) return undefined;
    const projectId = thread.projectId ?? null;
    if (projectId === null) return { projectId, name: null };
    return { projectId, name: projects?.find((p) => p.id === projectId)?.name ?? thread.title };
  };
}
