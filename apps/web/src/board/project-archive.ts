import { useMemo } from 'react';
import { useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { fixtureProjects, useFixtureArchiveEdits } from '../fixtures/project-archive-edits.js';
import type { FixtureSet } from '../fixtures/records.js';

export interface ArchivableProject {
  id: string;
  archivedAt?: number | null | undefined;
}

export function isArchivedProject(project: ArchivableProject): boolean {
  return project.archivedAt != null;
}

export function useArchivedProjectIds(fixture: FixtureSet): ReadonlySet<string> {
  const { live, teamId } = useLiveData();
  const { data } = useProjects(teamId, live);
  const edits = useFixtureArchiveEdits();
  return useMemo(() => {
    const projects = live ? (data ?? []) : fixtureProjects(fixture, edits);
    return new Set(projects.filter(isArchivedProject).map((project) => project.id));
  }, [live, data, fixture, edits]);
}

export function splitProjectsByArchive<T extends ArchivableProject>(
  projects: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const project of projects) {
    (isArchivedProject(project) ? archived : active).push(project);
  }
  return { active, archived };
}
