// chief-dispatch 评测的驱动层：起真 server + 真 daemon（进程内），seed 团队编制，
// 驱动一个 chief 回合，然后把「环境终态」读回来。
//
// 判分口径：读 end state（todo 行 + build 行的 assignment），不读 transcript——
// 对 agent 类应用，transcript 是叙述，环境才是答案。

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { loadDaemonConfig } from '../../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../../apps/daemon/src/machine-loop.js';
import { statePaths } from '../../../apps/daemon/src/state.js';
import {
  agentMemory as agentMemoryTable,
  agent as agentTable,
  build as buildTable,
  chiefMessage,
  chiefThread,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../../../apps/server/src/db/schema.js';
import { repoDirFor } from '../../../apps/server/src/services/git.js';
import {
  api,
  bootRealServer,
  daemonLogLines,
  AGENT_ID as HELPER_BOOTSTRAP_AGENT_ID,
  type RealServer,
  waitFor,
} from '../../../integration/test/helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 仓根（本模块在 integration/eval/chief-dispatch/ 下）。flow 路径与
 * `_state.json.harness_paths` 都锚在这里而不是 cwd：runner 常从
 * `pnpm --filter @cairn/integration exec tsx …` 里被调用，那个 cwd 是
 * integration/，锚 cwd 会把 flow 解析到错地方，还会让 harness 哈希随调用位置
 * 漂移——同一份 harness 在不同 cwd 下算出不同的 sha，闸就废了。 */
export const REPO_ROOT = resolve(HERE, '../../..');
export const resolveFromRoot = (p: string): string => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

/** 场景仓库的内容源（真实文件，进 harness 哈希，可逐条审）。 */
const REPO_SEED_DIR = join(HERE, 'repo-seed');

/** daemon 没在限时内停干净时留下的目录（收尾统一清，见 disposeLeftovers）。 */
const LEFTOVERS: string[] = [];

export function disposeLeftovers(): number {
  let n = 0;
  for (const dir of LEFTOVERS.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
      n++;
    } catch {}
  }
  return n;
}

/** 反查并清掉「逃逸进程」，返回处理掉的 pid 数。
 *
 * 被测 agent 会在 workspaces/<uuid>/ 下用 `nohup vite &` 起 dev server：它不在
 * harness 持有的任何 handle 里，close() 的 handle.stop()/server.close() 够不着，
 * 而 disposeLeftovers() 只 rmSync 目录——rmSync 不杀进程。实测评测跑完后 vite 以
 * ppid=1 的孤儿形态继续 LISTEN 5173，跑 N 轮就从 5173 排到 5173+N，把后续本机
 * dev 一路往后挤。只能在删目录前按 home 路径反查。 */
export async function reapEscapees(home: string): Promise<number> {
  // pgrep -f 是子串匹配，tmpdir() 的 /var/folders/... 足以命中 cmdline 里的
  // /private/var/folders/...（macOS symlink），不必先 realpath——实测 2026-09-29
  // 两种 pattern 都命中同一 pid。反过来直接用 home 更稳：realpathSync 在目录已
  // 删时会抛，而 home 字符串始终可用。
  let out = '';
  try {
    out = execFileSync('pgrep', ['-f', home], { encoding: 'utf8' });
  } catch {
    return 0; // pgrep 无匹配时退出码 1，属正常
  }
  const pids = out
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
  if (pids.length === 0) return 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 已退出 */
    }
  }
  // 给 TERM 时间收尾，再对赖着不走的补 KILL（kill 0 先探活，避免打到复用的 pid）。
  await new Promise((r) => setTimeout(r, 1_000));
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      /* TERM 已经够了 */
    }
  }
  return pids.length;
}

export interface RosterAgent {
  key: string;
  displayName: string;
  modelId: string;
  description: string;
}

export interface Stack {
  server: RealServer;
  home: string;
  /** 隔离的技能根（空目录）——诊断脚本合成 chief 系统提示词时要用。 */
  skillsDir: string;
  logLines: () => string[];
  /** 关掉 daemon 的领活口（chief 步领走后调用；#503 后接替并发门占位）。 */
  park: () => void;
  close: () => Promise<void>;
}

