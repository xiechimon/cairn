import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BenchTask, CAIRN_BENCH_TASKS } from './bench.mts';
import type { RoutingArm } from './driver.mts';

export const EXPERIMENT_MANIFEST = 'experiment.json';
export const RESULTS_JSONL = 'results.jsonl';

export type PriceRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export interface ExperimentIdentity {
  version: 1;
  arms: RoutingArm[];
  planner: string | null;
  executors: string[];
  singleModels: string[];
  taskIds: string[];
  taskDigest: string;
  harnessDigest: string;
  reps: number;
  timeoutS: number;
  thinking: string | null;
  prices: Record<string, PriceRates> | null;
  pricesDigest: string | null;
}

export interface ResumeRow {
  task_id: string;
  arm: RoutingArm;
  model: string;
  planner_model: string | null;
  rep: number;
}

const HARNESS_FILES = [
  'bench.mts',
  'boundary.mts',
  'driver.mts',
  'experiment.mts',
  'grade.mts',
  'oracle.mts',
  'report.mts',
  'run.mts',
  'session-tools.mts',
] as const;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function taskDigest(tasks: readonly BenchTask[]): string {
  const h = createHash('sha256');
  for (const task of [...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    h.update(task.id).update('\0');
    h.update(task.prompt).update('\0');
    h.update(JSON.stringify(task.seedFiles)).update('\0');
    h.update(JSON.stringify(task.oracle)).update('\0');
    h.update(JSON.stringify(task.decoy ?? null)).update('\0');
  }
  return h.digest('hex');
}

export function harnessDigest(here = dirname(fileURLToPath(import.meta.url))): string {
  const h = createHash('sha256');
  for (const name of HARNESS_FILES) {
    const path = join(here, name);
    h.update(name).update('\0');
    if (existsSync(path)) h.update(readFileSync(path));
    h.update('\0');
  }
  return h.digest('hex');
}

export function pricesDigest(prices: Record<string, PriceRates> | null): string | null {
  if (prices === null) return null;
  return sha256(JSON.stringify(prices, Object.keys(prices).sort()));
}

export function buildExperimentIdentity(input: {
  arms: RoutingArm[];
  planner: string | null;
  executors: string[];
  singleModels: string[];
  tasks: readonly BenchTask[];
  reps: number;
  timeoutS: number;
  thinking: string | null;
  prices: Record<string, PriceRates> | null;
}): ExperimentIdentity {
  return {
    version: 1,
    arms: [...input.arms],
    planner: input.planner,
    executors: [...input.executors],
    singleModels: [...input.singleModels],
    taskIds: input.tasks.map((task) => task.id),
    taskDigest: taskDigest(input.tasks),
    harnessDigest: harnessDigest(),
    reps: input.reps,
    timeoutS: input.timeoutS,
    thinking: input.thinking,
    prices: input.prices,
    pricesDigest: pricesDigest(input.prices),
  };
}

export function resumeKey(row: ResumeRow): string {
  const planner = row.arm === 'handoff' ? (row.planner_model ?? '') : '';
  return `${row.task_id}\0${row.arm}\0${planner}\0${row.model}\0${row.rep}`;
}

export function identityConflicts(
  existing: ExperimentIdentity,
  next: ExperimentIdentity,
): string[] {
  const reasons: string[] = [];
  const check = <K extends keyof ExperimentIdentity>(key: K, label: string) => {
    if (JSON.stringify(existing[key]) !== JSON.stringify(next[key])) {
      reasons.push(
        `${label} changed (recorded ${JSON.stringify(existing[key])}, requested ${JSON.stringify(next[key])})`,
      );
    }
  };
  check('arms', 'arms');
  check('planner', 'planner');
  check('executors', 'executors');
  check('singleModels', 'singleModels');
  check('taskIds', 'task set');
  check('taskDigest', 'task/oracle digest');
  check('harnessDigest', 'harness digest');
  check('reps', 'reps');
  check('timeoutS', 'timeout-s');
  check('thinking', 'thinking');
  check('pricesDigest', 'prices');
  return reasons;
}

export function loadManifest(outDir: string): ExperimentIdentity | null {
  const path = join(outDir, EXPERIMENT_MANIFEST);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as ExperimentIdentity;
}

export function saveManifest(outDir: string, identity: ExperimentIdentity): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, EXPERIMENT_MANIFEST), `${JSON.stringify(identity, null, 2)}\n`);
}

export function readResultRows(path: string): ResumeRow[] {
  if (!existsSync(path)) return [];
  const rows: ResumeRow[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    rows.push(JSON.parse(line) as ResumeRow);
  }
  return rows;
}

export function diagnoseIncompatibleRows(
  rows: readonly ResumeRow[],
  identity: ExperimentIdentity,
): string[] {
  const reasons: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.arm !== 'single' && row.arm !== 'handoff') {
      reasons.push(`row ${index}: unknown arm ${JSON.stringify(row.arm)}`);
      continue;
    }
    if (typeof row.task_id !== 'string' || typeof row.model !== 'string') {
      reasons.push(`row ${index}: missing task_id or model`);
      continue;
    }
    if (!Number.isInteger(row.rep)) {
      reasons.push(`row ${index}: missing integer rep`);
      continue;
    }
    if (!('planner_model' in row)) {
      reasons.push(
        `row ${index}: missing planner_model identity field; refuse resume of pre-identity results`,
      );
      continue;
    }
    if (row.arm === 'handoff') {
      if (row.planner_model === null || row.planner_model === '') {
        reasons.push(`row ${index}: handoff row has empty planner_model`);
      } else if (identity.planner !== null && row.planner_model !== identity.planner) {
        reasons.push(
          `row ${index}: planner_model ${row.planner_model} does not match experiment planner ${identity.planner}`,
        );
      }
    }
  }
  return reasons;
}

export function selectTasks(taskIds: string[]): BenchTask[] {
  if (taskIds.length === 0) return [...CAIRN_BENCH_TASKS];
  const known = new Map(CAIRN_BENCH_TASKS.map((task) => [task.id, task]));
  const selected: BenchTask[] = [];
  for (const id of taskIds) {
    const task = known.get(id);
    if (task === undefined) throw new Error(`unknown task '${id}'`);
    selected.push(task);
  }
  return selected;
}
