#!/usr/bin/env -S pnpm exec tsx
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BenchTask, CAIRN_BENCH_TASKS, seedWorkdir } from './bench.mts';
import { type BenchEndpoint, type BenchSessionEvidence, runBenchSession } from './driver.mts';
import {
  aggregateByModel,
  changedFilesIn,
  executorPrompt,
  gradeTaskRun,
  type PriceRates,
  plannerPrompt,
  type RoutingArm,
  type RoutingRunRow,
  renderReport,
  runCostUsd,
  runOracle,
} from './grade.mts';

export async function runRoutingRun(opts: {
  task: BenchTask;
  arm: RoutingArm;
  modelId: string;
  rep: number;
  plannerModelId?: string;
  endpoint: BenchEndpoint;
  models: readonly string[];
  agentDir: string;
  sessionDir: string;
  workdir: string;
  prices?: Record<string, PriceRates>;
  thinkingLevel?: string;
  timeoutMs: number;
}): Promise<RoutingRunRow> {
  rmSync(opts.workdir, { recursive: true, force: true });
  seedWorkdir(opts.workdir, opts.task);
  const plannerWorkdir = `${opts.workdir}.planner`;
  rmSync(plannerWorkdir, { recursive: true, force: true });
  seedWorkdir(plannerWorkdir, opts.task);
  const models = [
    ...new Set([
      ...opts.models,
      opts.modelId,
      ...(opts.plannerModelId ? [opts.plannerModelId] : []),
    ]),
  ];
  const sessionBase = {
    endpoint: opts.endpoint,
    models,
    agentDir: opts.agentDir,
    sessionDir: opts.sessionDir,
    timeoutMs: opts.timeoutMs,
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
  };

  let plan: string | null = null;
  let plannerSession: BenchSessionEvidence | null = null;
  let plannerUsage = null;
  let plannerCost = null;
  let plannerWall = null;
  if (opts.arm === 'handoff') {
    if (opts.plannerModelId === undefined)
      throw new Error('the handoff arm requires plannerModelId');
    const planner = await runBenchSession({
      ...sessionBase,
      workdir: plannerWorkdir,
      modelId: opts.plannerModelId,
      prompt: plannerPrompt(opts.task),
    });
    plannerSession = planner;
    plannerUsage = planner.usage;
    plannerCost = runCostUsd(planner.usage, opts.prices?.[opts.plannerModelId]);
    plannerWall = planner.wallMs;
    plan = planner.text;
    if (planner.stopReason === 'error') {
      return {
        task_id: opts.task.id,
        arm: opts.arm,
        model: opts.modelId,
        planner_model: opts.plannerModelId,
        rep: opts.rep,
        status: 'error',
        oracle_pass: null,
        out_of_workdir_reads: [],
        wrapped_implementations: [],
        usage: null,
        cost_usd: null,
        wall_ms: null,
        planner_usage: plannerUsage,
        planner_cost_usd: plannerCost,
        planner_wall_ms: plannerWall,
        plan_chars: plan.length,
        stop_reason: planner.stopReason,
        error: `planner session error: ${planner.error ?? 'unknown'}`,
      };
    }
  }

  const executor = await runBenchSession({
    ...sessionBase,
    workdir: opts.workdir,
    modelId: opts.modelId,
    prompt: executorPrompt(opts.task, plan),
  });
  const costUsd = runCostUsd(executor.usage, opts.prices?.[opts.modelId]);
  const base = {
    task_id: opts.task.id,
    arm: opts.arm,
    model: opts.modelId,
    rep: opts.rep,
    planner_model: opts.plannerModelId ?? null,
    usage: executor.usage,
    cost_usd: costUsd,
    wall_ms: executor.wallMs,
    planner_usage: plannerUsage,
    planner_cost_usd: plannerCost,
    planner_wall_ms: plannerWall,
    plan_chars: plan === null ? null : plan.length,
    stop_reason: executor.stopReason,
  };
  if (executor.stopReason === 'error') {
    return {
      ...base,
      status: 'error',
      oracle_pass: null,
      out_of_workdir_reads: [],
      wrapped_implementations: [],
      error: `executor session error: ${executor.error ?? 'unknown'}`,
    };
  }
  if (opts.arm === 'handoff' && (plan === null || plan === '')) {
    return {
      ...base,
      status: 'error',
      oracle_pass: null,
      out_of_workdir_reads: [],
      wrapped_implementations: [],
      error: 'planner produced no plan text',
    };
  }
  const changed = changedFilesIn(opts.workdir, opts.task);
  const oracle = runOracle(opts.workdir, opts.task);
  const grade = gradeTaskRun(opts.task, {
    oraclePass: oracle.pass,
    sessions: [
      { toolCalls: executor.toolCalls, workdir: opts.workdir },
      ...(plannerSession !== null
        ? [{ toolCalls: plannerSession.toolCalls, workdir: plannerWorkdir }]
        : []),
    ],
    changed,
  });
  const why = executor.stopReason === 'timeout' ? `executor timed out; ${grade.why}` : grade.why;
  return {
    ...base,
    status: grade.status,
    oracle_pass: oracle.pass,
    out_of_workdir_reads: grade.outOfDirReads,
    wrapped_implementations: grade.wrapped,
    why,
    ...(oracle.pass ? {} : { oracle_output: oracle.output.slice(0, 2000) }),
  };
}

