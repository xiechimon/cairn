import type { ProjectColor, ProjectIcon } from '@cairn/shared';

export interface SuggestableProject {
  id: string;
  name: string;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  lastActiveAt: number;
}

export interface ProjectSuggestions<P extends SuggestableProject> {
  projects: P[];
  kind: 'close' | 'recent';
}

const MIN_SUBSTRING_LENGTH = 3;

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      if (i === 0) {
        row[j] = j;
        continue;
      }
      const previous = rows[i - 1] ?? [];
      let best = Math.min(
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      row[j] = best;
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? 0;
}

function closeness(target: string, candidate: string): number | null {
  if (target === '' || candidate === '') return null;
  if (target === candidate) return 0;
  const shorter = Math.min(target.length, candidate.length);
  if (
    shorter >= MIN_SUBSTRING_LENGTH &&
    (target.includes(candidate) || candidate.includes(target))
  ) {
    return 1;
  }
  const allowed = Math.floor(Math.max(target.length, candidate.length) / 4);
  return allowed >= 1 && editDistance(target, candidate) <= allowed ? 2 : null;
}

const byRecency = (a: SuggestableProject, b: SuggestableProject) =>
  b.lastActiveAt - a.lastActiveAt || a.name.localeCompare(b.name);

export function suggestProjects<P extends SuggestableProject>(
  unknownId: string,
  projects: readonly P[],
  limit = 3,
): ProjectSuggestions<P> {
  const target = normalize(unknownId);
  const close = projects
    .flatMap((project) => {
      const rank = closeness(target, normalize(project.name));
      return rank === null ? [] : [{ project, rank }];
    })
    .sort((a, b) => a.rank - b.rank || byRecency(a.project, b.project))
    .slice(0, limit)
    .map((entry) => entry.project);
  if (close.length > 0) return { projects: close, kind: 'close' };
  return { projects: [...projects].sort(byRecency).slice(0, limit), kind: 'recent' };
}