/** relay 凭据：优先 CAIRN_EVAL_RELAY_KEY，回落本机 ~/.claude/settings.json。
 * 密钥永不落盘、永不进仓——runner 只在进程内持有。 */
export function relayKey(): string {
  const fromEnv = process.env.CAIRN_EVAL_RELAY_KEY;
  if (fromEnv && fromEnv !== '') return fromEnv;
  const raw = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as {
    env?: Record<string, string>;
  };
  const token = raw.env?.ANTHROPIC_AUTH_TOKEN;
  if (!token) {
    throw new Error(
      'relay key 缺失：设 CAIRN_EVAL_RELAY_KEY，或在 ~/.claude/settings.json 的 env.ANTHROPIC_AUTH_TOKEN 里配',
    );
  }
  return token;
}

export function relayBaseUrl(): string {
  const url = process.env.CAIRN_EVAL_RELAY_URL;
  if (!url)
    throw new Error(
      'relay URL missing: set CAIRN_EVAL_RELAY_URL (for example http://<relay-host>:<port>/v1)',
    );
  return url;
}

export async function bootStack(): Promise<Stack> {
  // providerBaseUrl 只喂给 helpers 自带的 stub-gw 行；本评测不使用它，真 provider
  // 由 seedWorld 经 REST 建（key 走服务端 SecretBox 密封）。
  const server = await bootRealServer({
    providerBaseUrl: 'http://127.0.0.1:9/v1',
    claimHoldMs: 1_000,
  });
  const home = mkdtempSync(join(tmpdir(), 'cairn-eval-chief-'));
  // 两条隔离护栏，缺一条评测就在测用户的机器而不是被测对象：
  // - skillsDir 默认 ~/.agents/skills：不经隔离，用户本机 80 个技能的清单会
  //   经 daemon 的 <available_skills> 注入 chief 系统提示词（实测污染 50 条）。
  // - mcpConfigPath 默认 ~/.claude.json：不经隔离，daemon 会真的 spawn 用户
  //   配置的 MCP server 进程。
  const skillsDir = mkdtempSync(join(tmpdir(), 'cairn-eval-skills-'));
  const mcpConfigPath = join(tmpdir(), `cairn-eval-mcp-${randomUUID()}.json`);
  // claim 占位闸（接替 #503 摘除的 maxConcurrent=1 + 占位步机制）：park 后
  // daemon 的 claim POST 在 harness 的 fetch 缝挂起，signal abort（停机或
  // claimTimeout 护栏）时返回 {step:null}——chief 步领走后 flip，chief 派出的
  // worker 步自此永远领不走，评测不会真去 clone 仓库烧模型。
  let claimsParked = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (claimsParked && init?.method === 'POST' && url.endsWith('/api/machine/tasks/claim')) {
      await new Promise<void>((resolve) => {
        const sig = init?.signal;
        if (!sig || sig.aborted) return resolve();
        sig.addEventListener('abort', () => resolve(), { once: true });
      });
      return new Response(JSON.stringify({ step: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return fetch(input, init);
  };
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'eval-machine',
      skillsDir,
      mcpConfigPath,
    },
    {},
  );
  const paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  const handle: MachineHandle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    // 空 proxyEnv：relay 实测有代理/无代理均直连可达，本地回环不需要绕。
    proxyEnv: {},
    fetchImpl,
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  const logLines = (): string[] => daemonLogLines(paths.daemonLog);
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
  return {
    server,
    home,
    skillsDir,
    logLines,
    park: () => {
      claimsParked = true;
    },
    close: async () => {
      // 判完立刻关栈 = 让 daemon 来不及执行 chief 刚派出去的 build。关栈失败
      // 不该污染这一例的判分（该例的行已经写好了），吞掉即可。
      //
      // 每步都有界：daemon 常正忙着给被派出去的 build 克隆工作区，无界等待会
      // 让每例白花 40 秒（实测 5 例 668s vs 单回合 62s）。迟到的那点清理进程
      // 随下的 rmSync 一起消失，不影响下一例（下一例是全新栈）。
      const raceWith = async (p: unknown, ms: number): Promise<boolean> => {
        let settled = false;
        await Promise.race([
          Promise.resolve(p).then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          ),
          new Promise((r) => setTimeout(r, ms)),
        ]);
        return settled;
      };
      await raceWith(handle.stop(), 15_000);
      await raceWith(handle.done, 15_000);
      await raceWith(server.close(), 5_000);
      // daemon 停了不等于环境干净：被测 agent 用 nohup 起的 dev server 逃出了
      // harness 的 handle，得按 home 路径反查清掉（见 reapEscapees）。
      const reaped = await reapEscapees(home);
      if (reaped > 0) console.error(`[stack] 清掉 ${reaped} 个逃逸进程`);
      // 一律推迟到整轮结束再删。曾经在 close 里直接 rm：那时 daemon 还在写
      // home/daemon.log，被删后它下次写日志 ENOENT，未捕获异常打死整个 runner
      // （实测两次）。stop() 返回 ≠ 主循环已退出，靠限时等它退出是不可靠的，
      // 索性不在运行期删。占位机制生效后 daemon 不再 clone 仓库，home 很小，
      // 攒到收尾再清没有磁盘压力。
      LEFTOVERS.push(home, skillsDir);
    },
  };
}

