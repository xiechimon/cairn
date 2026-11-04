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
const MAX_MATCH_LENGTH = 256;

const normalize = (value: string) =>
  value.length > MAX_MATCH_LENGTH ? '' : value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function editDistance(a: string, b: string): number {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  let previous = Array.from({ length: shorter.length + 1 }, (_, index) => index);
  let older = previous;
  for (let i = 1; i <= longer.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= shorter.length; j += 1) {
      let best = Math.min(
        (previous[j - 1] ?? 0) + (longer[i - 1] === shorter[j - 1] ? 0 : 1),
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
      );
      if (i > 1 && j > 1 && longer[i - 1] === shorter[j - 2] && longer[i - 2] === shorter[j - 1]) {
        best = Math.min(best, (older[j - 2] ?? 0) + 1);
      }
      current[j] = best;
    }
    older = previous;
    previous = current;
  }
  return previous[shorter.length] ?? 0;
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
  if (allowed < 1 || Math.abs(target.length - candidate.length) > allowed) return null;
  return editDistance(target, candidate) <= allowed ? 2 : null;
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
