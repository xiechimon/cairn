import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { FIRST_TOKEN_EVENTS } from '../../../apps/daemon/src/backend/pi.js';
import { openMemoryDb } from '../../../apps/server/src/db/client.js';
import {
  agent as agentTable,
  chiefMessage,
  chiefTurnUsage,
  project as projectTable,
} from '../../../apps/server/src/db/schema.js';
import { seed } from '../../../apps/server/src/db/seed.js';
import {
  buildChiefSystemPrompt,
  coordinatorThreadRow,
  ensureChief,
} from '../../../apps/server/src/services/chief.js';
import { readHistory, searchHistory } from '../../../apps/server/src/services/chief-history.js';
import { TeamStreamHub } from '../../../apps/server/src/services/events.js';
import { assemble, estimateTokens } from './assemble.mts';
import {
  AGENTS,
  buildFixture,
  type FixtureToolCall,
  type FixtureTurn,
  messageId,
  PROJECTS,
  RECALL_QUESTION,
  RECALL_TURN,
  recalled,
  SEEDED_TURNS,
  toolMessageId,
} from './fixture.mts';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(here, 'chief-tools-ext.mjs');

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic/claude-haiku-5-5' },
    thinking: { type: 'string', default: 'low' },
    arms: { type: 'string', default: 'a0,a1,b1,b2' },
    live: { type: 'string', default: String(RECALL_TURN - SEEDED_TURNS - 1) },
    budgetUsd: { type: 'string', default: '4.5' },
    out: { type: 'string', default: 'docs/verify/2522/raw' },
    inputBudget: { type: 'string', default: '64000' },
    contextWindow: { type: 'string', default: '1000000' },
  },
});
const MODEL = args.model;
const [PROVIDER, MODEL_ID] = [MODEL.split('/')[0] as string, MODEL.split('/').slice(1).join('/')];
const LIVE_TURNS = Number(args.live);
const BUDGET_USD = Number(args.budgetUsd);
const INPUT_BUDGET = Number(args.inputBudget);

interface ArmSpec {
  name: string;
  mode: 'resume' | 'fresh';
  compaction: Record<string, unknown>;
  align: number;
}

const ARMS: Record<string, ArmSpec> = {
  a0: { name: 'a0-resume-pi-default', mode: 'resume', compaction: { enabled: true }, align: 1 },
  a1: {
    name: 'a1-resume-tuned-compaction',
    mode: 'resume',
    compaction: {
      enabled: true,
      reserveTokens: Number(args.contextWindow) - INPUT_BUDGET,
      keepRecentTokens: 16384,
    },
    align: 1,
  },
  b1: { name: 'b1-fresh-retrieval', mode: 'fresh', compaction: { enabled: true }, align: 1 },
  b2: {
    name: 'b2-fresh-retrieval-aligned8',
    mode: 'fresh',
    compaction: { enabled: true },
    align: 8,
  },
};

let spentUsd = 0;

function makeWorld() {
  const db = openMemoryDb();
  const { user, team } = seed(db);
  const skillsDir = mkdtempSync(join(tmpdir(), 'spike2522-skills-'));
  const deps = { db, hub: new TeamStreamHub(), user, skillsDir };
  for (const name of PROJECTS)
    db.insert(projectTable)
      .values({ id: `project-${name.toLowerCase()}`, teamId: team.id, name })
      .run();
  for (const name of AGENTS)
    db.insert(agentTable)
      .values({
        id: `agent-${name.toLowerCase()}`,
        teamId: team.id,
        displayName: name,
        description: `${name} work for every project.`,
        provider: PROVIDER,
        modelId: MODEL_ID,
      })
      .run();
  const chiefRow = ensureChief(deps, team.id);
  const thread = coordinatorThreadRow(deps, chiefRow);
  const system = buildChiefSystemPrompt(deps, team.id, thread.id).text;
  const scope = { threadId: thread.id, userId: user.id, teamId: team.id };
  let clock = Date.parse('2026-10-01T00:00:00Z');
  const insertTurn = (turn: FixtureTurn) => {
    const rows: { id: string; role: 'user' | 'assistant'; content: unknown }[] = [
      { id: messageId(turn.n, 'user'), role: 'user', content: turn.user },
    ];
    turn.tools.forEach((tool, index) => {
      rows.push({
        id: toolMessageId(turn.n, index),
        role: 'assistant',
        content: { kind: 'toolcall', call: { name: tool.name, arguments: tool.arguments } },
      });
    });
    if (turn.reply !== '')
      rows.push({ id: messageId(turn.n, 'assistant'), role: 'assistant', content: turn.reply });
    for (const row of rows) {
      clock += 1000;
      db.insert(chiefMessage)
        .values({ ...row, threadId: thread.id, projectId: null, createdAt: clock })
        .run();
    }
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const { name, params } = JSON.parse(body) as {
          name: string;
          params: Record<string, unknown>;
        };
        const out =
          name === 'search_history'
            ? await searchHistory(db, scope, {
                query: String(params.query ?? ''),
                ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
                ...(typeof params.before === 'string' ? { before: params.before } : {}),
              })
            : readHistory(db, scope, (params.ids as string[]) ?? []);
        res.end(JSON.stringify(out));
      } catch (err) {
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  });
  return { db, system, server, insertTurn, threadId: thread.id };
}

