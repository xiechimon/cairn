import { eq } from 'drizzle-orm';
import { chiefMessage } from '../../../apps/server/src/db/schema.js';
import {
  bootStack,
  driveTurn,
  type RosterAgent,
  relayBaseUrl,
  relayKey,
  type SeededWorld,
  type Stack,
  seedWorld,
  type TurnEvidence,
} from '../chief-dispatch/stack.mts';
import { gradePlanRevisionCase, type PlanRevisionArm, type PlanRevisionCase } from './grade.mts';
import { readPlanTodos, seedPriorPlan } from './seed.mts';

export interface PlanRevisionRun {
  output: string;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  evidence: TurnEvidence;
  truncated: boolean;
  agentIds: Record<string, string>;
  projectIds: Record<string, string>;
  grade: { grade: Record<string, number>; explanation: Record<string, string> };
  arm: PlanRevisionArm;
  feedbackSeen: boolean;
  threadId: string;
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

export function revisionPrompt(input: PlanRevisionCase, arm: PlanRevisionArm): string {
  const board =
    'The project board already holds the current plan cards. Revise those cards in place (update or replace them) so the plan is correct.';
  if (arm === 'feedback') {
    return `${board}\n\nRejection feedback: ${input.feedback}\n\nTicket: ${input.prompt}`;
  }
  return `${board}\n\nTicket: ${input.prompt}`;
}

async function withWorld<T>(
  roster: RosterAgent[],
  model: string,
  body: (ctx: { stack: Stack; world: SeededWorld }) => Promise<T>,
): Promise<T> {
  const stack = await bootStack();
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

function userTextContainsFeedback(stack: Stack, threadId: string, feedback: string): boolean {
  const rows = stack.server.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all();
  const needle = feedback.toLowerCase();
  return rows.some((row) => {
    if (row.role !== 'user') return false;
    const blob = JSON.stringify(row.content).toLowerCase();
    return blob.includes(needle);
  });
}

export async function runPlanRevisionCase(
  input: PlanRevisionCase,
  opts: {
    arm: PlanRevisionArm;
    roster: RosterAgent[];
    model: string;
    timeoutMs: number;
  },
): Promise<PlanRevisionRun> {
  return withWorld(opts.roster, opts.model, async ({ stack, world }) => {
    await seedPriorPlan(stack, world.projectId, input.priorPlan);
    const evidence = await driveTurn(stack, revisionPrompt(input, opts.arm), {
      timeoutMs: opts.timeoutMs,
    });
    deadTurn(evidence);
    const todos = readPlanTodos(stack, world.projectId);
    const grade = gradePlanRevisionCase(input, { evidence, todos });
    const feedbackSeen =
      opts.arm === 'feedback' && userTextContainsFeedback(stack, evidence.threadId, input.feedback);
    const truncated =
      evidence.toolCalls.length === 0 &&
      evidence.assistantText === '' &&
      evidence.stepStatus === 'done';
    return {
      output: evidence.assistantText,
      model: evidence.model,
      usage: { input_tokens: evidence.usage.input, output_tokens: evidence.usage.output },
      stop_reason: truncated ? 'length' : evidence.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      evidence: {
        ...evidence,
        createdTodoRows: todos.map((row) => ({
          id: row.id,
          title: row.title,
          spec: row.spec,
          projectId: world.projectId,
          buildAgentId: null,
          planAgentId: null,
          phase: 'todo',
        })),
        createdTodoIds: todos.map((row) => row.id),
      },
      truncated,
      agentIds: world.agentIds,
      projectIds: { 'eval-project': world.projectId },
      grade,
      arm: opts.arm,
      feedbackSeen,
      threadId: evidence.threadId,
    };
  });
}
