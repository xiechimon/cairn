export interface CoverageRow {
  prompt_id?: unknown;
  id?: unknown;
  case_id?: unknown;
  rep?: unknown;
}

export interface FamilyCoverage {
  family: string;
  scored: number;
  expected: number;
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
}): FamilyCoverage[] {
  const declared = uniqueIds(input.caseIds);
  const seen = new Set(declared);
  const extra: string[] = [];
  const scoredKeys = new Set<string>();
  const scoredByFamily = new Map<string, number>();
  let maxRep = -1;

  const observe = (row: CoverageRow, score: boolean) => {
    const id = rowId(row);
    if (id && !seen.has(id)) {
      seen.add(id);
      extra.push(id);
    }
    const rep = rowRep(row);
    if (rep !== null && rep > maxRep) maxRep = rep;
    if (!score || !id) return;
    const key = `${id}\0${rep ?? ''}`;
    if (scoredKeys.has(key)) return;
    scoredKeys.add(key);
    const family = caseFamily(id);
    scoredByFamily.set(family, (scoredByFamily.get(family) ?? 0) + 1);
  };

  for (const row of input.results) observe(row, true);
  for (const row of input.errors) observe(row, false);

  const repCount = maxRep + 1;
  if (repCount <= 0) return [];

  const expectedByFamily = new Map<string, number>();
  for (const id of [...declared, ...extra]) {
    const family = caseFamily(id);
    expectedByFamily.set(family, (expectedByFamily.get(family) ?? 0) + repCount);
  }

  return [...expectedByFamily.keys()].sort().map((family) => ({
    family,
    scored: scoredByFamily.get(family) ?? 0,
    expected: expectedByFamily.get(family) ?? 0,
  }));
}

export function isUnderCovered(row: FamilyCoverage): boolean {
  return row.expected > 0 && row.scored * 5 < row.expected * 4;
}

export function withheldFamilies(rows: readonly FamilyCoverage[]): string[] {
  return rows.filter(isUnderCovered).map((row) => row.family);
}

export function formatCoverage(rows: readonly FamilyCoverage[]): string {
  return rows.map((row) => `${row.family} ${row.scored}/${row.expected}`).join(', ');
}