function usage(): void {
  console.error(`usage: pnpm exec tsx integration/eval/routing/run.mts [options]

options:
  --arms <list>          comma list from single,handoff (default single,handoff)
  --planner <model>      strong planning model; required for the handoff arm, default single-arm model
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
  --report-only          rebuild report.md from results.jsonl and exit
`);
}

interface Args {
  arms: RoutingArm[];
  planner?: string;
  executors: string[];
  singleModels: string[];
  reps: number;
  tasks: string[];
  limit: number;
  out: string;
  prices?: Record<string, PriceRates>;
  relayUrl?: string;
  relayKey?: string;
  timeoutS: number;
  thinking?: string;
  reportOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    arms: ['single', 'handoff'],
    executors: [],
    singleModels: [],
    reps: 1,
    tasks: [],
    limit: Number.POSITIVE_INFINITY,
    out: 'integration/eval/routing/results/baseline',
    timeoutS: 900,
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
      const raw = readFileSync(val(++i), 'utf8');
      a.prices = JSON.parse(raw) as Record<string, PriceRates>;
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

function readRows(path: string): RoutingRunRow[] {
  if (!existsSync(path)) return [];
  const rows: RoutingRunRow[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    rows.push(JSON.parse(line) as RoutingRunRow);
  }
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const arm of args.arms) {
    if (arm !== 'single' && arm !== 'handoff') {
      console.error(`unknown arm '${arm}'`);
      process.exit(2);
    }
  }
  const wantsHandoff = args.arms.includes('handoff');
  if (wantsHandoff && args.planner === undefined) {
    console.error('the handoff arm requires --planner');
    process.exit(2);
  }
  if (wantsHandoff && args.executors.length === 0) {
    console.error('the handoff arm requires --executors');
    process.exit(2);
  }
  const singleModels =
    args.singleModels.length > 0
      ? args.singleModels
      : args.planner !== undefined
        ? [args.planner]
        : [];
  if (args.arms.includes('single') && singleModels[0] === undefined) {
    console.error('the single arm requires --planner or --single-models');
    process.exit(2);
  }
  if (
    !Number.isInteger(args.reps) ||
    args.reps < 1 ||
    !Number.isFinite(args.timeoutS) ||
    args.timeoutS <= 0
  ) {
    console.error('--reps and --timeout-s must be positive numbers');
    process.exit(2);
  }

  let tasks = CAIRN_BENCH_TASKS.filter(
    (task) => args.tasks.length === 0 || args.tasks.includes(task.id),
  );
  if (args.tasks.length > 0) {
    const known = new Set(CAIRN_BENCH_TASKS.map((task) => task.id));
    for (const id of args.tasks) {
      if (!known.has(id)) {
        console.error(`unknown task '${id}'`);
        process.exit(2);
      }
    }
  }
  tasks = tasks.slice(0, args.limit);

  const outDir = args.out;
  mkdirSync(outDir, { recursive: true });
  const resultsPath = join(outDir, 'results.jsonl');