/** 给场景项目的托管仓种真实内容。
 *
 * 不种内容的后果实测过：仓库为空时「把使用说明重写一版」这类请求在环境里
 * 根本不成立——称职的总管会花 20+ 次调用探测、确认仓库是空的，然后正确地
 * 拒绝派工并反问用户要原稿。那测的是场景缺陷，不是模型能力。 */
export function seedRepoContent(stack: Stack, projectId: string, projectName: string): void {
  const db = stack.server.db;
  const row = db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
  const repoName = (row as { repoName?: string | null } | undefined)?.repoName;
  if (!repoName) throw new Error(`项目 ${projectId} 无 repoName，无法种内容`);
  const bare = repoDirFor(stack.server.reposDir, stack.server.teamId, repoName);
  const work = mkdtempSync(join(tmpdir(), 'cairn-eval-repo-'));
  const git = (...args: string[]): string => {
    const r = spawnSync('git', args, { cwd: work, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  try {
    git('clone', bare, '.');
    cpSync(REPO_SEED_DIR, work, { recursive: true });
    git('add', '-A');
    git(
      '-c',
      'user.email=eval@cairn.local',
      '-c',
      'user.name=eval',
      'commit',
      '-m',
      `seed ${projectName}`,
    );
    git('push', 'origin', 'HEAD:main');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** chief 的思考档位。默认 null = 用绑定 Agent 自己的设置；`CAIRN_EVAL_CHIEF_THINKING`
 * 可覆盖（off/minimal/low/medium/high/xhigh/max），用来量「降档位省多少、质量掉不掉」
 * ——一个参数、可一键回退，不动任何产品代码。 */
function chiefThinkingLevel(): string | null {
  const v = process.env.CAIRN_EVAL_CHIEF_THINKING;
  return v !== undefined && v !== '' ? v : null;
}

export interface SeededWorld {
  providerId: string;
  agentIds: Record<string, string>;
  chiefAgentId: string;
  chiefModelId: string;
  projectId: string;
}

/** 建真 provider（指向 relay）+ 四个编制 Agent + 绑定总管 + 一个项目。
 * 总管用 chiefModelId；四个 Agent 只当 roster 标签，评测里从不被调用。 */
export async function seedWorld(
  stack: Stack,
  opts: { relayBaseUrl: string; relayKey: string; roster: RosterAgent[]; chiefModelId: string },
): Promise<SeededWorld> {
  const { server } = stack;
  const modelIds = [...new Set([...opts.roster.map((a) => a.modelId), opts.chiefModelId])];
  const prov = await api(server.url, 'POST', `/api/teams/${server.teamId}/providers`, {
    providerId: 'relay-186',
    label: 'relay-186',
    baseUrl: opts.relayBaseUrl,
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: modelIds.map((id) => ({ id, name: id })),
    apiKey: opts.relayKey,
  });
  if (prov.status !== 201)
    throw new Error(`建 provider 失败: ${prov.status} ${JSON.stringify(prov.body)}`);

  // helpers 会 seed 一个集成测试用的 Agent（agent-it-1，职责文案是写给 stub LLM
  // 的）。它不属于场景编制，却会出现在 chief 的团队资源清单里——多一个不该有的
  // 分派候选，也让「按顺序数条目」多一个错位机会。清掉。
  server.db.delete(agentTable).where(eq(agentTable.id, HELPER_BOOTSTRAP_AGENT_ID)).run();

  const machineRow = server.db.select().from(machineTable).all()[0];
  if (machineRow === undefined) throw new Error('daemon 未注册机器，无法给 Agent 绑归属机');

  const agentIds: Record<string, string> = {};
  for (const a of opts.roster) {
    const res = await api(server.url, 'POST', `/api/teams/${server.teamId}/agents`, {
      displayName: a.displayName,
      description: a.description,
      provider: 'relay-186',
      modelId: a.modelId,
      machineId: machineRow.id,
    });
    if (res.status !== 201)
      throw new Error(`建 agent ${a.key} 失败: ${res.status} ${JSON.stringify(res.body)}`);
    agentIds[a.key] = (res.body as { id: string }).id;
  }

  // 总管自己也是一个 Agent（复用 roster 里同模型的那个，省一次建行）。
  const chiefKey =
    opts.roster.find((a) => a.modelId === opts.chiefModelId)?.key ?? opts.roster[0]?.key;
  if (chiefKey === undefined) throw new Error('roster 为空，无法确定总管 agent');
  const chiefAgentId = agentIds[chiefKey];
  if (chiefAgentId === undefined) throw new Error(`总管绑定的 agent 未建出: ${chiefKey}`);
  const bound = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
    agent: { agentId: chiefAgentId, thinkingLevel: chiefThinkingLevel() },
    charter: '',
  });
  if (bound.status !== 200) throw new Error(`绑定总管失败: ${bound.status}`);

  const proj = await api(server.url, 'POST', '/api/projects', {
    name: 'eval-project',
    teamId: server.teamId,
    repoKind: 'hosted',
  });
  if (proj.status !== 201) throw new Error(`建项目失败: ${proj.status}`);
  const projectId = (proj.body as { id: string }).id;
  seedRepoContent(stack, projectId, 'eval-project');

  return {
    providerId: 'relay-186',
    agentIds,
    chiefAgentId,
    chiefModelId: opts.chiefModelId,
    projectId,
  };
}

/** 清掉上一例留下的一切可被下一例看见的状态。agent_memory 必须在列——
 * 它经 composeChiefSystemPrompt 进系统提示词，不清理就会跨用例累积、悄悄
 * 改变后续用例的输入。 */
export function resetTurnState(stack: Stack): void {
  const db = stack.server.db;
  db.delete(buildTable).run();
  db.delete(todoTable).run();
  db.delete(chiefMessage).run();
  db.delete(chiefThread).run();
  db.delete(stepTable).run();
  db.delete(tokenUsage).run();
  db.delete(agentMemoryTable).run();
}

export interface TurnEvidence {
  threadId: string;
  stepStatus: string;
  toolCalls: { name: string; arguments: unknown; isError?: boolean }[];
  runBuildsArgs: unknown[];
  assistantText: string;
  createdTodoIds: string[];
  /** 派工结果落在 todo.assignment 上（build 表没有 assignment 列）——
   * `run_builds` 的 assignment 参数经 startBuilds 写进被派 todo 行。 */
  createdTodoRows: {
    id: string;
    title: string;
    spec: string;
    buildAgentId: string | null;
    planAgentId: string | null;
    phase: string;
  }[];
  buildRows: { id: string; todoId: string; withPlan: boolean; triggerSource: string }[];
  model: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  wallMs: number;
}

function pluckToolCalls(
  rows: { content: unknown }[],
): { name: string; arguments: unknown; isError?: boolean }[] {
  const out: { name: string; arguments: unknown; isError?: boolean }[] = [];
  for (const r of rows) {
    const c = r.content as unknown;
    const blobs: unknown[] = Array.isArray(c) ? c : [c];
    for (const b of blobs) {
      if (b && typeof b === 'object' && (b as { kind?: string }).kind === 'toolcall') {
        const call = (b as { call?: { name?: string; arguments?: unknown; isError?: boolean } })
          .call;
        if (call?.name)
          out.push({ name: call.name, arguments: call.arguments, isError: call.isError });
      }
    }
  }
  return out;
}

function pluckText(rows: { content: unknown }[]): string {
  const parts: string[] = [];
  for (const r of rows) {
    const c = r.content as unknown;
    const blobs: unknown[] = Array.isArray(c) ? c : [c];
    for (const b of blobs) {
      if (!b || typeof b !== 'object') {
        if (typeof b === 'string') parts.push(b);
        continue;
      }
      const o = b as { type?: string; kind?: string; text?: string };
      if ((o.type === 'text' || o.kind === 'text') && typeof o.text === 'string')
        parts.push(o.text);
    }
  }
  return parts.join('\n').trim();
}

/** 驱动一个 chief 回合并读回环境终态。 */
export async function driveTurn(
  stack: Stack,
  prompt: string,
  opts: { timeoutMs: number },
): Promise<TurnEvidence> {
  const db = stack.server.db;
  const before = new Set(
    db
      .select({ id: todoTable.id })
      .from(todoTable)
      .all()
      .map((r) => r.id),
  );
  const t0 = Date.now();

  const sent = await api(
    stack.server.url,
    'POST',
    `/api/teams/${stack.server.teamId}/chief/threads`,
    {
      content: prompt,
    },
  );
  if (sent.status !== 201)
    throw new Error(`发消息失败: ${sent.status} ${JSON.stringify(sent.body)}`);
  const threadId = (sent.body as { thread: { id: string } }).thread.id;

  // 等 chief 步被领走后再关领活口：反过来会把 chief 步自己也堵在门外。
  await waitFor(() => {
    const s = db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
    return s.some((x) => x.kind === 'chief' && x.status === 'claimed');
  }, 30_000);
  stack.park();

  await waitFor(() => {
    const th = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
    return th?.lastTurnAt != null && th.activeRun === null;
  }, opts.timeoutMs);
  const wallMs = Date.now() - t0;

  const steps = db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
  const chiefSteps = steps.filter((s) => s.kind === 'chief');
  const stepStatus = chiefSteps.at(-1)?.status ?? 'missing';

  const msgs = db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all();
  const assistant = msgs.filter((m) => m.role === 'assistant');
  const toolCalls = pluckToolCalls(assistant);

  const todos = db
    .select()
    .from(todoTable)
    .all()
    .filter((t) => !before.has(t.id));
  const builds = db.select().from(buildTable).all();

  const usageRows = db.select().from(tokenUsage).where(eq(tokenUsage.buildId, threadId)).all();
  const usage = usageRows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      output: acc.output + r.output,
      cacheRead: acc.cacheRead + r.cacheRead,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

  // token_usage.model 记的是 `<provider>/<model>`（pi 的 usage key 形），剥前缀
  // 才是能对价格表、能跟 --model 比对的裸模型 id。
  const rawModel = usageRows.find((r) => r.model !== '')?.model ?? null;
  const model = rawModel !== null ? (rawModel.split('/').at(-1) ?? rawModel) : null;

  const assignmentOf = (
    t: (typeof todos)[number],
  ): { build: string | null; plan: string | null } => {
    const a = t.assignment as { build?: { agentId?: string }; plan?: { agentId?: string } } | null;
    return { build: a?.build?.agentId ?? null, plan: a?.plan?.agentId ?? null };
  };

  return {
    threadId,
    stepStatus,
    toolCalls,
    runBuildsArgs: toolCalls.filter((c) => c.name === 'run_builds').map((c) => c.arguments),
    assistantText: pluckText(assistant),
    createdTodoIds: todos.map((t) => t.id),
    createdTodoRows: todos.map((t) => ({
      id: t.id,
      title: t.title,
      spec: t.spec ?? '',
      buildAgentId: assignmentOf(t).build,
      planAgentId: assignmentOf(t).plan,
      phase: t.phase,
    })),
    buildRows: builds.map((b) => ({
      id: b.id,
      todoId: b.todoId,
      withPlan: b.withPlan,
      triggerSource: b.triggerSource,
    })),
    model,
    usage,
    wallMs,
  };
}