function piUsage(input: number, total: number) {
  return {
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: total,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function writeSession(
  path: string,
  cwd: string,
  turns: readonly FixtureTurn[],
  preamble: string | null,
) {
  const lines: unknown[] = [];
  let parentId: string | null = null;
  let t = Date.parse('2026-10-01T00:00:00Z');
  let context = 0;
  const push = (message: Record<string, unknown>) => {
    const id = randomUUID().slice(0, 8);
    t += 1000;
    lines.push({
      type: 'message',
      id,
      parentId,
      timestamp: new Date(t).toISOString(),
      message: { ...message, timestamp: t },
    });
    parentId = id;
  };
  const assistant = (content: unknown[], stopReason: string, added: number) => {
    context += added;
    push({
      role: 'assistant',
      content,
      api: 'anthropic-messages',
      provider: PROVIDER,
      model: MODEL_ID,
      usage: piUsage(context, context),
      stopReason,
    });
  };
  lines.push({
    type: 'session',
    version: 3,
    id: randomUUID(),
    timestamp: new Date(t).toISOString(),
    cwd,
  });
  if (preamble !== null) {
    context += estimateTokens(preamble);
    push({ role: 'user', content: [{ type: 'text', text: preamble }] });
  }
  for (const turn of turns) {
    context += estimateTokens(turn.user);
    push({ role: 'user', content: [{ type: 'text', text: turn.user }] });
    for (const tool of turn.tools) {
      assistant(
        [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments }],
        'toolUse',
        estimateTokens(JSON.stringify(tool.arguments)),
      );
      context += estimateTokens(tool.result);
      push({
        role: 'toolResult',
        toolCallId: tool.id,
        toolName: tool.name,
        content: [{ type: 'text', text: tool.result }],
        isError: false,
      });
    }
    if (turn.reply !== '')
      assistant([{ type: 'text', text: turn.reply }], 'stop', estimateTokens(turn.reply));
  }
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

interface RunResult {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  requests: number;
  firstRequest: { input: number; cacheRead: number; cacheWrite: number } | null;
  ttftMs: number | null;
  wallMs: number;
  compactions: number;
  compactionMs: number;
  toolCalls: string[];
  calls: FixtureToolCall[];
  text: string;
  error: string | null;
}

function runPi(opts: {
  cwd: string;
  session: string;
  system: string;
  prompt: string;
  config: string;
}): Promise<RunResult> {
  const argv = [
    '-p',
    '--mode',
    'json',
    '--model',
    MODEL,
    '--thinking',
    args.thinking,
    '--session',
    opts.session,
    '--approve',
    '--no-extensions',
    '--no-skills',
    '--no-context-files',
    '--no-prompt-templates',
    '--no-mcp',
    '--no-themes',
    '--no-builtin-tools',
    '-e',
    EXTENSION,
    '--system-prompt',
    opts.system,
    opts.prompt,
  ];
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('pi', argv, {
      cwd: opts.cwd,
      env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0', SPIKE_TOOLS_CONFIG: opts.config },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r: RunResult = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
      requests: 0,
      firstRequest: null,
      ttftMs: null,
      wallMs: 0,
      compactions: 0,
      compactionMs: 0,
      toolCalls: [],
      calls: [],
      text: '',
      error: null,
    };
    let t0: number | null = null;
    let compactionStart = 0;
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const now = Date.now();
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (t0 === null) t0 = now;
      const type = ev.type as string;
      if (type === 'compaction_start') compactionStart = now;
      if (type === 'compaction_end') {
        r.compactions += 1;
        r.compactionMs += now - compactionStart;
      }
      if (type === 'tool_execution_start') {
        r.toolCalls.push(String(ev.toolName));
        r.calls.push({
          id: String(ev.toolCallId),
          name: String(ev.toolName),
          arguments: (ev.args ?? {}) as Record<string, unknown>,
          result: '',
        });
      }
      if (type === 'tool_execution_end') {
        const call = r.calls.find((c) => c.id === String(ev.toolCallId));
        const content = (ev.result as { content?: { type: string; text?: string }[] } | undefined)
          ?.content;
        if (call)
          call.result = (content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('');
      }
      if (type === 'message_update' && r.ttftMs === null) {
        const ame = ev.assistantMessageEvent as { type?: string } | undefined;
        if (ame?.type !== undefined && FIRST_TOKEN_EVENTS.has(ame.type)) r.ttftMs = now - t0;
      }
      if (type === 'message_end') {
        const msg = ev.message as {
          role?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            cost?: { total?: number };
          };
          content?: { type: string; text?: string }[];
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;
        r.requests += 1;
        r.firstRequest ??= {
          input: msg.usage?.input ?? 0,
          cacheRead: msg.usage?.cacheRead ?? 0,
          cacheWrite: msg.usage?.cacheWrite ?? 0,
        };
        r.input += msg.usage?.input ?? 0;
        r.output += msg.usage?.output ?? 0;
        r.cacheRead += msg.usage?.cacheRead ?? 0;
        r.cacheWrite += msg.usage?.cacheWrite ?? 0;
        r.costUsd += msg.usage?.cost?.total ?? 0;
        const text = (msg.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');
        if (text !== '') r.text = text;
        if (msg.stopReason === 'error') r.error = msg.errorMessage ?? 'error';
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      r.wallMs = Date.now() - started;
      if (code !== 0 && r.error === null) r.error = `pi exited ${code}: ${stderr.slice(-400)}`;
      resolve(r);
    });
  });
}

function compactionEntries(
  session: string,
): { firstKeptEntryId: string; tokensBefore: number; costUsd: number }[] {
  return readFileSync(session, 'utf8')
    .split('\n')
    .filter((l) => l.includes('"type":"compaction"'))
    .map(
      (l) =>
        JSON.parse(l) as {
          firstKeptEntryId: string;
          tokensBefore: number;
          usage?: { cost?: { total?: number } };
        },
    )
    .map((e) => ({
      firstKeptEntryId: e.firstKeptEntryId,
      tokensBefore: e.tokensBefore,
      costUsd: e.usage?.cost?.total ?? 0,
    }));
}

type World = ReturnType<typeof makeWorld>;

async function runArm(spec: ArmSpec) {
  const world = makeWorld();
  const rows: Record<string, unknown>[] = [];
  const systemTokens = estimateTokens(world.system);
  await new Promise<void>((resolve) => world.server.listen(0, '127.0.0.1', resolve));
  try {
    const summary = await driveArm(spec, world, rows);
    return { spec, rows, summary, systemTokens, error: null };
  } catch (err) {
    return { spec, rows, summary: null, systemTokens, error: String(err) };
  } finally {
    world.server.close();
  }
}

async function driveArm(spec: ArmSpec, world: World, rows: Record<string, unknown>[]) {
  const fixture = buildFixture();
  const address = world.server.address();
  const historyUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  const dir = mkdtempSync(join(tmpdir(), `spike2522-${spec.name}-`));
  mkdirSync(join(dir, '.pi'));
  writeFileSync(join(dir, '.pi', 'settings.json'), JSON.stringify({ compaction: spec.compaction }));
  const configs = Object.fromEntries(
    [true, false].map((history) => {
      const path = join(dir, `tools-${history ? 'with' : 'without'}-history.json`);
      writeFileSync(
        path,
        JSON.stringify({
          history,
          historyUrl,
          tools: CHIEF_REMOTE_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        }),
      );
      return [String(history), path];
    }),
  ) as Record<'true' | 'false', string>;
  const conversation: FixtureTurn[] = fixture.slice(0, SEEDED_TURNS);
  for (const turn of conversation) world.insertTurn(turn);
  const resumeSession = join(dir, 'resume.jsonl');
  if (spec.mode === 'resume') writeSession(resumeSession, dir, conversation, null);
  const freshSession = (n: number, label: string) => {
    const out = assemble(conversation, { inputBudget: INPUT_BUDGET, align: spec.align });
    const path = join(dir, `fresh-${n}-${label}.jsonl`);
    writeSession(path, dir, out.recent, out.index);
    return { path, firstRecent: out.recent[0]?.n ?? null, recentTokens: out.recentTokens };
  };
  const record = (n: number, kind: string, result: RunResult, extra: Record<string, unknown>) => {
    spentUsd += result.costUsd;
    world.db
      .insert(chiefTurnUsage)
      .values({
        stepId: `${spec.name}-${n}-${kind}`,
        threadId: world.threadId,
        model: MODEL,
        input: result.input,
        output: result.output,
        cacheRead: result.cacheRead,
        cacheWrite: result.cacheWrite,
        ttftMs: result.ttftMs,
        createdAt: Date.now(),
      })
      .run();
    const row = { arm: spec.name, turn: n, kind, ...result, ...extra };
    rows.push(row);
    console.log(
      `${spec.name} t${n} ${kind} in=${result.input} cr=${result.cacheRead} cw=${result.cacheWrite} ttft=${result.ttftMs} comp=${result.compactions} $${result.costUsd.toFixed(4)} total$${spentUsd.toFixed(3)}${result.error ? ` ERR ${result.error}` : ''}`,
    );
    return row;
  };
  let compactionsSeen = 0;
  for (let i = 0; i < LIVE_TURNS; i += 1) {
    if (spentUsd > BUDGET_USD) throw new Error(`budget ${BUDGET_USD} USD reached at ${spentUsd}`);
    const turn = fixture[SEEDED_TURNS + i] as FixtureTurn;
    let session = resumeSession;
    let extra: Record<string, unknown> = {};
    if (spec.mode === 'fresh') {
      const fresh = freshSession(turn.n, 'live');
      session = fresh.path;
      extra = { firstRecentTurn: fresh.firstRecent, recentTokens: fresh.recentTokens };
    }
    const result = await runPi({
      cwd: dir,
      session,
      system: world.system,
      prompt: turn.user,
      config: configs.true,
    });
    if (spec.mode === 'resume') {
      const entries = compactionEntries(resumeSession);
      const added = entries.slice(compactionsSeen);
      compactionsSeen = entries.length;
      const compactionCostUsd = added.reduce((sum, e) => sum + e.costUsd, 0);
      spentUsd += compactionCostUsd;
      extra = { compactionEntries: added, compactionCostUsd };
    }
    record(turn.n, 'live', result, extra);
    if (result.error !== null) throw new Error(`${spec.name} turn ${turn.n}: ${result.error}`);
    const live = { n: turn.n, user: turn.user, tools: result.calls, reply: result.text };
    conversation.push(live);
    world.insertTurn(live);
  }
  for (const history of [true, false]) {
    let session: string;
    let extra: Record<string, unknown> = { history };
    if (spec.mode === 'resume') {
      session = join(dir, `recall-${history}.jsonl`);
      copyFileSync(resumeSession, session);
    } else {
      const fresh = freshSession(RECALL_TURN, `recall-${history}`);
      session = fresh.path;
      extra = { ...extra, firstRecentTurn: fresh.firstRecent, recentTokens: fresh.recentTokens };
    }
    const result = await runPi({
      cwd: dir,
      session,
      system: world.system,
      prompt: RECALL_QUESTION,
      config: configs[String(history) as 'true' | 'false'],
    });
    record(
      RECALL_TURN,
      history ? 'recall-with-history-tools' : 'recall-without-history-tools',
      result,
      {
        ...extra,
        recalled: recalled(result.text),
      },
    );
    if (result.error !== null) throw new Error(`${spec.name} recall: ${result.error}`);
  }
  const summary = world.db
    .select({
      turns: sql<number>`count(*)`,
      input: sql<number>`sum(${chiefTurnUsage.input})`,
      cacheRead: sql<number>`sum(${chiefTurnUsage.cacheRead})`,
      cacheWrite: sql<number>`sum(${chiefTurnUsage.cacheWrite})`,
    })
    .from(chiefTurnUsage)
    .where(sql`${chiefTurnUsage.stepId} like ${`${spec.name}-%-live`}`)
    .get();
  return summary;
}

async function main() {
  const selected = args.arms.split(',').map((key) => {
    const spec = ARMS[key];
    if (spec === undefined) throw new Error(`unknown arm ${key}`);
    return spec;
  });
  mkdirSync(args.out, { recursive: true });
  const results = await Promise.all(selected.map(runArm));
  const summary = results.map((res) => {
    if (res.error !== null) console.error(`${res.spec.name} failed: ${res.error}`);
    writeFileSync(
      join(args.out, `${res.spec.name}.jsonl`),
      `${res.rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    );
    return {
      arm: res.spec.name,
      spec: res.spec,
      systemTokensEstimate: res.systemTokens,
      error: res.error,
      ...res.summary,
    };
  });
  writeFileSync(
    join(args.out, 'summary.json'),
    `${JSON.stringify({ model: MODEL, thinking: args.thinking, inputBudget: INPUT_BUDGET, spentUsd, arms: summary }, null, 2)}\n`,
  );
  console.log(`spent ${spentUsd.toFixed(4)} USD`);
}

await main();