  if (args.reportOnly) {
    writeReport(resultsPath, outDir, tasks.length, args.planner ?? null);
    return;
  }

  const relayUrl = args.relayUrl ?? process.env.CAIRN_EVAL_RELAY_URL;
  const relayKey = args.relayKey ?? process.env.CAIRN_EVAL_RELAY_KEY;
  if (relayUrl === undefined || relayUrl === '' || relayKey === undefined || relayKey === '') {
    console.error(
      'relay endpoint missing: pass --relay-url/--relay-key or set CAIRN_EVAL_RELAY_URL/CAIRN_EVAL_RELAY_KEY',
    );
    process.exit(2);
  }
  const endpoint: BenchEndpoint = { baseUrl: relayUrl, apiKey: relayKey };
  const agentDir = join(outDir, 'pi-agent');
  const sessionDir = join(outDir, 'pi-sessions');
  const workdirRoot = mkdtempSync(join(tmpdir(), 'cairn-routing-'));
  console.error(`[routing] executor workdirs: ${workdirRoot}`);
  const models = [
    ...new Set([...singleModels, ...(wantsHandoff ? [args.planner ?? '', ...args.executors] : [])]),
  ].filter((m) => m !== '');

  const done = new Set(
    readRows(resultsPath).map((row) => `${row.task_id}|${row.arm}|${row.model}|${row.rep}`),
  );
  const planned: { task: BenchTask; arm: RoutingArm; model: string; rep: number }[] = [];
  for (const arm of args.arms) {
    const armModels = arm === 'single' ? singleModels : args.executors;
    for (const model of armModels) {
      for (const task of tasks) {
        for (let rep = 0; rep < args.reps; rep++) {
          if (done.has(`${task.id}|${arm}|${model}|${rep}`)) continue;
          planned.push({ task, arm, model, rep });
        }
      }
    }
  }
  console.error(`[routing] ${planned.length} run(s) to go on ${tasks.length} task(s)`);

  for (const job of planned) {
    let row: RoutingRunRow;
    try {
      row = await runRoutingRun({
        task: job.task,
        arm: job.arm,
        modelId: job.model,
        rep: job.rep,
        plannerModelId: job.arm === 'handoff' ? args.planner : undefined,
        endpoint,
        models,
        agentDir,
        sessionDir,
        workdir: join(workdirRoot, `${job.task.id}-${job.arm}-${job.model}-${job.rep}`),
        ...(args.prices !== undefined ? { prices: args.prices } : {}),
        ...(args.thinking !== undefined ? { thinkingLevel: args.thinking } : {}),
        timeoutMs: args.timeoutS * 1000,
      });
    } catch (err) {
      row = {
        task_id: job.task.id,
        arm: job.arm,
        model: job.model,
        rep: job.rep,
        planner_model: job.arm === 'handoff' ? (args.planner ?? null) : null,
        status: 'error',
        oracle_pass: null,
        out_of_workdir_reads: [],
        wrapped_implementations: [],
        usage: null,
        cost_usd: null,
        wall_ms: null,
        stop_reason: 'error',
        error: `runner crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    console.error(
      `[routing] ${job.task.id} ${job.arm} ${job.model} rep${job.rep}: ${row.status}${row.why !== undefined ? ` (${row.why})` : ''}`,
    );
  }
  writeReport(resultsPath, outDir, tasks.length, args.planner ?? null);
  console.error(`[routing] report: ${join(outDir, 'report.md')}`);
}

function writeReport(
  resultsPath: string,
  outDir: string,
  benchSize: number,
  planner: string | null,
): void {
  const rows = readRows(resultsPath);
  const report = renderReport(rows, {
    benchSize,
    generatedAt: new Date().toISOString(),
    plannerModel: planner,
  });
  writeFileSync(join(outDir, 'report.md'), report);
  const aggregates = aggregateByModel(rows);
  if (aggregates.length > 0) {
    console.error('[routing] per-model summary:');
    for (const agg of aggregates) {
      console.error(
        `  ${agg.arm}/${agg.model}: ${agg.passes}/${agg.graded} pass, flagged ${agg.flagged}, errors ${agg.errors}`,
      );
    }
  }
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
