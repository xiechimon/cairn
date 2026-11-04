import type { ProjectColor, ProjectIcon } from '@cairn/shared';
import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
import { useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';

export interface ProjectMark {
  tone: number;
  icon: ProjectIcon | null | undefined;
  color: ProjectColor | null | undefined;
}

interface MarkSource {
  id: string;
  name: string;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
}

export function useProjectMark(): (key: string | undefined) => ProjectMark {
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const { search } = useLocation();
  const sources: MarkSource[] = useMemo(() => {
    if (live) return projectsQ.data ?? [];
    const fixture = resolveScenario(new URLSearchParams(search));
    return Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({
      id,
      name,
      ...fixture.projectAvatars?.[id],
    }));
  }, [live, projectsQ.data, search]);
  return useCallback(
    (key) => {
      const index = sources.findIndex((p) => p.id === key || p.name === key);
      const hit = sources[index];
      return { tone: Math.max(index, 0), icon: hit?.icon, color: hit?.color };
    },
    [sources],
  );
}
