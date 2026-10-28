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
import { cancelPendingQuestions } from '../../../apps/server/src/services/chief-questions.js';
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

export const REPO_ROOT = resolve(HERE, '../../..');
export const resolveFromRoot = (p: string): string => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

const REPO_SEED_DIR = join(HERE, 'repo-seed');

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

/** Reverse-lookup and kill "escapee" processes left running after a trial; returns the number of pids reaped. */
export async function reapEscapees(home: string): Promise<number> {
  // pgrep -f substring-matches, so tmpdir()'s /var/folders/... already hits the
  // /private/var/folders/... form in cmdline (macOS symlinks /var to /private/var);
  // realpathSync throws once the directory is gone, the home string does not.
  let out = '';
  try {
    out = execFileSync('pgrep', ['-f', home], { encoding: 'utf8' });
  } catch {
    return 0; // pgrep exits 1 when nothing matches
  }
  const pids = out
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
  if (pids.length === 0) return 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1_000));
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {}
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
  skillsDir: string;
  logLines: () => string[];
  park: () => void;
  unpark: () => void;
  close: () => Promise<void>;
}

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
  const server = await bootRealServer({
    providerBaseUrl: 'http://127.0.0.1:9/v1',
    claimHoldMs: 1_000,
  });
  const home = mkdtempSync(join(tmpdir(), 'cairn-eval-chief-'));
  const skillsDir = mkdtempSync(join(tmpdir(), 'cairn-eval-skills-'));
  const mcpConfigPath = join(tmpdir(), `cairn-eval-mcp-${randomUUID()}.json`);
  let claimsParked = false;
  const parkedClaimReleases: Array<() => void> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (claimsParked && init?.method === 'POST' && url.endsWith('/api/machine/tasks/claim')) {
      await new Promise<void>((resolve) => {
        const sig = init?.signal;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          sig?.removeEventListener('abort', finish);
          resolve();
        };
        if (!sig || sig.aborted) return finish();
        sig.addEventListener('abort', finish, { once: true });
        parkedClaimReleases.push(finish);
        if (!claimsParked) finish();
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
    unpark: () => {
      claimsParked = false;
      const waiting = parkedClaimReleases.splice(0);
      for (const release of waiting) release();
    },
    close: async () => {
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
      const reaped = await reapEscapees(home);
      if (reaped > 0) console.error(`[stack] reaped ${reaped} escapee process(es)`);
      LEFTOVERS.push(home, skillsDir);
    },
  };
}

export function seedRepoContent(
  stack: Stack,
  projectId: string,
  projectName: string,
  seedDir: string = REPO_SEED_DIR,
): void {
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
    cpSync(seedDir, work, { recursive: true });
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

export async function seedWorld(
  stack: Stack,
  opts: {
    relayBaseUrl: string;
    relayKey: string;
    roster: RosterAgent[];
    chiefModelId: string;
    chiefContextWindow?: number;
  },
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
    models: modelIds.map((id) => ({
      id,
      name: id,
      ...(id === opts.chiefModelId && opts.chiefContextWindow !== undefined
        ? { contextWindow: opts.chiefContextWindow }
        : {}),
    })),
    apiKey: opts.relayKey,
  });
  if (prov.status !== 201)
    throw new Error(`建 provider 失败: ${prov.status} ${JSON.stringify(prov.body)}`);

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
  createdTodoRows: {
    id: string;
    title: string;
    spec: string;
    projectId: string;
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

function stopStraySteps(stack: Stack): void {
  const db = stack.server.db;
  for (const row of db.select().from(stepTable).all()) {
    if (row.kind === 'chief') continue;
    if (row.status !== 'pending' && row.status !== 'waiting_quota') continue;
    db.update(stepTable).set({ status: 'stopped' }).where(eq(stepTable.id, row.id)).run();
  }
}

function chiefStepIds(stack: Stack, threadId: string): Set<string> {
  return new Set(
    stack.server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((row) => row.kind === 'chief')
      .map((row) => row.id),
  );
}

async function settleChiefTurn(
  stack: Stack,
  threadId: string,
  knownChiefStepIds: Set<string>,
  timeoutMs: number,
): Promise<void> {
  const db = stack.server.db;
  stopStraySteps(stack);
  stack.unpark();
  const fresh = () =>
    db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((row) => row.kind === 'chief' && !knownChiefStepIds.has(row.id));
  await waitFor(
    () =>
      fresh().some(
        (row) =>
          row.status === 'claimed' ||
          row.status === 'done' ||
          row.status === 'failed' ||
          row.status === 'stopped',
      ),
    30_000,
  );
  stack.park();
  await waitFor(() => {
    cancelPendingQuestions({ db }, threadId, 'eval harness: no user is present to answer');
    const thread = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
    const settled = fresh().some(
      (row) => row.status === 'done' || row.status === 'failed' || row.status === 'stopped',
    );
    return settled && thread?.activeRun === null;
  }, timeoutMs);
}

export async function driveTurn(
  stack: Stack,
  prompt: string,
  opts: { timeoutMs: number; projectId?: string },
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
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    },
  );
  if (sent.status !== 201)
    throw new Error(`发消息失败: ${sent.status} ${JSON.stringify(sent.body)}`);
  const threadId = (sent.body as { thread: { id: string } }).thread.id;

  await settleChiefTurn(stack, threadId, new Set(), opts.timeoutMs);
  return driveTurnEvidence(stack, threadId, before, Date.now() - t0);
}

function driveTurnEvidence(
  stack: Stack,
  threadId: string,
  beforeTodoIds: Set<string>,
  wallMs: number,
): TurnEvidence {
  const db = stack.server.db;
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
    .filter((t) => !beforeTodoIds.has(t.id));
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
      projectId: t.projectId,
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

export async function driveFollowUp(
  stack: Stack,
  threadId: string,
  content: string,
  opts: { timeoutMs: number },
): Promise<TurnEvidence> {
  const db = stack.server.db;
  const before = new Set(
    db
      .select({ id: todoTable.id })
      .from(todoTable)
      .all()
      .map((row) => row.id),
  );
  const knownChiefStepIds = chiefStepIds(stack, threadId);
  const beforeUsage = db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.buildId, threadId))
    .all()
    .reduce(
      (acc, row) => ({
        input: acc.input + row.input,
        output: acc.output + row.output,
        cacheRead: acc.cacheRead + row.cacheRead,
        cacheWrite: acc.cacheWrite + row.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
  const t0 = Date.now();
  const sent = await api(stack.server.url, 'POST', `/api/conversations/${threadId}/messages`, {
    content,
  });
  if (sent.status !== 201)
    throw new Error(`follow-up failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  await settleChiefTurn(stack, threadId, knownChiefStepIds, opts.timeoutMs);
  const evidence = await driveTurnEvidence(stack, threadId, before, Date.now() - t0);
  return {
    ...evidence,
    usage: {
      input: evidence.usage.input - beforeUsage.input,
      output: evidence.usage.output - beforeUsage.output,
      cacheRead: evidence.usage.cacheRead - beforeUsage.cacheRead,
      cacheWrite: evidence.usage.cacheWrite - beforeUsage.cacheWrite,
    },
  };
}
