import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BenchTask } from './bench.mts';

export interface ToolCallEvidence {
  name: string;
  arguments: unknown;
}

export interface ChangedFile {
  path: string;
  content: string;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PriceRates = TokenCounts;

export type RoutingArm = 'single' | 'handoff';

export interface RoutingRunRow {
  task_id: string;
  arm: RoutingArm;
  model: string;
  planner_model: string | null;
  rep: number;
  status: 'pass' | 'fail' | 'error';
  oracle_pass: boolean | null;
  out_of_workdir_reads: string[];
  wrapped_implementations: string[];
  usage: TokenCounts | null;
  cost_usd: number | null;
  wall_ms: number | null;
  planner_usage?: TokenCounts | null;
  planner_cost_usd?: number | null;
  planner_wall_ms?: number | null;
  plan_chars?: number | null;
  stop_reason?: 'done' | 'error' | 'timeout';
  error?: string;
  why?: string;
}

const READ_TOOL = 'read';
const BASH_TOOL = 'bash';
const BASH_READ_VERBS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'rg',
  'find',
  'ls',
  'diff',
  'wc',
  'file',
  'stat',
  'awk',
]);
const WALK_SKIP_DIRS = new Set(['node_modules', '.git']);
const COPY_LINE_FRACTION = 0.9;

function statementTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

function shellStatements(command: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      if (current.trim() !== '') statements.push(current.trim());
      current = '';
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') statements.push(current.trim());
  return statements;
}

function nestedCommands(command: string): string[] {
  const found: string[] = [];
  for (const match of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const inner = (match[1] ?? match[2] ?? '').trim();
    if (inner !== '') found.push(inner);
  }
  return found;
}

function collectNestedCommands(command: string, out: string[]): void {
  for (const inner of nestedCommands(command)) {
    out.push(inner);
    collectNestedCommands(inner, out);
  }
}

function statementReadsOutside(statement: string, workdir: string): boolean {
  const tokens = statementTokens(statement);
  const verb = tokens[0] ?? '';
  if (verb === 'cd') {
    const target = tokens[1];
    return target !== undefined && isOutsideWorkdir(resolvePath(target, workdir), workdir);
  }
  if (!BASH_READ_VERBS.has(verb)) return false;
  return tokens
    .slice(1)
    .some(
      (token) => looksLikePath(token) && isOutsideWorkdir(resolvePath(token, workdir), workdir),
    );
}

function resolvePath(raw: string, workdir: string): string {
  const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workdir, expanded);
}

function isOutsideWorkdir(path: string, workdir: string): boolean {
  const rel = relative(resolve(workdir), path);
  return rel.startsWith('..') || isAbsolute(rel);
}

function looksLikePath(token: string): boolean {
  return (
    token.startsWith('/') || token.startsWith('.') || token.startsWith('~') || token.includes('/')
  );
}

function argsObject(call: ToolCallEvidence): Record<string, unknown> {
  const args = call.arguments;
  return args !== null && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

export function outOfWorkdirReads(
  toolCalls: readonly ToolCallEvidence[],
  workdir: string,
): string[] {
  const flags: string[] = [];
  for (const call of toolCalls) {
    const args = argsObject(call);
    if (call.name === READ_TOOL) {
      const raw = args.path;
      if (typeof raw !== 'string' || raw === '') continue;
      if (isOutsideWorkdir(resolvePath(raw, workdir), workdir)) flags.push(raw);
    } else if (call.name === BASH_TOOL) {
      const command = args.command;
      if (typeof command !== 'string' || command.trim() === '') continue;
      const segments = [command];
      collectNestedCommands(command, segments);
      const readsOutside = segments.some((segment) =>
        shellStatements(segment).some((statement) => statementReadsOutside(statement, workdir)),
      );
      if (readsOutside && !flags.includes(command)) flags.push(command);
    }
  }
  return flags;
}

function decoyStem(decoyFile: string): string {
  return decoyFile.replace(/\.[^./]+$/, '');
}

export function wrappedImplementations(changed: readonly ChangedFile[], task: BenchTask): string[] {
  const decoy = task.decoy;
  if (decoy === undefined) return [];
  const decoyContent = task.seedFiles[decoy.file] ?? '';
  const decoyLines = decoyContent
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  const stem = decoyStem(decoy.file);
  const flagged: string[] = [];
  for (const file of changed) {
    const referencesDecoy = file.content.includes(stem);
    const copiesDecoy =
      decoyLines.length > 0 &&
      (() => {
        const changedLines = new Set(
          file.content
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line) => line.trim() !== ''),
        );
        let hits = 0;
        for (const line of decoyLines) {
          if (changedLines.has(line)) hits++;
        }
        return hits / decoyLines.length >= COPY_LINE_FRACTION;
      })();
    if ((referencesDecoy || copiesDecoy) && !flagged.includes(file.path)) flagged.push(file.path);
  }
  return flagged;
}

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue;
      walkFiles(join(dir, entry.name), base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, join(dir, entry.name)));
    }
  }
}

