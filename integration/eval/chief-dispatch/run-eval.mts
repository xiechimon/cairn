#!/usr/bin/env -S pnpm exec tsx
// chief-dispatch 评测 runner（从 claude-api skill 的 runner-scaffold.mjs 长出来；
// 脚手架以下的部分未改动——resume / 抖动退避 / 每 case 墙钟硬顶 / served-model
// 断言 / harness 完整性闸 / errors 侧车 都是脚手架原装）。
//
//   pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
//     --flow .claude/hillclimb/chief-dispatch --variant baseline --model glm-5.3 --reps 3
//
// 判什么：chief 回合结束后的**环境终态**——新建 todo 行的 assignment.build.agentId
// （派给谁），不读 transcript。判分口径与「工作约定」逐条对应。

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
  gradeMemoryCase,
  isMemoryCase,
  type MemoryCase,
  type MemoryRowLite,
} from '../memory-regression/grade.mts';
import { readMemoryRows, seedMemories } from '../memory-regression/seed.mts';
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
const RELAY_BASE_URL = process.env.CAIRN_EVAL_RELAY_URL ?? 'http://112.80.47.186:8783/v1';

/** relay 各模型的挂牌价（OpenRouter 列表价，$/1M token，2026-09-29 拉取）。
 * relay 自己不报成本，`models.json` 里 cost 全是 0，所以只能外部取价。 */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'glm-5.3': { in: 1.4, out: 4.4, cacheRead: 0.26 },
  'kimi-k3': { in: 3.0, out: 15.0, cacheRead: 0.3 },
  'qwen3.8-max': { in: 2.0, out: 6.0, cacheRead: 0.25 },
  'deepseek-v4-pro': { in: 0.955, out: 1.911, cacheRead: 0.08 },
};

type EvalCase = Case | MemoryCase;

async function loadCases(): Promise<EvalCase[]> {
  const d = JSON.parse(readFileSync(join(ARGS.flow, 'cases.json'), 'utf8')) as {
    roster: RosterAgent[];
    cases: EvalCase[];
  };
  ROSTER = d.roster;
  CHIEF_MODEL = ARGS.model ?? CHIEF_MODEL;
  return d.cases;
}

/** 每例一条全新栈（进程内 server + daemon），判完立刻关掉。
 *
 * 不复用栈是刻意的：chief 派工会真创建一个 build 步并入队，daemon 会去领它。
 * 复用栈就必须在例间删行，而在 daemon 手里删步会 404 打死进程（实测）；
 * 全新栈 + 判完即关则让那次下游执行根本没机会跑起来，同时白得「每 trial
 * 干净隔离」——每例的库、home、skills 根、机器注册都是新的。 */
async function freshStack(input: EvalCase): Promise<{ stack: Stack; world: SeededWorld }> {
  const stack = await bootStack();
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: RELAY_BASE_URL,
      relayKey: relayKey(),
      roster: ROSTER,
      chiefModelId: CHIEF_MODEL,
    });
    if (isMemoryCase(input)) await seedMemories(stack.server, world, input);
    return { stack, world };
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
  /** 本 case 实际跑的那条栈上 key→agentId 的映射（每条栈 id 随机，判分必须
   * 用同一条栈的映射反查，不能用全局表）。 */
  agentIds: Record<string, string>;
  memoryAfter: MemoryRowLite[];
}> {
  const { stack, world } = await freshStack(input);
  try {
    const timeoutMs = ctx.timeoutS > 0 ? ctx.timeoutS * 1000 : 300_000;
    const ev = await driveTurn(stack, input.prompt, { timeoutMs });
    // 链路失败一律落 errors.jsonl，绝不计分——把基础设施问题算成模型失败会
    // 让头条分数凭空掉几个点，而且失败会集中到某几条用例上，看起来像「模型
    // 系统性不会做这件事」。两种实测形态：
    //   ① 零 token：回合根本没跑到模型（延迟整齐卡在 ~30s 的超时特征）。
    //   ② step=failed：模型跑了、也出了话，但步以失败收场。只看 token 抓不到
    //      这一种——实测有过某条用例 3/3 全是 failed step，被误读成「它系统性
    //      不派工」。
    const dead = (ev.usage.input === 0 && ev.usage.output === 0) || ev.stepStatus !== 'done';
    if (dead) {
      const e = new Error(
        `回合未正常完成：step=${ev.stepStatus} usage=${ev.usage.input}/${ev.usage.output} latency=${(ev.wallMs / 1000).toFixed(1)}s`,
      ) as Error & { failure_class?: string };
      e.failure_class = 'harness_error';
      throw e;
    }
    // 截断的可观测特征：回合「正常结束」但既没调工具也没吐正文。cairn 目前
    // 不上报模型 finish_reason，只能靠这个特征判定——见交付说明的已知缺口。
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
      memoryAfter: readMemoryRows(stack.server, world.chiefAgentId),
    };
  } finally {
    await stack.close();
  }
}

/** chief 会话的 Turn[]（SCHEMA.md 形）——供报告点进去看完整往返。 */
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
    else if (k === '-h' || k === '--help') {
      usage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${k}`);
      usage();
      process.exit(2);
    }
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
    'usage: run-eval.mts --flow DIR --variant ID [--model ID] [--reps N] [--concurrency N] [--timeout-s N (0 = no ceiling)] [--approve-harness] [--write-verify PATH --patch-digest DIGEST]',
  );
}

function checkHarness(statePath: string, st: Record<string, unknown>, approve: boolean) {
  const self = fileURLToPath(import.meta.url);
  const listed = [...CHIEF_DISPATCH_HARNESS_PATHS];
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

// 窄口径兜底：本 runner 会主动拆掉跑到一半的 daemon，被拆的 daemon 下次写日志
// 会 ENOENT。那个异步异常会打死整个进程（实测两次），但它是我们亲手制造的拆除
// 噪声，不是评测结果的一部分。只吞这一种（scratch 目录下的 daemon.log ENOENT），
// 别的照旧抛出——不用宽口径 handler 掩盖真问题。
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

  const cases = await loadCases();
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
      // 赋值在下面那个 async IIFE 里，而 tsc 的控制流分析看不穿闭包边界：它会把
      // `let x: T | null = null` 一路当成 null，读取处 `x?.model` 就落到 never 上
      // 报 TS2339。装在对象字段里避开的是「变量按赋值收窄」这条规则——属性收窄
      // 只由显式守卫触发，不追赋值。
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
            // served-model 断言：跑分必须由请求的那个模型产出。容忍 alias→snapshot
            // 的日期后缀解析；别的差异（另一档快照、兄弟模型、静默换模）一律判失败。
            // 注意这只能发现「daemon 选了别的模型」——模型 id 是 cairn 自己记的账，
            // 不是上游响应回显的，relay 静默换模它看不出来（见 metrics.md 已知缺口）。
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
              async () =>
                isMemoryCase(c)
                  ? gradeMemoryCase(c, { evidence: run.evidence, memoryAfter: run.memoryAfter })
                  : gradeCase(c, run, ROSTER),
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
          prompt: c.prompt,
          tags: c.tags,
          meta:
            safeId !== String(c.id) || appRetry.count || judgeRetry.count
              ? {
                  ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
                  ...(appRetry.count ? { retries: appRetry.count } : {}),
                  ...(judgeRetry.count ? { judge_retries: judgeRetry.count } : {}),
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
  process.exit(fail ? 1 : 0);
}

main();
