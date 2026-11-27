import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openExperimentClient } from '@cairn/shared/langfuse';
import { resolveDevinCap } from './harness/budget.js';
import { runLaneTask } from './harness/lane.js';
import type { LaneTask, RuntimeTask, SuiteTask, TurnRecord } from './harness/types.js';
import { activateInServer, deactivateInServer, runRuntimeTurn } from './harness/world.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LANGFUSE_EXIT_CODE = 3;

interface Args {
  arm: string;
  examDir: string;
  out: string;
  offline: boolean;
  requireLangfuse: boolean;
  only?: string;
}

function parseArgs(argv: string[]): Args {
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
  durationMs?: number;
  diagnostics?: string;
  traceId?: string;
  traceUrl?: string;
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

export function buildTraceUrl(
  baseUrl: string,
  projectId: string | undefined,
  traceId: string | undefined,
): string | undefined {
  if (!projectId || !traceId) return undefined;
  return `${baseUrl.replace(/\/$/, '')}/project/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(traceId)}`;
}

async function resolveProjectId(
  baseUrl: string,
  experimentUrl: string | undefined,
  publicKey: string,
  secretKey: string,
): Promise<string | undefined> {
  if (experimentUrl) {
    const match = /\/project\/([^/?#]+)/.exec(experimentUrl);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  try {
    const auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/public/projects`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return undefined;
    const payload = (await res.json()) as { data?: { id?: string }[] };
    return payload.data?.[0]?.id;
  } catch {
    return undefined;
  }
}

export interface RunEvalDeps {
  openClient?: typeof openExperimentClient;
}

export async function runEval(
  argv: string[] = process.argv.slice(2),
  deps: RunEvalDeps = {},
): Promise<number> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const a = parseArgs(argv);
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim() ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim() ?? '';
  const baseUrlEnv = process.env.LANGFUSE_BASE_URL?.trim() ?? '';

  if (a.requireLangfuse && a.offline) {
    console.error('eval: --require-langfuse cannot be combined with --offline');
    return LANGFUSE_EXIT_CODE;
  }
  if (a.requireLangfuse && (!publicKey || !secretKey || !baseUrlEnv)) {
    console.error(
      'eval: --require-langfuse requires LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL',
    );
    return LANGFUSE_EXIT_CODE;
  }

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

  const hasLangfuse = !a.offline && publicKey !== '' && secretKey !== '';
  const baseUrl = baseUrlEnv || 'https://cloud.langfuse.com';
  const devinCap = resolveDevinCap(
    process.env.EVAL_MAX_DEVIN_RUNS,
    suite.devinBudget.maxSessionsPerRun,
  );
  let devinRuns = 0;
  const execute = async (item: (typeof items)[number]): Promise<TurnRecord> => {
    const t0 = Date.now();
    const task = item.input;
    if (task.kind === 'lane') {
      devinRuns += 1;
      if (devinRuns > devinCap) {
        return {
          caseId: task.id,
          kind: 'lane',
          durationMs: Date.now() - t0,
          incomplete: `devin budget ${devinCap} exceeded`,
        };
      }
      return runLaneTask(task as LaneTask, a.examDir);
    }
    const record = await runRuntimeTurn(task as RuntimeTask);
    return record.durationMs === undefined ? { ...record, durationMs: Date.now() - t0 } : record;
  };

  const evaluate = (task: SuiteTask, record: TurnRecord) => {
    if (task.kind === 'lane') return exam.scoreLane(task as LaneTask, record);
    if (task.kind === 'canary') return exam.scoreCanary(record);
    return exam.scoreRuntime(task as RuntimeTask, record);
  };

  const results: ItemResult[] = [];
  const collect = (
    item: (typeof items)[number],
    record: TurnRecord,
    traceId?: string,
    traceUrl?: string,
  ) => {
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
      ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      ...(record.diagnostics !== undefined ? { diagnostics: record.diagnostics } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(traceUrl !== undefined ? { traceUrl } : {}),
    });
  };

  const metadata = { arm: a.arm, examDir: a.examDir };
  let lf: ReturnType<typeof openExperimentClient> | undefined;
  let experimentId: string | undefined;
  let experimentUrl: string | undefined;
  let projectId: string | undefined;

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
    const openClient = deps.openClient ?? openExperimentClient;
    try {
      lf = openClient({ publicKey, secretKey, baseUrl });
    } catch (error) {
      console.error(
        `eval: Langfuse init failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return LANGFUSE_EXIT_CODE;
    }
    let itemResults: { item: unknown; output: unknown; traceId?: string }[] | undefined;
    activateInServer();
    try {
      const run = (await lf.client.experiment.run({
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
      })) as {
        experimentId?: string;
        experimentUrl?: string;
        itemResults?: { item: unknown; output: unknown; traceId?: string }[];
      };
      experimentId = run.experimentId;
      experimentUrl = run.experimentUrl;
      itemResults = run.itemResults;
    } catch (error) {
      console.error(
        `eval: Langfuse experiment failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await lf.close();
      } catch {}
      return LANGFUSE_EXIT_CODE;
    } finally {
      deactivateInServer();
    }
    if (itemResults === undefined || itemResults.length !== items.length) {
      console.error(
        `eval: Langfuse experiment.run returned ${itemResults?.length ?? 'undefined'} results for ${items.length} items`,
      );
      try {
        await lf.close();
      } catch {}
      return LANGFUSE_EXIT_CODE;
    }
    projectId = await resolveProjectId(baseUrl, experimentUrl, publicKey, secretKey);
    for (const r of itemResults) {
      const item = r.item as (typeof items)[number];
      const traceId = typeof r.traceId === 'string' && r.traceId ? r.traceId : undefined;
      collect(item, r.output as TurnRecord, traceId, buildTraceUrl(baseUrl, projectId, traceId));
    }
  }

  const finishedAt = new Date().toISOString();
  mkdirSync(dirname(resolve(a.out)), { recursive: true });
  writeFileSync(
    a.out,
    `${JSON.stringify(
      {
        arm: a.arm,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        counts,
        suite: suite.dataset,
        ...(hasLangfuse
          ? {
              langfuse: {
                baseUrl,
                ...(projectId !== undefined ? { projectId } : {}),
                ...(experimentId !== undefined ? { experimentId } : {}),
                ...(experimentUrl !== undefined ? { experimentUrl } : {}),
              },
            }
          : {}),
        items: results,
      },
      null,
      2,
    )}\n`,
  );

  if (lf !== undefined) {
    try {
      await lf.close();
    } catch (error) {
      console.error(
        `eval: Langfuse close failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return LANGFUSE_EXIT_CODE;
    }
  }

  const incomplete = results.filter((r) => r.incomplete !== undefined).length;
  console.log(`eval[${a.arm}]: ${results.length} trials, ${incomplete} incomplete -> ${a.out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEval();
}
