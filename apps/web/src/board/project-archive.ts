export interface ArchivableProject {
  id: string;
  archivedAt?: number | null | undefined;
}

export function isArchivedProject(project: ArchivableProject): boolean {
  return project.archivedAt != null;
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
