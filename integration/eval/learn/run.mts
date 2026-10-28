import type { ExperienceCandidate } from '@cairn/shared';
import { reflectPacks } from '../../../apps/server/src/trajectory-reflect.js';
import type { PromptSet } from '../chief-dispatch/prompt-set.mts';
import {
  bootStack,
  driveFollowUp,
  driveTurn,
  type RosterAgent,
  relayBaseUrl,
  relayKey,
  type SeededWorld,
  type Stack,
  seedWorld,
  type TurnEvidence,
} from '../chief-dispatch/stack.mts';
import {
  gradeLearnDecision,
  gradeMemorySaved,
  gradeReflectCandidates,
  type LearnArm,
  type LearnCase,
  learnGradeRecord,
} from './grade.mts';
import { readLearnMemories, seedOracleMemory } from './memory.mts';
import { buildLearnPack } from './pack.mts';

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LearnRun {
  output: string;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  evidence: TurnEvidence;
  truncated: boolean;
  agentIds: Record<string, string>;
  grade: { grade: Record<string, number>; explanation: Record<string, string> };
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function plusUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

function finishedTurn(evidence: TurnEvidence | null, id: string): TurnEvidence {
  if (evidence === null) throw new Error(`learn case ${id} produced no turn`);
  return evidence;
}

function deadTurn(evidence: TurnEvidence): void {
  if (
    (evidence.usage.input === 0 && evidence.usage.output === 0) ||
    evidence.stepStatus !== 'done'
  ) {
    const error = new Error(
      `turn did not finish: step=${evidence.stepStatus} usage=${evidence.usage.input}/${evidence.usage.output}`,
    ) as Error & { failure_class?: string };
    error.failure_class = 'harness_error';
    throw error;
  }
}

export function reflectEndpointFromEnv(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.CAIRN_REFLECTOR_BASE_URL || process.env.CAIRN_EVAL_RELAY_URL;
  const apiKey = process.env.CAIRN_REFLECTOR_API_KEY || process.env.CAIRN_EVAL_RELAY_KEY;
  if (!baseUrl || !apiKey)
    throw new Error(
      'reflector endpoint missing: set CAIRN_EVAL_RELAY_URL and CAIRN_EVAL_RELAY_KEY',
    );
  return { baseUrl, apiKey };
}

async function withWorld<T>(
  roster: RosterAgent[],
  model: string,
  opts: { promptSet?: PromptSet },
  body: (ctx: { stack: Stack; world: SeededWorld }) => Promise<T>,
): Promise<T> {
  const stack = await bootStack({ promptSet: opts.promptSet });
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: relayBaseUrl(),
      relayKey: relayKey(),
      roster,
      chiefModelId: model,
    });
    return await body({ stack, world });
  } finally {
    await stack.close();
  }
}

function round1Text(evidence: TurnEvidence): string {
  const specs = evidence.createdTodoRows.map((row) => `${row.title}\n${row.spec}`).join('\n');
  return specs.trim() !== '' ? specs : evidence.assistantText;
}

async function reflectRound(
  input: LearnCase,
  round1: TurnEvidence,
  agentId: string,
  model: string,
): Promise<{ factOk: boolean; wrong: boolean; whyFact: string; whyWrong: string }> {
  const pack = buildLearnPack(input, {
    text: round1Text(round1),
    model: round1.model ?? model,
    agentId,
    buildId: `learn-${input.id}`,
  });
  const reflected = await reflectPacks([JSON.stringify(pack)], {
    model,
    endpoint: reflectEndpointFromEnv(),
    now: () => Date.now(),
  });
  const candidates = reflected.lines.map((line) => {
    const row = JSON.parse(line) as Pick<ExperienceCandidate, 'title' | 'content'>;
    return { title: row.title, content: row.content };
  });
  return gradeReflectCandidates(input, candidates);
}

export async function runLearnCase(
  input: LearnCase,
  opts: {
    arm: LearnArm;
    roster: RosterAgent[];
    model: string;
    timeoutMs: number;
    promptSet?: PromptSet;
  },
): Promise<LearnRun> {
  if (opts.arm === 'all' || opts.arm === 'reflect') reflectEndpointFromEnv();
  const timeoutMs = opts.timeoutMs;
  let usage = zeroUsage();
  let wallMs = 0;
  let headline: TurnEvidence | null = null;
  let agentIds: Record<string, string> = {};
  const absorb = (evidence: TurnEvidence) => {
    usage = plusUsage(usage, evidence.usage);
    wallMs += evidence.wallMs;
  };

  const noMemory =
    opts.arm === 'all' || opts.arm === 'no-memory'
      ? await withWorld(opts.roster, opts.model, opts, async ({ stack, world }) => {
          agentIds = world.agentIds;
          const evidence = await driveTurn(stack, input.round2, { timeoutMs });
          deadTurn(evidence);
          absorb(evidence);
          headline = evidence;
          return gradeLearnDecision(input, evidence);
        })
      : undefined;

  const oracle =
    opts.arm === 'all' || opts.arm === 'oracle'
      ? await withWorld(opts.roster, opts.model, opts, async ({ stack, world }) => {
          agentIds = world.agentIds;
          seedOracleMemory(stack.server, world, input);
          const evidence = await driveTurn(stack, input.round2, { timeoutMs });
          deadTurn(evidence);
          absorb(evidence);
          headline = evidence;
          return gradeLearnDecision(input, evidence);
        })
      : undefined;

  let correctionDecision: ReturnType<typeof gradeLearnDecision> | undefined;
  let memorySaved: ReturnType<typeof gradeMemorySaved> | undefined;
  let round1: TurnEvidence | undefined;
  let reflectAgentId = '';
  if (opts.arm === 'all' || opts.arm === 'correction' || opts.arm === 'reflect') {
    await withWorld(opts.roster, opts.model, opts, async ({ stack, world }) => {
      agentIds = world.agentIds;
      reflectAgentId = world.chiefAgentId;
      const first = await driveTurn(stack, input.round1, { timeoutMs });
      deadTurn(first);
      absorb(first);
      round1 = first;
      headline = first;
      if (opts.arm === 'reflect') return;
      const follow = await driveFollowUp(stack, first.threadId, input.correction, { timeoutMs });
      deadTurn(follow);
      absorb(follow);
      memorySaved = gradeMemorySaved(
        input,
        readLearnMemories(stack.server, world.chiefAgentId),
        world.projectId,
      );
      const second = await driveTurn(stack, input.round2, { timeoutMs });
      deadTurn(second);
      absorb(second);
      headline = second;
      correctionDecision = gradeLearnDecision(input, second);
    });
  }

  let reflect: Awaited<ReturnType<typeof reflectRound>> | undefined;
  if (opts.arm === 'all' || opts.arm === 'reflect') {
    if (round1 === undefined) throw new Error(`learn case ${input.id} has no round 1`);
    reflect = await reflectRound(input, round1, reflectAgentId, opts.model);
  }

  const graded = learnGradeRecord({
    arm: opts.arm,
    noMemory,
    correctionDecision,
    memorySaved,
    oracle,
    reflect,
  });
  const scored: TurnEvidence = {
    ...finishedTurn(headline, input.id),
    usage,
    wallMs,
  };
  const truncated =
    scored.toolCalls.length === 0 && scored.assistantText === '' && scored.stepStatus === 'done';
  return {
    output: scored.assistantText,
    model: scored.model,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
    stop_reason: truncated ? 'length' : scored.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    evidence: scored,
    truncated,
    agentIds,
    grade: graded,
  };
}
