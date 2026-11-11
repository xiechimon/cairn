import { useSyncExternalStore } from 'react';
import type { FixtureSet } from './records.js';

export type FixtureArchiveEdits = ReadonlyMap<string, number | null>;

let edits: FixtureArchiveEdits = new Map();
const listeners = new Set<() => void>();

export function setFixtureProjectArchived(id: string, archivedAt: number | null): void {
  edits = new Map(edits).set(id, archivedAt);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFixtureArchiveEdits(): FixtureArchiveEdits {
  return useSyncExternalStore(
    subscribe,
    () => edits,
    () => edits,
  );
}

export interface FixtureProject {
  id: string;
  name: string;
  archivedAt: number | null;
}

export function fixtureProjects(
  fixture: FixtureSet,
  archive: FixtureArchiveEdits,
): FixtureProject[] {
  const archived = fixture.archivedProjects ?? [];
  const listed = [
    ...Object.entries(fixture.projectNames ?? {})
      .filter(([id]) => !archived.some((project) => project.id === id))
      .map(([id, name]) => ({ id, name, archivedAt: null })),
    ...archived.map(({ id, name, archivedAt }) => ({ id, name, archivedAt })),
  ];
  return listed.map((project) =>
    archive.has(project.id) ? { ...project, archivedAt: archive.get(project.id) ?? null } : project,
  );
}
