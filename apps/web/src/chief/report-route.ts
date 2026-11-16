import type { Phase } from '@cairn/shared';
import { useSearchParams } from 'react-router';
import { useChief, useChiefThreads, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useI18n } from '../i18n/provider.js';

export interface Channel {
  projectId: string | null;
  name: string | null;
}

const SETTLED_PHASES: ReadonlySet<Phase> = new Set(['done', 'closed']);

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

export function useReportRoute(todoId: string, phase: Phase): string | null {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const watches = useChief(teamId, live).data?.watches;
  const threads = useChiefThreads(teamId, live).data;
  const channelOf = useChannelOf();
  if (!live || watches === undefined || threads === undefined || SETTLED_PHASES.has(phase))
    return null;
  const watched = watches.find((watch) => watch.todoId === todoId)?.threadId;
  const target = watched ?? threads.find((thread) => (thread.projectId ?? null) === null)?.id;
  const channel = target === undefined ? undefined : channelOf(target);
  if (channel === undefined) return null;
  if (channel.projectId === searchParams.get('project')) return t('这里');
  if (channel.projectId === null) return t('主频道');
  return t('{channel} 频道', { channel: channel.name ?? '' });
}
