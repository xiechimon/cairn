import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openExperimentClient } from '@cairn/shared/langfuse';
import { runLaneTask } from './harness/lane.js';
import type { LaneTask, RuntimeTask, SuiteTask, TurnRecord } from './harness/types.js';
import { activateInServer, deactivateInServer, runRuntimeTurn } from './harness/world.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  arm: string;
  examDir: string;
  out: string;
  offline: boolean;
  requireLangfuse: boolean;
  only?: string;
}

function args(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback = ''): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  return {
    arm: get('arm', 'candidate'),
    examDir: get('exam', HERE),
    out: get('out', join(HERE, `results-${Date.now()}.json`)),
    offline: argv.includes('--offline'),
    requireLangfuse: argv.includes('--require-langfuse'),
    only: get('only') || undefined,
  };
}

type TaskParser = { parse(input: unknown): SuiteTask };

function loadTasks(examDir: string, suiteTask: TaskParser): SuiteTask[] {
  const tasks: SuiteTask[] = [];
  const runtimeDir = join(examDir, 'tasks', 'runtime');
  for (const file of readdirSync(runtimeDir).filter((f) => f.endsWith('.json'))) {
    tasks.push(suiteTask.parse(JSON.parse(readFileSync(join(runtimeDir, file), 'utf8'))));
  }
  const laneDir = join(examDir, 'tasks', 'lane');
  for (const dir of readdirSync(laneDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(laneDir, dir.name, 'task.json');
    try {
      tasks.push(suiteTask.parse(JSON.parse(readFileSync(file, 'utf8'))));
    } catch {}
  }
  const canaryDir = join(examDir, 'tasks', 'canary');
  for (const file of readdirSync(canaryDir).filter((f) => f.endsWith('.json'))) {
    tasks.push(suiteTask.parse(JSON.parse(readFileSync(join(canaryDir, file), 'utf8'))));
  }
  return tasks;
}

interface ItemResult {
  caseId: string;
  kind: string;
  repeat: number;
  scores: Record<string, number>;
  comments: Record<string, string>;
  incomplete?: string;
  gate: boolean;
}

interface ExamModules {
  suiteTask: TaskParser;
  scoreRuntime: typeof import('./scorers/runtime-checks.js').scoreRuntime;
  scoreCanary: typeof import('./scorers/runtime-checks.js').scoreCanary;
  scoreLane: typeof import('./scorers/lane-checks.js').scoreLane;
}

async function loadExam(examDir: string): Promise<ExamModules> {
  const url = (rel: string) => pathToFileURL(join(examDir, rel)).href;
  const typesUrl = url('harness/types.ts');
  const runtimeUrl = url('scorers/runtime-checks.ts');
  const laneUrl = url('scorers/lane-checks.ts');
  const types = (await import(typesUrl)) as typeof import('./harness/types.js');
  const runtime = (await import(runtimeUrl)) as typeof import('./scorers/runtime-checks.js');
  const lane = (await import(laneUrl)) as typeof import('./scorers/lane-checks.js');
  return {
    suiteTask: types.suiteTask as TaskParser,
    scoreRuntime: runtime.scoreRuntime,
    scoreCanary: runtime.scoreCanary,
    scoreLane: lane.scoreLane,
  };
}

async function main() {
  const a = args();
  const suite = JSON.parse(readFileSync(join(a.examDir, 'suite.json'), 'utf8')) as {
    dataset: string;
    repeats: Record<string, number>;
    expectedCounts: Record<string, number>;
    devinBudget: { maxSessionsPerRun: number };
  };
  const exam = await loadExam(a.examDir);
  const tasks = loadTasks(a.examDir, exam.suiteTask).filter(
    (t) => a.only === undefined || t.kind === a.only,
  );
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.kind] = (acc[t.kind] ?? 0) + 1;
    return acc;
  }, {});
  if (a.only === undefined) {
    for (const [kind, want] of Object.entries(suite.expectedCounts)) {
      const have = counts[kind] ?? 0;
      if (have !== want)
        throw new Error(`eval: suite expects ${want} ${kind} tasks, found ${have}`);
    }
  }
  const results: ItemResult[] = [];
  const metadata = { arm: a.arm, examDir: a.examDir };

  const items: { input: SuiteTask; expectedOutput?: unknown; metadata: Record<string, unknown> }[] =
    [];
  for (const task of tasks) {
    const k = suite.repeats[task.kind] ?? 1;
    for (let repeat = 0; repeat < k; repeat += 1) {
      items.push({
        input: task,
        expectedOutput: 'expected' in task ? task.expected : undefined,
        metadata: { caseId: task.id, kind: task.kind, repeat },
      });
    }
  }

  const hasLangfuse =
    !a.offline &&
    process.env.LANGFUSE_PUBLIC_KEY !== undefined &&
    process.env.LANGFUSE_SECRET_KEY !== undefined;
  if (a.requireLangfuse && !hasLangfuse)
    throw new Error('eval: --require-langfuse set but LANGFUSE keys are absent');

  const devinCap = Number(process.env.EVAL_MAX_DEVIN_RUNS ?? suite.devinBudget.maxSessionsPerRun);
  let devinRuns = 0;
  const execute = async (item: (typeof items)[number]): Promise<TurnRecord> => {
    const task = item.input;
    if (task.kind === 'lane') {
      devinRuns += 1;
      if (devinRuns > devinCap)
        return { caseId: task.id, kind: 'lane', incomplete: `devin budget ${devinCap} exceeded` };
      return runLaneTask(task as LaneTask, a.examDir);
    }
    return runRuntimeTurn(task as RuntimeTask);
  };

  const evaluate = (task: SuiteTask, record: TurnRecord) => {
    if (task.kind === 'lane') return exam.scoreLane(task as LaneTask, record);
    if (task.kind === 'canary') return exam.scoreCanary(record);
    return exam.scoreRuntime(task as RuntimeTask, record);
  };

  const collect = (item: (typeof items)[number], record: TurnRecord) => {
    const checks = evaluate(item.input, record);
    const scores: Record<string, number> = {};
    const comments: Record<string, string> = {};
    for (const check of checks) {
      scores[check.name] = check.value;
      if (check.comment !== undefined) comments[check.name] = check.comment;
    }
    results.push({
      caseId: item.input.id,
      kind: item.input.kind,
      repeat: Number(item.metadata.repeat),
      scores,
      comments,
      incomplete: record.incomplete,
      gate: item.input.gate,
    });
  };

  let lf: ReturnType<typeof openExperimentClient> | undefined;
  if (!hasLangfuse) {
    activateInServer();
    try {
      for (const item of items) {
        collect(item, await execute(item));
      }
    } finally {
      deactivateInServer();
    }
    console.warn('eval: LANGFUSE keys absent or --offline; results written locally only');
  } else {
    const experiment = openExperimentClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
      secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    });
    lf = experiment;
    activateInServer();
    try {
      const run = await experiment.client.experiment.run({
        name: `eval-${a.arm}`,
        description: `cairn eval suite arm=${a.arm}`,
        metadata,
        data: items,
        task: async (item) => execute(item as (typeof items)[number]),
        evaluators: [
          async ({ input, output }) => {
            const task = input as SuiteTask;
            const record = output as TurnRecord;
            return evaluate(task, record).map((check) => ({
              name: check.name,
              value: check.value,
              comment: check.comment,
            }));
          },
        ],
        maxConcurrency: 1,
      });
      const itemResults = (run as { itemResults?: { item: unknown; output: unknown }[] })
        .itemResults;
      if (itemResults === undefined) {
        for (const item of items) collect(item, await execute(item));
      } else {
        for (const r of itemResults) {
          const item = r.item as (typeof items)[number];
          collect(item, r.output as TurnRecord);
        }
      }
    } finally {
      deactivateInServer();
    }
  }

  writeFileSync(
    a.out,
    `${JSON.stringify({ arm: a.arm, counts, suite: suite.dataset, items: results }, null, 2)}\n`,
  );
  if (lf !== undefined) await lf.close();
  const incomplete = results.filter((r) => r.incomplete !== undefined).length;
  console.log(`eval[${a.arm}]: ${results.length} trials, ${incomplete} incomplete -> ${a.out}`);
}

await main();
