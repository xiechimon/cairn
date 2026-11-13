import { isArchivedProject } from './project-archive.js';
import {
  isWaiting,
  type Phrase,
  questionRowCopy,
  type TasksView,
  taskRowCopy,
} from './tasks-sections.js';

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

export const PROJECT_FILTERS = ['active', 'archived', 'all'] as const;

export type ProjectFilter = (typeof PROJECT_FILTERS)[number];

export function isProjectFilter(value: unknown): value is ProjectFilter {
  return PROJECT_FILTERS.some((filter) => filter === value);
}

function shownBy(filter: ProjectFilter, project: GroupableProject): boolean {
  if (filter === 'all') return true;
  return isArchivedProject(project) === (filter === 'archived');
}

export function sidebarProjects<T extends GroupableProject>(
  projects: readonly T[],
  filter: ProjectFilter = 'active',
): SidebarProjectLayout<T> {
  const ungrouped: T[] = [];
  const byGroup = new Map<string, T[]>();
  for (const project of projects) {
    if (!shownBy(filter, project)) continue;
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

export type ProjectStatus =
  | { kind: 'waiting'; word: string; what: Phrase }
  | { kind: 'working'; count: number };

export function projectStatuses(view: TasksView): Map<string, ProjectStatus> {
  const newest = new Map<string, { at: number; status: ProjectStatus }>();
  const offer = (projectId: string, at: number, status: ProjectStatus) => {
    const seen = newest.get(projectId);
    if (seen === undefined || at > seen.at) newest.set(projectId, { at, status });
  };
  const working = new Map<string, number>();
  for (const entry of view.entries) {
    const projectId = entry.todo.projectId;
    if (projectId == null) continue;
    if (isWaiting(entry.section)) {
      const { word, what } = taskRowCopy(entry);
      offer(projectId, entry.todo.phaseAt, { kind: 'waiting', word, what });
    } else if (entry.section === 'working') {
      working.set(projectId, (working.get(projectId) ?? 0) + 1);
    }
  }
  for (const question of view.questions) {
    if (question.projectId === null) continue;
    const { word, what } = questionRowCopy();
    offer(question.projectId, question.createdAt, { kind: 'waiting', word, what });
  }
  const statuses = new Map<string, ProjectStatus>();
  for (const [projectId, count] of working) statuses.set(projectId, { kind: 'working', count });
  for (const [projectId, { status }] of newest) statuses.set(projectId, status);
  return statuses;
}
