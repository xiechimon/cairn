import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AgentTokenUsage, SessionOpts } from '@cairn/shared';
import { createPiBackend } from '../../../apps/daemon/src/backend/pi.js';
import { CHIEF_COMPACTION } from '../../../apps/server/src/services/chief-compaction.js';
import { turnTokens } from './assemble.mts';
import { buildFixture } from './fixture.mts';
import { writeSession } from './session-seed.mts';

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic/claude-haiku-5-5' },
    thinking: { type: 'string', default: 'low' },
    seedTokens: { type: 'string', default: '72000' },
    budgetUsd: { type: 'string', default: '2' },
    out: { type: 'string', default: '../docs/verify/2522/idle-compaction' },
  },
});
const [PROVIDER, MODEL_ID] = [
  args.model.split('/')[0] as string,
  args.model.split('/').slice(1).join('/'),
];
const BUDGET_USD = Number(args.budgetUsd);
const QUESTIONS = [
  'Quick status: is anything blocked right now? Answer in one sentence.',
  'Which host runs the Kestrel billing migration? One line.',
];

let spentUsd = 0;
const costOf = (usage: AgentTokenUsage): number =>
  usage.reduce((sum, u) => sum + (u.cost?.total ?? 0), 0);

function charge(usage: AgentTokenUsage): void {
  spentUsd += costOf(usage);
  if (spentUsd > BUDGET_USD) throw new Error(`budget ${BUDGET_USD} USD reached at ${spentUsd}`);
}

function seededTurns() {
  const target = Number(args.seedTokens);
  const turns = [];
  let tokens = 0;
  for (const turn of buildFixture()) {
    if (tokens >= target) break;
    turns.push(turn);
    tokens += turnTokens(turn);
  }
  return { turns, tokens };
}

function world(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `idle2522-${name}-`));
  const agentDir = join(dir, 'agent');
  mkdirSync(agentDir, { recursive: true });
  symlinkSync(join(homedir(), '.pi', 'agent', 'auth.json'), join(agentDir, 'auth.json'));
  const sessionFile = join(dir, 'coordinator.jsonl');
  const seed = seededTurns();
  writeSession(sessionFile, dir, seed.turns, null, { provider: PROVIDER, id: MODEL_ID });
  const backend = createPiBackend({
    agentDir,
    sessionDir: join(dir, 'sessions'),
    resolveSessionFile: () => sessionFile,
  });
  const opts = (prompt?: string): SessionOpts => ({
    provider: { kind: 'api_key', providerId: PROVIDER },
    modelId: MODEL_ID,
    thinkingLevel: args.thinking,
    cwd: dir,
    compaction: CHIEF_COMPACTION,
    ...(prompt !== undefined ? { prompt } : {}),
  });
  return { dir, backend, opts, seed };
}

async function userTurn(w: ReturnType<typeof world>, prompt: string) {
  const sentAt = performance.now();
  const handle = await w.backend.continueSession('coordinator', w.opts(prompt));
  let compactionMs = 0;
  let compactionStart = 0;
  let text = '';
  for await (const ev of handle.events) {
    if (ev.type === 'compaction_start') compactionStart = performance.now();
    if (ev.type === 'compaction_end') compactionMs += performance.now() - compactionStart;
    if (ev.type === 'text_delta') text += ev.text;
    if (ev.type === 'error') throw new Error(ev.error.message);
  }
  const usage = handle.usage();
  charge(usage);
  const main = usage.find((u) => u.ttftMs !== undefined) ?? usage[0];
  return {
    ttftMs: main?.ttftMs ?? null,
    wallMs: Math.round(performance.now() - sentAt),
    inTurnCompactionMs: Math.round(compactionMs),
    contextTokens: main?.contextTokens ?? null,
    input: main?.input ?? 0,
    cacheRead: main?.cacheRead ?? 0,
    cacheWrite: main?.cacheWrite ?? 0,
    costUsd: costOf(usage),
    reply: text.slice(0, 160),
  };
}

async function arm(name: 'in-turn' | 'idle') {
  const w = world(name);
  const rows: Record<string, unknown>[] = [];
  try {
    if (name === 'idle') {
      const started = performance.now();
      const result = await w.backend.compactSession?.(
        'coordinator',
        w.opts(),
        new AbortController().signal,
      );
      if (result === undefined) throw new Error('pi backend has no compactSession');
      charge(result.usage);
      rows.push({
        arm: name,
        kind: 'idle-compaction',
        wallMs: Math.round(performance.now() - started),
        compacted: result.compacted,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        summaryTokens: result.summaryTokens,
        costUsd: costOf(result.usage),
      });
      console.log(JSON.stringify(rows.at(-1)));
    }
    for (const [index, question] of QUESTIONS.entries()) {
      const row = {
        arm: name,
        kind: 'user-turn',
        turn: index + 1,
        ...(await userTurn(w, question)),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
    return { name, seedTurns: w.seed.turns.length, seedTokensEstimate: w.seed.tokens, rows };
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
}

async function main() {
  const results = [];
  for (const name of ['in-turn', 'idle'] as const) results.push(await arm(name));
  mkdirSync(args.out, { recursive: true });
  writeFileSync(
    join(args.out, 'idle-compaction.json'),
    `${JSON.stringify(
      {
        model: args.model,
        thinking: args.thinking,
        compaction: CHIEF_COMPACTION,
        spentUsd: Number(spentUsd.toFixed(4)),
        measuredAt: new Date().toISOString(),
        arms: results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`spent ${spentUsd.toFixed(4)} USD`);
}

await main();
