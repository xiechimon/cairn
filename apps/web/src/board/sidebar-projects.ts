import { isArchivedProject } from './project-archive.js';
import { isWaiting, type TasksView } from './tasks-sections.js';

export interface GroupableProject {
  id: string;
  group?: string | null | undefined;
  archivedAt?: number | null | undefined;
}

export interface ProjectGroup<T> {
  name: string;
  projects: T[];
}

export interface SidebarProjectLayout<T> {
  ungrouped: T[];
  groups: ProjectGroup<T>[];
}

export function sidebarProjects<T extends GroupableProject>(
  projects: readonly T[],
): SidebarProjectLayout<T> {
  const ungrouped: T[] = [];
  const byGroup = new Map<string, T[]>();
  for (const project of projects) {
    if (isArchivedProject(project)) continue;
    if (project.group == null) {
      ungrouped.push(project);
      continue;
    }
    const rows = byGroup.get(project.group) ?? [];
    rows.push(project);
    byGroup.set(project.group, rows);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => ({ name, projects: rows }));
  return { ungrouped, groups };
}

export function waitingProjectIds(view: TasksView): Set<string> {
  const ids = new Set<string>();
  for (const entry of view.entries) {
    if (isWaiting(entry.section) && entry.todo.projectId != null) ids.add(entry.todo.projectId);
  }
  for (const question of view.questions) {
    if (question.projectId !== null) ids.add(question.projectId);
  }
  return ids;
}
