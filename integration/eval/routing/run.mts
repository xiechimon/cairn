#!/usr/bin/env -S pnpm exec tsx
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BenchEndpoint,
  type RoutingArm,
  type RoutingRunRow,
  runRoutingRun,
} from './driver.mts';
import {
  buildExperimentIdentity,
  diagnoseIncompatibleRows,
  EXPERIMENT_MANIFEST,
  type ExperimentIdentity,
  identityConflicts,
  loadManifest,
  type PriceRates,
  RESULTS_JSONL,
  readResultRows,
  resumeKey,
  saveManifest,
  selectTasks,
} from './experiment.mts';
import { renderReport } from './report.mts';

export interface RoutingCliArgs {
  arms: RoutingArm[];
  planner: string | null;
  executors: string[];
  singleModels: string[];
  reps: number;
  tasks: string[];
  limit: number;
  out: string;
  prices: Record<string, PriceRates> | null;
  relayUrl: string | null;
  relayKey: string | null;
  timeoutS: number;
  thinking: string | null;
  reportOnly: boolean;
}

function usage(): void {
  console.error(`usage: pnpm exec tsx integration/eval/routing/run.mts [options]

options:
  --arms <list>          comma list from single,handoff (default single,handoff)
  --planner <model>      strong planning model; required for the handoff arm
  --executors <list>     comma list of executor models for the handoff arm
  --single-models <list> models for the single arm (default: the planner)
  --reps <n>             repeats per task and model (default 1)
  --tasks <list>         bench task ids (default: all)
  --limit <n>            run at most n tasks (default: all)
  --out <dir>            output directory (default integration/eval/routing/results/baseline)
  --prices <file>        JSON map of model id to per-million USD rates
  --relay-url <url>      OpenAI-compatible base URL (or CAIRN_EVAL_RELAY_URL)
  --relay-key <key>      API key (or CAIRN_EVAL_RELAY_KEY)
  --timeout-s <n>        per-session timeout seconds (default 900)
  --thinking <level>     optional thinking level
  --report-only          rebuild report.md from persisted experiment.json + results.jsonl
`);
}

