import type { MemoryLayer, MemoryRecord, ProjectRecord } from '@cairn/shared';

export type MemoryScope = 'team' | 'project' | 'unknown-project';

export interface MemoryGroup {
  key: string;
  scope: MemoryScope;
  projectName: string | null;
  rows: MemoryRecord[];
}

export function groupMemories(
  memories: MemoryRecord[],
  projects: Pick<ProjectRecord, 'id' | 'name'>[],
): MemoryGroup[] {
  const team = memories.filter((memory) => memory.projectId === null);
  const known = projects.map((project) => ({
    key: project.id,
    scope: 'project' as const,
    projectName: project.name,
    rows: memories.filter((memory) => memory.projectId === project.id),
  }));
  const knownIds = new Set(projects.map((project) => project.id));
  const unknownIds = [
    ...new Set(
      memories
        .map((memory) => memory.projectId)
        .filter((id): id is string => id !== null && !knownIds.has(id)),
    ),
  ];
  const unknown = unknownIds.map((id) => ({
    key: id,
    scope: 'unknown-project' as const,
    projectName: null,
    rows: memories.filter((memory) => memory.projectId === id),
  }));
  return [
    { key: 'team', scope: 'team' as const, projectName: null, rows: team },
    ...known,
    ...unknown,
  ].filter((group) => group.rows.length > 0);
}

export function splitMemoryContent(content: string): { summary: string; details: string[] } {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const [summary = '', ...rest] = lines;
  return { summary, details: rest.map((line) => line.replace(/^[-*]\s+/, '')) };
}

export function isAutoInjected(layer: MemoryLayer | undefined): boolean {
  return layer === undefined || layer === 'core';
}
