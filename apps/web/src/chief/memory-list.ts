import type { MemoryLayer, MemoryRecord, ProjectRecord } from '@cairn/shared';

export type MemoryScope = 'team' | 'project' | 'unknown-project';

export interface MemorySection {
  key: string;
  scope: MemoryScope;
  projectName: string | null;
  project: Pick<ProjectRecord, 'id' | 'name' | 'instructions'> | null;
  injected: MemoryRecord[];
  lookup: MemoryRecord[];
}

export function isAutoInjected(layer: MemoryLayer | undefined): boolean {
  return layer === undefined || layer === 'core';
}

function section(
  key: string,
  scope: MemoryScope,
  project: Pick<ProjectRecord, 'id' | 'name' | 'instructions'> | null,
  rows: MemoryRecord[],
): MemorySection {
  return {
    key,
    scope,
    projectName: project?.name ?? null,
    project,
    injected: rows.filter((row) => isAutoInjected(row.layer)),
    lookup: rows.filter((row) => !isAutoInjected(row.layer)),
  };
}

export function memorySections(
  memories: MemoryRecord[],
  projects: Pick<ProjectRecord, 'id' | 'name' | 'instructions'>[],
): MemorySection[] {
  const team = memories.filter((memory) => memory.projectId === null);
  const knownIds = new Set(projects.map((project) => project.id));
  const unknownIds = [
    ...new Set(
      memories
        .map((memory) => memory.projectId)
        .filter((id): id is string => id !== null && !knownIds.has(id)),
    ),
  ];
  return [
    ...(team.length > 0 ? [section('team', 'team', null, team)] : []),
    ...projects.map((project) =>
      section(
        project.id,
        'project',
        project,
        memories.filter((memory) => memory.projectId === project.id),
      ),
    ),
    ...unknownIds.map((id) =>
      section(
        id,
        'unknown-project',
        null,
        memories.filter((memory) => memory.projectId === id),
      ),
    ),
  ];
}

export function splitMemoryContent(content: string): { summary: string; details: string[] } {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const [summary = '', ...rest] = lines;
  return { summary, details: rest.map((line) => line.replace(/^[-*]\s+/, '')) };
}
