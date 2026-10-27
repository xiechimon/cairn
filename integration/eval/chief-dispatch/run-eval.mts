#!/usr/bin/env -S pnpm exec tsx
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHIEF_DISPATCH_HARNESS_PATHS } from '@cairn/shared';
import {
  isLearnCase,
  LEARN_ARMS,
  type LearnArm,
  type LearnCase,
  learnHeadlineFromRows,
} from '../learn/grade.mts';
import { runLearnCase } from '../learn/run.mts';
import {
  gradeMemoryCase,
  isMemoryCase,
  type MemoryCase,
  type MemoryRowLite,
} from '../memory-regression/grade.mts';
import { readMemoryRows, seedMemories } from '../memory-regression/seed.mts';
import { gradeRoutingCase, isRoutingCase, type RoutingCase } from '../project-routing/grade.mts';
import { seedRoutingProjects } from '../project-routing/seed.mts';
import { type Case, gradeCase, type RosterAgent } from './grade.mts';
import {
  buildHarnessEvalResult,
  decisionOkRate,
  parseResultsJsonl,
  traceDigest,
} from './harness-eval-result.mts';
import {
  bootStack,
  disposeLeftovers,
  driveTurn,
  REPO_ROOT,
  relayBaseUrl,
  relayKey,
  resolveFromRoot,
  type SeededWorld,
  type Stack,
  seedWorld,
  type TurnEvidence,
} from './stack.mts';

// --- fill these in ----------------------------------------------------------

let ARGS: ReturnType<typeof parseArgs>;
let ROSTER: RosterAgent[] = [];
let CHIEF_MODEL = 'glm-5.3';

const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'glm-5.3': { in: 1.4, out: 4.4, cacheRead: 0.26 },
  'kimi-k3': { in: 3.0, out: 15.0, cacheRead: 0.3 },
  'qwen3.8-max': { in: 2.0, out: 6.0, cacheRead: 0.25 },
  'deepseek-v4-pro': { in: 0.955, out: 1.911, cacheRead: 0.08 },
};

type EvalCase = Case | MemoryCase | RoutingCase | LearnCase;

async function loadCases(): Promise<EvalCase[]> {
  const d = JSON.parse(readFileSync(join(ARGS.flow, 'cases.json'), 'utf8')) as {
    roster: RosterAgent[];
    cases: EvalCase[];
  };
  ROSTER = d.roster;
  CHIEF_MODEL = ARGS.model ?? CHIEF_MODEL;
  return d.cases;
}

async function freshStack(
  input: Case | MemoryCase | RoutingCase,
): Promise<{ stack: Stack; world: SeededWorld; projectIds: Record<string, string> }> {
  const stack = await bootStack();
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: relayBaseUrl(),
      relayKey: relayKey(),
      roster: ROSTER,
      chiefModelId: CHIEF_MODEL,
    });
    if (isMemoryCase(input)) await seedMemories(stack.server, world, input);
    const projectIds = isRoutingCase(input)
      ? await seedRoutingProjects(stack, world)
      : { 'eval-project': world.projectId };
    return { stack, world, projectIds };
  } catch (e) {
    await stack.close();
    throw e;
  }
}