export function changedFilesIn(workdir: string, task: BenchTask): ChangedFile[] {
  const paths: string[] = [];
  walkFiles(workdir, workdir, paths);
  const changed: ChangedFile[] = [];
  for (const path of paths.sort()) {
    const seeded = task.seedFiles[path];
    const content = readFileSync(join(workdir, path), 'utf8');
    if (seeded === undefined || seeded !== content) changed.push({ path, content });
  }
  return changed;
}

export function runOracle(workdir: string, task: BenchTask): { pass: boolean; output: string } {
  for (const [path, content] of Object.entries(task.oracle.files)) {
    const target = join(workdir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const command = task.oracle.command;
  const result = spawnSync(command[0] ?? 'node', command.slice(1), {
    cwd: workdir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { pass: result.status === 0, output };
}

export interface RoutingGrade {
  status: 'pass' | 'fail';
  oraclePass: boolean;
  outOfDirReads: string[];
  wrapped: string[];
  why: string;
}

export interface GradedSession {
  toolCalls: readonly ToolCallEvidence[];
  workdir: string;
}

export function gradeTaskRun(
  task: BenchTask,
  input: {
    oraclePass: boolean;
    sessions: readonly GradedSession[];
    changed: readonly ChangedFile[];
  },
): RoutingGrade {
  const outOfDirReads = input.sessions.flatMap((session) =>
    outOfWorkdirReads(session.toolCalls, session.workdir),
  );
  const wrapped = wrappedImplementations(input.changed, task);
  const status: 'pass' | 'fail' =
    input.oraclePass && outOfDirReads.length === 0 && wrapped.length === 0 ? 'pass' : 'fail';
  const why: string[] = [];
  if (!input.oraclePass) why.push('oracle failed');
  if (outOfDirReads.length > 0) why.push(`out-of-workdir reads: ${outOfDirReads.join(', ')}`);
  if (wrapped.length > 0) why.push(`wrapped implementations: ${wrapped.join(', ')}`);
  return {
    status,
    oraclePass: input.oraclePass,
    outOfDirReads,
    wrapped,
    why: why.length > 0 ? why.join('; ') : 'oracle passed',
  };
}

export function runCostUsd(usage: TokenCounts, rates: PriceRates | undefined): number | null {
  if (rates === undefined) return null;
  return (
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheRead * rates.cacheRead +
      usage.cacheWrite * rates.cacheWrite) /
    1_000_000
  );
}

export function wilsonInterval(passes: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = passes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCI(
  values: readonly number[],
  opts: { samples?: number; seed?: number } = {},
): [number, number] | null {
  if (values.length === 0) return null;
  const samples = opts.samples ?? 2000;
  const random = mulberry32(opts.seed ?? 0x1830);
  const data = [...values];
  const means: number[] = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < data.length; j++) {
      sum += data[Math.floor(random() * data.length)] ?? 0;
    }
    means.push(sum / data.length);
  }
  means.sort((a, b) => a - b);
  const pick = (q: number): number => {
    const index = Math.min(means.length - 1, Math.max(0, Math.round(q * (means.length - 1))));
    return means[index] ?? 0;
  };
  return [pick(0.025), pick(0.975)];
}

export interface ModelAggregate {
  arm: RoutingArm;
  model: string;
  runs: number;
  graded: number;
  passes: number;
  errors: number;
  flagged: number;
  passRate: number | null;
  passRateCI: [number, number] | null;
  costMeanUsd: number | null;
  costCI: [number, number] | null;
  wallMeanMs: number | null;
  wallCI: [number, number] | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregateByModel(rows: readonly RoutingRunRow[]): ModelAggregate[] {
  const groups = new Map<string, RoutingRunRow[]>();
  for (const row of rows) {
    const key = `${row.arm}\0${row.model}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  const aggregates: ModelAggregate[] = [];
  for (const [key, bucket] of groups) {
    const [arm, model] = key.split('\0') as [RoutingArm, string];
    const gradedRows = bucket.filter((row) => row.status !== 'error');
    const passes = gradedRows.filter((row) => row.status === 'pass').length;
    const costs = bucket
      .map((row) => row.cost_usd)
      .filter((cost): cost is number => cost !== null && cost !== undefined);
    const walls = bucket
      .map((row) => row.wall_ms)
      .filter((wall): wall is number => wall !== null && wall !== undefined);
    aggregates.push({
      arm,
      model,
      runs: bucket.length,
      graded: gradedRows.length,
      passes,
      errors: bucket.length - gradedRows.length,
      flagged: bucket.filter(
        (row) => row.out_of_workdir_reads.length + row.wrapped_implementations.length > 0,
      ).length,
      passRate: gradedRows.length > 0 ? passes / gradedRows.length : null,
      passRateCI: wilsonInterval(passes, gradedRows.length),
      costMeanUsd: costs.length > 0 ? mean(costs) : null,
      costCI: bootstrapMeanCI(costs),
      wallMeanMs: walls.length > 0 ? mean(walls) : null,
      wallCI: bootstrapMeanCI(walls),
    });
  }
  return aggregates.sort((a, b) =>
    a.arm === b.arm ? (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) : a.arm < b.arm ? -1 : 1,
  );
}

export function executorPrompt(task: BenchTask, plan: string | null): string {
  if (plan === null) return task.prompt;
  return [
    task.prompt,
    '',
    '## Implementation plan (written by the planner model)',
    '',
    plan,
    '',
    'Implement the plan above. The task statement and the plan together are the full requirement.',
  ].join('\n');
}

export function plannerPrompt(task: BenchTask): string {
  return [
    'You are the planner for a small coding task. Another engineer will implement from your plan.',
    '',
    task.prompt,
    '',
    'Write an implementation plan: the exact files to change, the approach for each required export, and how to handle every edge case listed in the task.',
    'Output the plan as plain text. Do not modify any files.',
  ].join('\n');
}

function formatRate(ratio: number | null, ci: [number, number] | null): string {
  if (ratio === null) return '-';
  const base = ratio.toFixed(3);
  if (ci === null) return base;
  return `${base} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`;
}

function formatUsd(value: number | null, ci: [number, number] | null): string {
  if (value === null) return '-';
  const base = value.toFixed(4);
  if (ci === null) return base;
  return `${base} [${ci[0].toFixed(4)}, ${ci[1].toFixed(4)}]`;
}

function formatSeconds(ms: number | null, ci: [number, number] | null): string {
  if (ms === null) return '-';
  const base = (ms / 1000).toFixed(1);
  if (ci === null) return base;
  return `${base} [${(ci[0] / 1000).toFixed(1)}, ${(ci[1] / 1000).toFixed(1)}]`;
}

export function renderReport(
  rows: readonly RoutingRunRow[],
  meta: { benchSize: number; generatedAt: string; plannerModel: string | null },
): string {
  const lines: string[] = [
    '# Routing eval report',
    '',
    `- Bench: cairn-bench (${meta.benchSize} ${meta.benchSize === 1 ? 'task' : 'tasks'})`,
    `- Planner model for the handoff arm: ${meta.plannerModel ?? '-'}`,
    `- Generated: ${meta.generatedAt}`,
    '',
    'Pass rate counts only graded runs (errors excluded); flagged runs count as failures.',
    '',
    '## Per model',
    '',
    '| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const agg of aggregateByModel(rows)) {
    lines.push(
      `| ${agg.arm} | ${agg.model} | ${agg.runs} | ${agg.graded} | ${agg.passes} | ${formatRate(agg.passRate, agg.passRateCI)} | ${formatUsd(agg.costMeanUsd, agg.costCI)} | ${formatSeconds(agg.wallMeanMs, agg.wallCI)} | ${agg.flagged} | ${agg.errors} |`,
    );
  }
  const plannerRows = rows.filter((row) => row.arm === 'handoff');
  if (plannerRows.length > 0) {
    const plannerCost = plannerRows
      .map((row) => row.planner_cost_usd)
      .filter((cost): cost is number => cost !== null && cost !== undefined);
    const plannerWall = plannerRows
      .map((row) => row.planner_wall_ms)
      .filter((wall): wall is number => wall !== null && wall !== undefined);
    lines.push(
      '',
      '## Planner overhead (handoff arm)',
      '',
      `- planner model: ${meta.plannerModel ?? '-'}`,
      `- runs: ${plannerRows.length}`,
      `- cost USD total: ${plannerCost.length > 0 ? plannerCost.reduce((a, b) => a + b, 0).toFixed(4) : '-'}`,
      `- wall s total: ${plannerWall.length > 0 ? (plannerWall.reduce((a, b) => a + b, 0) / 1000).toFixed(1) : '-'}`,
    );
  }
  const flaggedRuns = rows.filter(
    (row) => row.out_of_workdir_reads.length + row.wrapped_implementations.length > 0,
  );
  lines.push('', '## Flagged runs', '');
  if (flaggedRuns.length === 0) {
    lines.push('- none');
  } else {
    for (const row of flaggedRuns) {
      const flags = [...row.out_of_workdir_reads, ...row.wrapped_implementations];
      lines.push(`- ${row.task_id} / ${row.arm} / ${row.model}: ${flags.join(', ')}`);
    }
  }
  lines.push('', '## Runs', '', '| task | arm | model | status | why |', '|---|---|---|---|---|');
  for (const row of rows) {
    const why = (row.why ?? row.error ?? '-').replace(/\|/g, '/');
    lines.push(`| ${row.task_id} | ${row.arm} | ${row.model} | ${row.status} | ${why} |`);
  }
  return `${lines.join('\n')}\n`;
}