export function parseArgs(argv: string[]): RoutingCliArgs {
  const a: RoutingCliArgs = {
    arms: ['single', 'handoff'],
    planner: null,
    executors: [],
    singleModels: [],
    reps: 1,
    tasks: [],
    limit: Number.POSITIVE_INFINITY,
    out: 'integration/eval/routing/results/baseline',
    prices: null,
    relayUrl: null,
    relayKey: null,
    timeoutS: 900,
    thinking: null,
    reportOnly: false,
  };
  const val = (i: number): string => {
    const v = argv[i];
    if (v === undefined) {
      console.error(`missing value for ${argv[i - 1]}`);
      usage();
      process.exit(2);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--arms')
      a.arms = val(++i)
        .split(',')
        .filter((s) => s !== '') as RoutingArm[];
    else if (k === '--planner') a.planner = val(++i);
    else if (k === '--executors')
      a.executors = val(++i)
        .split(',')
        .filter((s) => s !== '');
    else if (k === '--single-models')
      a.singleModels = val(++i)
        .split(',')
        .filter((s) => s !== '');
    else if (k === '--reps') a.reps = Number(val(++i));
    else if (k === '--tasks')
      a.tasks = val(++i)
        .split(',')
        .filter((s) => s !== '');
    else if (k === '--limit') a.limit = Number(val(++i));
    else if (k === '--out') a.out = val(++i);
    else if (k === '--prices') {
      a.prices = JSON.parse(readFileSync(val(++i), 'utf8')) as Record<string, PriceRates>;
    } else if (k === '--relay-url') a.relayUrl = val(++i);
    else if (k === '--relay-key') a.relayKey = val(++i);
    else if (k === '--timeout-s') a.timeoutS = Number(val(++i));
    else if (k === '--thinking') a.thinking = val(++i);
    else if (k === '--report-only') a.reportOnly = true;
    else if (k === '-h' || k === '--help') {
      usage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${k}`);
      usage();
      process.exit(2);
    }
  }
  return a;
}

export function resolveModels(args: RoutingCliArgs): {
  singleModels: string[];
  planner: string | null;
} {
  for (const arm of args.arms) {
    if (arm !== 'single' && arm !== 'handoff') {
      throw new Error(`unknown arm '${arm}'`);
    }
  }
  const wantsHandoff = args.arms.includes('handoff');
  if (wantsHandoff && (args.planner === null || args.planner === '')) {
    throw new Error('the handoff arm requires --planner');
  }
  if (wantsHandoff && args.executors.length === 0) {
    throw new Error('the handoff arm requires --executors');
  }
  const singleModels =
    args.singleModels.length > 0 ? args.singleModels : args.planner !== null ? [args.planner] : [];
  if (args.arms.includes('single') && singleModels[0] === undefined) {
    throw new Error('the single arm requires --planner or --single-models');
  }
  if (
    !Number.isInteger(args.reps) ||
    args.reps < 1 ||
    !Number.isFinite(args.timeoutS) ||
    args.timeoutS <= 0
  ) {
    throw new Error('--reps and --timeout-s must be positive numbers');
  }
  return { singleModels, planner: args.planner };
}

export function prepareExperiment(args: RoutingCliArgs): {
  identity: ExperimentIdentity;
  tasks: ReturnType<typeof selectTasks>;
  singleModels: string[];
} {
  const { singleModels, planner } = resolveModels(args);
  let tasks = selectTasks(args.tasks);
  tasks = tasks.slice(0, Number.isFinite(args.limit) ? args.limit : tasks.length);
  const identity = buildExperimentIdentity({
    arms: args.arms,
    planner,
    executors: args.executors,
    singleModels,
    tasks,
    reps: args.reps,
    timeoutS: args.timeoutS,
    thinking: args.thinking,
    prices: args.prices,
  });
  return { identity, tasks, singleModels };
}

export function assertResumeAllowed(
  outDir: string,
  next: ExperimentIdentity,
): { existing: ExperimentIdentity | null; done: Set<string> } {
  const resultsPath = join(outDir, RESULTS_JSONL);
  const existing = loadManifest(outDir);
  const rows = readResultRows(resultsPath);
  if (existing === null && rows.length > 0) {
    throw new Error(
      `refusing resume: ${RESULTS_JSONL} exists without ${EXPERIMENT_MANIFEST}; delete the output directory or restore a compatible manifest`,
    );
  }
  if (existing !== null) {
    const conflicts = identityConflicts(existing, next);
    if (conflicts.length > 0) {
      throw new Error(
        `refusing incompatible resume before any model call:\n- ${conflicts.join('\n- ')}`,
      );
    }
    const bad = diagnoseIncompatibleRows(rows, existing);
    if (bad.length > 0) {
      throw new Error(`refusing resume of incompatible result rows:\n- ${bad.join('\n- ')}`);
    }
  }
  return {
    existing,
    done: new Set(rows.map((row) => resumeKey(row))),
  };
}

export function writeRoutingReport(
  outDir: string,
  identity: ExperimentIdentity,
  generatedAt = new Date().toISOString(),
): string {
  const resultsPath = join(outDir, RESULTS_JSONL);
  const raw = existsSync(resultsPath)
    ? readFileSync(resultsPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as RoutingRunRow)
    : [];
  const report = renderReport(raw, identity, { generatedAt });
  const reportPath = join(outDir, 'report.md');
  writeFileSync(reportPath, report);
  return reportPath;
}

export async function runExperiment(args: RoutingCliArgs): Promise<{
  planned: number;
  ran: number;
  reportPath: string;
}> {
  if (args.reportOnly) {
    const existing = loadManifest(args.out);
    if (existing === null) {
      throw new Error(
        `--report-only requires ${EXPERIMENT_MANIFEST} in ${args.out}; refusing to relabel from CLI arguments`,
      );
    }
    const rows = readResultRows(join(args.out, RESULTS_JSONL));
    const bad = diagnoseIncompatibleRows(rows, existing);
    if (bad.length > 0) {
      throw new Error(`refusing report-only on incompatible rows:\n- ${bad.join('\n- ')}`);
    }
    const reportPath = writeRoutingReport(args.out, existing);
    return { planned: 0, ran: 0, reportPath };
  }

  const { identity, tasks, singleModels } = prepareExperiment(args);
  const { done } = assertResumeAllowed(args.out, identity);
  if (!existsSync(join(args.out, EXPERIMENT_MANIFEST))) saveManifest(args.out, identity);

  const relayUrl = args.relayUrl ?? process.env.CAIRN_EVAL_RELAY_URL ?? null;
  const relayKey = args.relayKey ?? process.env.CAIRN_EVAL_RELAY_KEY ?? null;
  if (relayUrl === null || relayUrl === '' || relayKey === null || relayKey === '') {
    throw new Error(
      'relay endpoint missing: pass --relay-url/--relay-key or set CAIRN_EVAL_RELAY_URL/CAIRN_EVAL_RELAY_KEY',
    );
  }
  const endpoint: BenchEndpoint = { baseUrl: relayUrl, apiKey: relayKey };
  mkdirSync(args.out, { recursive: true });
  const agentDir = join(args.out, 'pi-agent');
  const sessionDir = join(args.out, 'pi-sessions');
  const workdirRoot = mkdtempSync(join(tmpdir(), 'cairn-routing-'));
  const models = [
    ...new Set([
      ...singleModels,
      ...(args.arms.includes('handoff') ? [identity.planner ?? '', ...args.executors] : []),
    ]),
  ].filter((m) => m !== '');

  const planned: { task: (typeof tasks)[number]; arm: RoutingArm; model: string; rep: number }[] =
    [];
  for (const arm of args.arms) {
    const armModels = arm === 'single' ? singleModels : args.executors;
    for (const model of armModels) {
      for (const task of tasks) {
        for (let rep = 0; rep < args.reps; rep++) {
          const key = resumeKey({
            task_id: task.id,
            arm,
            model,
            planner_model: arm === 'handoff' ? identity.planner : null,
            rep,
          });
          if (done.has(key)) continue;
          planned.push({ task, arm, model, rep });
        }
      }
    }
  }
  console.error(`[routing] ${planned.length} run(s) to go on ${tasks.length} task(s)`);

  const resultsPath = join(args.out, RESULTS_JSONL);
  let ran = 0;
  for (const job of planned) {
    let row: RoutingRunRow;
    try {
      row = await runRoutingRun({
        task: job.task,
        arm: job.arm,
        modelId: job.model,
        rep: job.rep,
        plannerModelId: job.arm === 'handoff' ? (identity.planner ?? undefined) : undefined,
        endpoint,
        models,
        agentDir,
        sessionDir,
        workdir: join(workdirRoot, `${job.task.id}-${job.arm}-${job.model}-${job.rep}`),
        timeoutMs: args.timeoutS * 1000,
        ...(args.thinking !== null ? { thinkingLevel: args.thinking } : {}),
      });
    } catch (err) {
      row = {
        task_id: job.task.id,
        arm: job.arm,
        model: job.model,
        rep: job.rep,
        planner_model: job.arm === 'handoff' ? identity.planner : null,
        status: 'error',
        oracle_pass: null,
        planner_boundary: { executions: [], violations: [] },
        executor_boundary: { executions: [], violations: [] },
        planner_violations: [],
        violations: [],
        wrapped_implementations: [],
        usage: null,
        wall_ms: null,
        planner_usage: null,
        planner_wall_ms: null,
        plan_chars: null,
        stop_reason: 'error',
        error: `runner crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    ran += 1;
    console.error(
      `[routing] ${job.task.id} ${job.arm} ${job.model} rep${job.rep}: ${row.status}${row.why !== undefined ? ` (${row.why})` : ''}`,
    );
  }
  const reportPath = writeRoutingReport(args.out, identity);
  console.error(`[routing] report: ${reportPath}`);
  return { planned: planned.length, ran, reportPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    await runExperiment(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
