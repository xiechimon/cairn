export interface CoverageRow {
  prompt_id?: unknown;
  id?: unknown;
  case_id?: unknown;
  rep?: unknown;
  status?: unknown;
  grade?: unknown;
}

export interface FamilyCoverage {
  family: string;
  scored: number;
  expected: number | null;
}

export function caseFamily(id: string): string {
  const match = /^([A-Za-z]+)/.exec(id);
  return match?.[1] ?? id;
}

function rowId(row: CoverageRow): string {
  const id = row.prompt_id ?? row.id ?? row.case_id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function rowRep(row: CoverageRow): number | null {
  return typeof row.rep === 'number' && Number.isInteger(row.rep) && row.rep >= 0 ? row.rep : null;
}

export function scoredValue(row: CoverageRow, metric: string): number | null {
  if (row.status != null && row.status !== 'ok') return null;
  const grade = row.grade;
  let value: unknown;
  if (grade !== null && typeof grade === 'object' && !Array.isArray(grade)) {
    value = (grade as Record<string, unknown>)[metric];
  } else if (metric === 'score') {
    value = grade;
  }
  if (typeof value === 'boolean') return Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function familyCoverage(input: {
  caseIds: readonly string[];
  results: readonly CoverageRow[];
  errors: readonly CoverageRow[];
  metric?: string;
}): FamilyCoverage[] {
  const declared = uniqueIds(input.caseIds);
  const seen = new Set(declared);
  const extra: string[] = [];
  const scoredKeys = new Set<string>();
  const scoredByFamily = new Map<string, number>();
  let maxRep = -1;
  const unknownFamilies = new Set<string>();

  const observe = (row: CoverageRow, score: boolean) => {
    const id = rowId(row);
    if (id && !seen.has(id)) {
      seen.add(id);
      extra.push(id);
    }
    const rep = rowRep(row);
    if (id && rep === null) unknownFamilies.add(caseFamily(id));
    if (rep !== null && rep > maxRep) maxRep = rep;
    if (!score || !id || rep === null || scoredValue(row, input.metric ?? 'decision_ok') === null)
      return;
    const key = `${id}\0${rep}`;
    if (scoredKeys.has(key)) return;
    scoredKeys.add(key);
    const family = caseFamily(id);
    scoredByFamily.set(family, (scoredByFamily.get(family) ?? 0) + 1);
  };

  for (const row of input.results) observe(row, true);
  for (const row of input.errors) observe(row, false);

  const repCount = maxRep + 1;

  const expectedByFamily = new Map<string, number>();
  for (const id of [...declared, ...extra]) {
    const family = caseFamily(id);
    expectedByFamily.set(family, (expectedByFamily.get(family) ?? 0) + repCount);
  }

  return [...expectedByFamily.keys()].sort().map((family) => ({
    family,
    scored: scoredByFamily.get(family) ?? 0,
    expected:
      repCount > 0 && !unknownFamilies.has(family) ? (expectedByFamily.get(family) ?? 0) : null,
  }));
}

export function isUnderCovered(row: FamilyCoverage): boolean {
  return row.expected === null || (row.expected > 0 && row.scored * 5 < row.expected * 4);
}

export function withheldFamilies(rows: readonly FamilyCoverage[]): string[] {
  return rows.filter(isUnderCovered).map((row) => row.family);
}

export function formatCoverage(rows: readonly FamilyCoverage[]): string {
  return rows.map((row) => `${row.family} ${row.scored}/${row.expected ?? 'unknown'}`).join(', ');
}

export function suspectTasks(
  results: readonly CoverageRow[],
  errors: readonly CoverageRow[],
): {
  id: string;
  trials: number;
}[] {
  const trials = new Map<string, Map<number, boolean>>();
  for (const row of [...results, ...errors]) {
    const id = rowId(row);
    const rep = rowRep(row);
    if (!id || rep === null) continue;
    const seen = trials.get(id) ?? new Map<number, boolean>();
    seen.set(rep, (seen.get(rep) ?? false) || scoredValue(row, 'decision_ok') === 1);
    trials.set(id, seen);
  }
  return [...trials]
    .filter(([, reps]) => reps.size >= 3 && ![...reps.values()].some(Boolean))
    .map(([id, reps]) => ({ id, trials: reps.size }));
}