async function runCase(
  input: EvalCase,
  ctx: { timeoutS: number },
): Promise<{
  output: string;
  transcript: { role: string; content: string; name?: string }[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  evidence: TurnEvidence;
  truncated: boolean;
  agentIds: Record<string, string>;
  projectIds: Record<string, string>;
  memoryAfter: MemoryRowLite[];
  grade?: { grade: Record<string, number>; explanation: Record<string, string> };
}> {
  if (isLearnCase(input)) {
    const learned = await runLearnCase(input, {
      arm: ARGS.arm,
      roster: ROSTER,
      model: CHIEF_MODEL,
      timeoutMs: ctx.timeoutS > 0 ? ctx.timeoutS * 1000 : 300_000,
    });
    const truncated = learned.truncated;
    return {
      output: learned.output,
      transcript: buildTranscript(learned.evidence),
      model: learned.model,
      usage: learned.usage,
      stop_reason: learned.stop_reason,
      evidence: learned.evidence,
      truncated,
      agentIds: learned.agentIds,
      projectIds: {},
      memoryAfter: [],
      grade: learned.grade,
    };
  }
  const { stack, world, projectIds } = await freshStack(input);
  try {
    const timeoutMs = ctx.timeoutS > 0 ? ctx.timeoutS * 1000 : 300_000;
    const ev = await driveTurn(stack, input.prompt, { timeoutMs });
    const dead = (ev.usage.input === 0 && ev.usage.output === 0) || ev.stepStatus !== 'done';
    if (dead) {
      const e = new Error(
        `回合未正常完成：step=${ev.stepStatus} usage=${ev.usage.input}/${ev.usage.output} latency=${(ev.wallMs / 1000).toFixed(1)}s`,
      ) as Error & { failure_class?: string };
      e.failure_class = 'harness_error';
      throw e;
    }
    const truncated =
      ev.toolCalls.length === 0 && ev.assistantText === '' && ev.stepStatus === 'done';
    return {
      output: ev.assistantText,
      transcript: buildTranscript(ev),
      model: ev.model,
      usage: { input_tokens: ev.usage.input, output_tokens: ev.usage.output },
      stop_reason: truncated ? 'length' : ev.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      evidence: ev,
      truncated,
      agentIds: world.agentIds,
      projectIds,
      memoryAfter: readMemoryRows(stack.server, world.chiefAgentId),
      grade: undefined,
    };
  } finally {
    await stack.close();
  }
}

function buildTranscript(ev: TurnEvidence): { role: string; content: string; name?: string }[] {
  const turns: { role: string; content: string; name?: string }[] = [];
  for (const c of ev.toolCalls) {
    turns.push({ role: 'tool_call', name: c.name, content: JSON.stringify(c.arguments, null, 2) });
    turns.push({ role: 'tool_result', name: c.name, content: c.isError ? '(isError)' : '(ok)' });
  }
  if (ev.assistantText) turns.push({ role: 'assistant', content: ev.assistantText });
  turns.push({
    role: 'assistant',
    content:
      `[end state] step=${ev.stepStatus} · todos=${ev.createdTodoIds.length} · builds=${ev.buildRows.length} · ` +
      `模型=${ev.model ?? 'n/a'} · ${ev.usage.input}in/${ev.usage.output}out · ${(ev.wallMs / 1000).toFixed(1)}s`,
  });
  return turns;
}

function perfFrom(run: Awaited<ReturnType<typeof runCase>>): Record<string, number | string> {
  const p = PRICES[run.model ?? ''] ?? null;
  const u = run.evidence.usage;
  const cost = p ? (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead) / 1_000_000 : 0;
  return {
    status: run.truncated ? 'truncated' : 'ok',
    in_tokens: u.input,
    out_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    tool_calls: run.evidence.toolCalls.length,
    cost_usd: Number(cost.toFixed(6)),
    latency_s: Number((run.evidence.wallMs / 1000).toFixed(2)),
  };
}

// --- harness (you usually won't need to touch below this line) --------------

function parseArgs(argv: string[]) {
  const a = {
    flow: '.claude/hillclimb/flow',
    variant: 'baseline',
    model: undefined as string | undefined,
    reps: 1,
    concurrency: 4,
    timeoutS: 1800,
    approveHarness: false,
    writeVerify: undefined as string | undefined,
    patchDigest: undefined as string | undefined,
    arm: 'all' as LearnArm,
    caseIds: [] as string[],
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
    if (k === '--flow') a.flow = val(++i);
    else if (k === '--variant') a.variant = val(++i);
    else if (k === '--model') a.model = val(++i);
    else if (k === '--reps') a.reps = +val(++i);
    else if (k === '--concurrency') a.concurrency = +val(++i);
    else if (k === '--timeout-s') a.timeoutS = +val(++i);
    else if (k === '--approve-harness') a.approveHarness = true;
    else if (k === '--write-verify') a.writeVerify = val(++i);
    else if (k === '--patch-digest') a.patchDigest = val(++i);
    else if (k === '--arm') a.arm = val(++i) as LearnArm;
    else if (k === '--case') a.caseIds.push(val(++i));
    else if (k === '-h' || k === '--help') {
      usage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${k}`);
      usage();
      process.exit(2);
    }
  }
  if (!(LEARN_ARMS as readonly string[]).includes(a.arm)) {
    console.error(`--arm must be one of ${LEARN_ARMS.join(', ')}, got '${a.arm}'`);
    usage();
    process.exit(2);
  }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    console.error(`--variant must be 'baseline' or 'v<N>', got '${a.variant}'`);
    usage();
    process.exit(2);
  }
  if (
    !Number.isFinite(a.timeoutS) ||
    a.timeoutS < 0 ||
    a.timeoutS * 1000 > 2147483647 ||
    !Number.isInteger(a.reps) ||
    a.reps < 1 ||
    !Number.isInteger(a.concurrency) ||
    a.concurrency < 1
  ) {
    usage();
    process.exit(2);
  }
  return a;
}
function usage() {
  console.error(
    'usage: run-eval.mts --flow DIR --variant ID [--model ID] [--arm all|no-memory|correction|oracle|reflect] [--case ID] [--reps N] [--concurrency N] [--timeout-s N (0 = no ceiling)] [--approve-harness] [--write-verify PATH --patch-digest DIGEST]',
  );
}

function checkHarness(statePath: string, st: Record<string, unknown>, approve: boolean) {
  const self = fileURLToPath(import.meta.url);
  const declared = Array.isArray(st.harness_paths)
    ? st.harness_paths.filter((p): p is string => typeof p === 'string')
    : [];
  const listed = [...new Set([...CHIEF_DISPATCH_HARNESS_PATHS, ...declared])];
  const paths = [...new Set([self, ...listed.map((p) => resolveFromRoot(p))])].sort();
  const h = createHash('sha256');
  const hashed: string[] = [];
  for (const p of paths) {
    let buf: Buffer;
    try {
      buf = readFileSync(p);
    } catch (e) {
      if (p === self) throw e;
      console.error(
        `warning: harness path '${relative(REPO_ROOT, p)}' not readable (${(e as { code?: string })?.code || 'error'}) - skipped`,
      );
      continue;
    }
    h.update(relative(REPO_ROOT, p)).update('\0').update(buf).update('\0');
    hashed.push(relative(REPO_ROOT, p));
  }
  const sha = h.digest('hex');
  if (st.harness_sha === sha) return;
  if (approve) {
    st.harness_paths = listed;
    st.harness_sha = sha;
    writeFileSync(statePath, `${JSON.stringify(st, null, 2)}\n`);
    console.error(
      `harness approved: sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s) recorded in ${statePath}`,
    );
    return;
  }
  if (st.harness_sha == null) {
    console.error(
      `no approved harness sha in ${statePath} (computed ${sha.slice(0, 12)} over: ${hashed.join(', ')}).`,
    );
    console.error('Review the harness, then run once with --approve-harness to record it.');
  } else {
    console.error(
      `harness changed since last approved run (files: ${hashed.join(', ')}); ` +
        `approved ${String(st.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}.`,
    );
    console.error('Re-run with --approve-harness after reviewing the diff.');
  }
  process.exit(2);
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  retry: { count: number },
  deadline = Infinity,
  tries = 5,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= deadline) {
      const e = new Error('wall-clock ceiling exceeded before attempt') as Error & {
        failure_class?: string;
      };
      e.failure_class = 'timeout';
      throw e;
    }
    try {
      return await fn();
    } catch (e) {
      const err = e as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status ?? err?.response?.status;
      const transient =
        status === 429 ||
        status === 529 ||
        (typeof status === 'number' && status >= 500 && status < 600) ||
        /overloaded|rate.?limit|Bad Gateway|Upstream stream ended/i.test(
          String(err?.message ?? ''),
        );
      if (!transient || attempt >= tries - 1) throw e;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      if (Date.now() + delay >= deadline) throw e;
      retry.count++;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function withTimeout<T>(promise: Promise<T>, seconds: number, label: string): Promise<T> {
  if (!(seconds > 0)) return promise;
  let timer: NodeJS.Timeout;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label}: exceeded ${seconds}s wall-clock ceiling`) as Error & {
        failure_class?: string;
      };
      e.failure_class = 'timeout';
      reject(e);
    }, seconds * 1000);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

function pathSafeId(id: string): string {
  const raw = String(id);
  const cleaned = raw.replace(/[^\w.-]/g, '_');
  if (cleaned === raw && raw.length <= 129) return raw;
  return `${cleaned.slice(0, 120)}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  const inScratch = typeof err?.path === 'string' && err.path.includes('cairn-eval-');
  if (err?.code === 'ENOENT' && inScratch) {
    console.error(`(忽略拆除噪声) ENOENT ${err.path}`);
    return;
  }
  throw err;
});

async function main() {
  ARGS = parseArgs(process.argv.slice(2));
  ARGS.flow = resolveFromRoot(ARGS.flow);
  const vdir = join(ARGS.flow, ARGS.variant);
  mkdirSync(join(vdir, 'traces'), { recursive: true });
  const statePath = join(ARGS.flow, '_state.json');
  let st: Record<string, unknown> = {};
  if (existsSync(statePath)) {
    try {
      st = JSON.parse(readFileSync(statePath, 'utf8')) || {};
    } catch (e) {
      console.error(
        `${statePath} exists but is not valid JSON (${(e as Error)?.message || e}) - fix it before spending a pass`,
      );
      process.exit(2);
    }
  }
  checkHarness(statePath, st, ARGS.approveHarness);
  if (ARGS.writeVerify && !ARGS.patchDigest) {
    console.error('--write-verify requires --patch-digest');
    process.exit(2);
  }
  const ctx = { ...ARGS, state: st };

  const resultsPath = join(vdir, 'results.jsonl');
  const done = new Set<string>();
  if (existsSync(resultsPath))
    for (const ln of readFileSync(resultsPath, 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      try {
        const r = JSON.parse(ln);
        done.add(`${r.prompt_id}\0${r.rep}`);
      } catch {}
    }

  let cases = await loadCases();
  if (ARGS.caseIds.length > 0) {
    const known = new Set(cases.map((c) => c.id));
    for (const id of ARGS.caseIds) {
      if (!known.has(id)) {
        console.error(`unknown case '${id}'`);
        process.exit(2);
      }
    }
    const want = new Set(ARGS.caseIds);
    cases = cases.filter((c) => want.has(c.id));
  }
  if (ARGS.arm !== 'all' && !cases.some((c) => isLearnCase(c))) {
    console.error(`--arm ${ARGS.arm} applies to learn cases only`);
    process.exit(2);
  }
  const seen = new Map<string, string>();
  for (const c of cases) {
    const k = pathSafeId(c.id).toLowerCase();
    if (seen.has(k)) {
      console.error(
        `duplicate case id after sanitization: '${c.id}' collides with '${seen.get(k)}'`,
      );
      process.exit(2);
    }
    seen.set(k, c.id);
  }

  const tasks: { c: EvalCase; rep: number }[] = [];
  for (const c of cases)
    for (let rep = 0; rep < ARGS.reps; rep++) {
      if (done.has(`${pathSafeId(c.id)}\0${rep}`)) continue;
      tasks.push({ c, rep });
    }
  console.error(`[${ARGS.variant}] ${tasks.length} of ${cases.length * ARGS.reps} (id,rep) to run`);

  let i = 0;
  let ok = 0;
  let fail = 0;
  const errorsPath = join(vdir, 'errors.jsonl');
  for (const p of [resultsPath, errorsPath]) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    if (buf.length && buf[buf.length - 1] !== 0x0a) appendFileSync(p, '\n');
  }
  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      if (task === undefined) break;
      const { c, rep } = task;
      const safeId = pathSafeId(c.id);
      const t0 = Date.now();
      const lastRun: { run: Awaited<ReturnType<typeof runCase>> | null } = { run: null };
      let rowWritten = false;
      const deadline = ARGS.timeoutS > 0 ? t0 + ARGS.timeoutS * 1000 : Infinity;
      const appRetry = { count: 0 };
      const judgeRetry = { count: 0 };
      try {
        const { run, g, latency_s } = await withTimeout(
          (async () => {
            let tAttempt = t0;
            const run = await withBackoff(
              () => {
                tAttempt = Date.now();
                return runCase(c, ctx);
              },
              appRetry,
              deadline,
            );
            lastRun.run = run;
            const latency_s = (Date.now() - tAttempt) / 1000;
            if (ctx.model && run.model && run.model !== ctx.model) {
              const base = ctx.model.replace(/-latest$|-0$/, '');
              const rest = String(run.model).startsWith(base)
                ? String(run.model).slice(base.length)
                : null;
              if (!(rest != null && /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(rest))) {
                const e = new Error(
                  `served model ${run.model} != requested ${ctx.model}`,
                ) as Error & {
                  failure_class?: string;
                };
                e.failure_class = 'serving_substitution';
                throw e;
              }
            }
            const g = await withBackoff(
              async () => {
                if (isLearnCase(c)) {
                  if (run.grade === undefined)
                    throw new Error(`learn case ${c.id} returned no grade`);
                  return run.grade;
                }
                if (isRoutingCase(c)) return gradeRoutingCase(c, run.evidence, run.projectIds);
                return isMemoryCase(c)
                  ? gradeMemoryCase(c, { evidence: run.evidence, memoryAfter: run.memoryAfter })
                  : gradeCase(c, run, ROSTER);
              },
              judgeRetry,
              deadline,
            );
            return { run, g, latency_s };
          })(),
          ARGS.timeoutS,
          `${c.id} rep${rep}`,
        );
        const row = {
          prompt_id: safeId,
          rep,
          prompt: isLearnCase(c) ? c.round2 : c.prompt,
          tags: c.tags,
          meta:
            safeId !== String(c.id) || appRetry.count || judgeRetry.count || isLearnCase(c)
              ? {
                  ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
                  ...(appRetry.count ? { retries: appRetry.count } : {}),
                  ...(judgeRetry.count ? { judge_retries: judgeRetry.count } : {}),
                  ...(isLearnCase(c) ? { arm: ARGS.arm } : {}),
                }
              : undefined,
          model: run.model,
          usage: run.usage,
          stop_reason: run.stop_reason,
          latency_s,
          ...perfFrom(run),
          grade: g.grade,
          explanation: g.explanation,
        };
        appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
        rowWritten = true;
        if (run.transcript)
          writeFileSync(
            join(vdir, 'traces', `${safeId}_rep${rep}.json`),
            JSON.stringify(run.transcript, null, 2),
          );
        ok++;
      } catch (e) {
        fail++;
        if (rowWritten) {
          console.error(
            `  [${ARGS.variant}] ${c.id} rep${rep} scored, but a post-row write failed: ${(e as Error)?.message || e}`,
          );
          continue;
        }
        const err = e as { failure_class?: string; message?: string };
        appendFileSync(
          errorsPath,
          `${JSON.stringify({
            prompt_id: safeId,
            rep,
            failure_class: err?.failure_class ?? 'error',
            error: String(err?.message || e),
            retries: appRetry.count,
            judge_retries: judgeRetry.count,
            model: lastRun.run?.model,
            usage: lastRun.run?.usage,
            latency_s: (Date.now() - t0) / 1000,
          })}\n`,
        );
        console.error(`  [${ARGS.variant}] ${c.id} rep${rep} FAILED: ${err?.message || e}`);
      }
    }
  }
  const t0 = Date.now();
  const progress = () => {
    const d = ok + fail;
    const el = (Date.now() - t0) / 1000;
    const eta = d ? Math.round((el / d) * (tasks.length - d)) : null;
    const line =
      `[${ARGS.variant}] ${d}/${tasks.length} done (${ok} ok, ${fail} failed), ` +
      `${Math.round(el)}s elapsed` +
      (eta != null ? `, ~${eta}s left` : '');
    console.error(line);
    try {
      writeFileSync(join(vdir, 'progress.txt'), `${line}\n`);
    } catch {}
  };
  const tick = setInterval(progress, 30_000);
  await Promise.all(Array.from({ length: Math.max(1, ARGS.concurrency) }, worker));
  clearInterval(tick);
  progress();
  console.error(`[${ARGS.variant}] done - ${ok} ok, ${fail} failed -> ${resultsPath}`);
  const cleaned = disposeLeftovers();
  if (cleaned > 0) console.error(`[${ARGS.variant}] 收尾清掉 ${cleaned} 个残留 scratch 目录`);
  if (ARGS.writeVerify && ARGS.patchDigest) {
    const sha = typeof st.harness_sha === 'string' ? st.harness_sha : '';
    const rows = existsSync(resultsPath)
      ? parseResultsJsonl(readFileSync(resultsPath, 'utf8'))
      : [];
    const tracesDir = join(vdir, 'traces');
    const traces = existsSync(tracesDir)
      ? readdirSync(tracesDir)
          .filter((n) => n.endsWith('.json'))
          .map((n) => ({ name: n, body: new Uint8Array(readFileSync(join(tracesDir, n))) }))
      : [];
    const result = buildHarnessEvalResult({
      patchDigest: ARGS.patchDigest,
      harness_sha: sha,
      decision_ok: decisionOkRate(rows) ?? 0,
      trace_digest: traceDigest(traces),
    });
    mkdirSync(dirname(ARGS.writeVerify), { recursive: true });
    writeFileSync(ARGS.writeVerify, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (cases.some((c) => isLearnCase(c)) && existsSync(resultsPath)) {
    const headline = learnHeadlineFromRows(
      parseResultsJsonl(readFileSync(resultsPath, 'utf8')).flatMap((row) => {
        const grade = (row as { grade?: Record<string, number> }).grade;
        return grade === undefined ? [] : [{ grade }];
      }),
    );
    if (headline !== null) {
      const gap = headline.gapClosed === null ? 'n/a' : headline.gapClosed.toFixed(3);
      console.error(
        `learn headline: repeat_rate=${headline.repeatRate.toFixed(3)} gap_closed=${gap}`,
      );
    }
  }
  process.exit(fail ? 1 : 0);
}

main();
