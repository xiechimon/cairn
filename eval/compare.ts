import { readFileSync } from 'node:fs';

interface ItemResult {
  caseId: string;
  kind: string;
  repeat: number;
  scores: Record<string, number>;
  comments: Record<string, string>;
  incomplete?: string;
  gate: boolean;
}
interface ArmResult {
  arm: string;
  items: ItemResult[];
}
interface Row {
  caseId: string;
  kind: string;
  gate: boolean;
  basePass: number;
  baseTrials: number;
  candPass: number;
  candTrials: number;
  baseIncomplete: number;
  candIncomplete: number;
  regressed: boolean;
}

const pass = (item: ItemResult): number =>
  Object.values(item.scores).length > 0 && Object.values(item.scores).every((v) => v === 1) ? 1 : 0;

export function compare(base: ArmResult, cand: ArmResult) {
  const rows: Row[] = [];
  const ids = [...new Set([...base.items, ...cand.items].map((i) => i.caseId))].sort();
  for (const caseId of ids) {
    const b = base.items.filter((i) => i.caseId === caseId);
    const c = cand.items.filter((i) => i.caseId === caseId);
    const kind = (b[0] ?? c[0])?.kind ?? 'runtime';
    const gate = (b[0] ?? c[0])?.gate ?? true;
    const baseIncomplete = b.filter((i) => i.incomplete !== undefined).length;
    const candIncomplete = c.filter((i) => i.incomplete !== undefined).length;
    const basePass = b.filter((i) => i.incomplete === undefined && pass(i) === 1).length;
    const candPass = c.filter((i) => i.incomplete === undefined && pass(i) === 1).length;
    const contaminated = baseIncomplete + candIncomplete > 0;
    rows.push({
      caseId,
      kind,
      gate,
      basePass,
      baseTrials: b.length,
      candPass,
      candTrials: c.length,
      baseIncomplete,
      candIncomplete,
      regressed: gate && !contaminated && basePass > 0 && candPass < basePass,
    });
  }
  const regressions = rows.filter((r) => r.regressed);
  const incompletes = rows.filter(
    (r) => r.gate !== false && r.baseIncomplete + r.candIncomplete > 0,
  );
  const verdict =
    regressions.length > 0 ? 'regression' : incompletes.length > 0 ? 'incomplete' : 'pass';
  return { verdict, rows, regressions, incompletes };
}

export function markdown(
  out: ReturnType<typeof compare>,
  baseSha: string,
  candSha: string,
): string {
  const lines = [
    `## Eval gate: ${out.verdict}`,
    '',
    `baseline \`${baseSha.slice(0, 8)}\` vs candidate \`${candSha.slice(0, 8)}\``,
    '',
    '| case | kind | base | candidate | verdict |',
    '|---|---|---|---|---|',
    ...out.rows.map(
      (r) =>
        `| ${r.caseId} | ${r.kind} | ${r.basePass}/${r.baseTrials} | ${r.candPass}/${r.candTrials} | ${r.regressed ? 'REGRESSED' : r.baseIncomplete + r.candIncomplete > 0 ? 'incomplete' : 'ok'} |`,
    ),
  ];
  if (out.regressions.length > 0) {
    lines.push('', `Regressed: ${out.regressions.map((r) => r.caseId).join(', ')}`);
  }
  if (out.incompletes.length > 0) {
    lines.push('', `Incomplete (infra): ${out.incompletes.map((r) => r.caseId).join(', ')}`);
  }
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('compare.ts')) {
  const [, , baseFile, candFile, baseSha = 'base', candSha = 'cand'] = process.argv;
  if (baseFile === undefined || candFile === undefined) {
    console.error('usage: compare.mts <base.json> <cand.json> [baseSha] [candSha]');
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(baseFile, 'utf8')) as ArmResult;
  const cand = JSON.parse(readFileSync(candFile, 'utf8')) as ArmResult;
  const out = compare(base, cand);
  console.log(markdown(out, baseSha, candSha));
  process.exit(out.verdict === 'pass' ? 0 : 1);
}
