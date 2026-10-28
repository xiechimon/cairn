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
  gradePlanRevisionCase,
  gradePlanRevisionPair,
  isPlanRevisionCase,
  type PlanCase,
  type PlanTodoRow,
} from './grade.mts';
import { feedbackPresentInDb, readFinalTodos, seedPriorPlan } from './seed.mts';

export type PlanRevisionArm = 'all' | 'feedback' | 'control';

export interface PlanRevisionStage {
  name: 'initial' | 'rejection' | 'revision';
  evidence: TurnEvidence;
}

export interface PlanRevisionArmResult {
  threadId: string;
  home: string;
  seededTodos: PlanTodoRow[];
  finalTodos: PlanTodoRow[];
  stages: PlanRevisionStage[];
  feedbackPresentInDb: boolean;
  evidence: TurnEvidence;
  grade: { grade: Record<string, number>; explanation: Record<string, string> };
}

export interface PlanRevisionRun {
  feedback?: PlanRevisionArmResult;
  control?: PlanRevisionArmResult;
  grade: { grade: Record<string, number>; explanation: Record<string, string> };
  evidence: TurnEvidence;
  output: string;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  truncated: boolean;
  agentIds: Record<string, string>;
}

export function planRevisionHarnessError(message: string): Error & { failure_class: string } {
  const error = new Error(message) as Error & { failure_class: string };
  error.failure_class = 'harness_error';
  return error;
}

function deadTurn(evidence: TurnEvidence): void {
  if (
    (evidence.usage.input === 0 && evidence.usage.output === 0) ||
    evidence.stepStatus !== 'done'
  ) {
    throw planRevisionHarnessError(
      `turn did not finish: step=${evidence.stepStatus} usage=${evidence.usage.input}/${evidence.usage.output}`,
    );
  }
}

function forceMissingArm(): 'feedback' | 'control' | null {
  const raw = process.env.CAIRN_PLAN_REVISION_FORCE_MISSING_ARM;
  if (raw === 'feedback' || raw === 'control') return raw;
  return null;
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

async function runOneArm(
  input: PlanCase,
  opts: {
    roster: RosterAgent[];
    model: string;
    timeoutMs: number;
    deliverFeedback: boolean;
  },
): Promise<PlanRevisionArmResult> {
  if (!isPlanRevisionCase(input) || input.priorPlan === undefined || input.feedback === undefined) {
    throw planRevisionHarnessError(`case ${input.id} is not a revision case`);
  }
  const priorPlan = input.priorPlan;
  const feedbackText = input.feedback;
  const revisionPrompt = input.revisionPrompt ?? 'Revise the plan based on the feedback.';
  return withWorld(opts.roster, opts.model, async ({ stack, world }) => {
    const seededTodos = await seedPriorPlan(stack, world, priorPlan);
    const stages: PlanRevisionStage[] = [];
    const initial = await driveTurn(stack, input.prompt, {
      timeoutMs: opts.timeoutMs,
      projectId: world.projectId,
    });
    deadTurn(initial);
    stages.push({ name: 'initial', evidence: initial });
    let head = initial;
    if (opts.deliverFeedback) {
      const rejection = await driveFollowUp(stack, initial.threadId, feedbackText, {
        timeoutMs: opts.timeoutMs,
      });
      deadTurn(rejection);
      stages.push({ name: 'rejection', evidence: rejection });
      head = rejection;
    }
    const revision = await driveFollowUp(stack, head.threadId, revisionPrompt, {
      timeoutMs: opts.timeoutMs,
    });
    deadTurn(revision);
    stages.push({ name: 'revision', evidence: revision });
    const finalTodos = readFinalTodos(stack);
    const present = feedbackPresentInDb(stack, feedbackText);
    if (opts.deliverFeedback && !present) {
      throw planRevisionHarnessError(`feedback arm missing feedback message for ${input.id}`);
    }
    if (!opts.deliverFeedback && present) {
      throw planRevisionHarnessError(`control arm leaked feedback for ${input.id}`);
    }
    const grade = gradePlanRevisionCase(input, {
      stepStatus: revision.stepStatus,
      feedbackDelivered: true,
      finalTodos,
    });
    return {
      threadId: initial.threadId,
      home: stack.home,
      seededTodos,
      finalTodos,
      stages,
      feedbackPresentInDb: present,
      evidence: revision,
      grade,
    };
  });
}

export async function runPlanRevisionCase(
  input: PlanCase,
  opts: {
    roster: RosterAgent[];
    model: string;
    timeoutMs: number;
    arms?: PlanRevisionArm;
    controlStubMode?: string;
  },
): Promise<PlanRevisionRun> {
  void opts.controlStubMode;
  const arms = opts.arms ?? 'all';
  const missing = forceMissingArm();
  let feedback: PlanRevisionArmResult | undefined;
  let control: PlanRevisionArmResult | undefined;

  if (arms === 'all' || arms === 'feedback') {
    if (missing === 'feedback') throw planRevisionHarnessError('missing feedback arm');
    feedback = await runOneArm(input, {
      roster: opts.roster,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
      deliverFeedback: true,
    });
  }
  if (arms === 'all' || arms === 'control') {
    if (missing === 'control') throw planRevisionHarnessError('missing control arm');
    control = await runOneArm(input, {
      roster: opts.roster,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
      deliverFeedback: false,
    });
  }

  if (arms === 'all') {
    if (feedback === undefined || control === undefined)
      throw planRevisionHarnessError('paired revision requires both arms');
  } else if (arms === 'feedback' && feedback === undefined) {
    throw planRevisionHarnessError('missing feedback arm');
  } else if (arms === 'control' && control === undefined) {
    throw planRevisionHarnessError('missing control arm');
  }

  let grade: { grade: Record<string, number>; explanation: Record<string, string> };
  if (feedback !== undefined && control !== undefined) {
    grade = gradePlanRevisionPair({ feedback: feedback.grade, control: control.grade });
  } else if (feedback !== undefined) {
    grade = {
      grade: {
        revision_ok: feedback.grade.grade.revision_ok ?? 0,
        nofeedback_ok: 0,
        plan_ok: feedback.grade.grade.revision_ok ?? 0,
      },
      explanation: {
        revision_ok: feedback.grade.explanation.revision_ok ?? '',
        nofeedback_ok: 'control arm not run',
        plan_ok: feedback.grade.explanation.revision_ok ?? '',
      },
    };
  } else if (control !== undefined) {
    grade = {
      grade: {
        revision_ok: 0,
        nofeedback_ok: control.grade.grade.revision_ok ?? 0,
        plan_ok: 0,
      },
      explanation: {
        revision_ok: 'feedback arm not run',
        nofeedback_ok: control.grade.explanation.revision_ok ?? '',
        plan_ok: 'feedback arm not run',
      },
    };
  } else {
    throw planRevisionHarnessError('no revision arm produced evidence');
  }

  const headline = feedback?.evidence ?? control?.evidence;
  if (headline === undefined) throw planRevisionHarnessError('no revision arm produced evidence');
  const usage = {
    input_tokens: (feedback?.evidence.usage.input ?? 0) + (control?.evidence.usage.input ?? 0),
    output_tokens: (feedback?.evidence.usage.output ?? 0) + (control?.evidence.usage.output ?? 0),
  };
  return {
    feedback,
    control,
    grade,
    evidence: headline,
    output: headline.assistantText,
    model: headline.model,
    usage,
    stop_reason: headline.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    truncated: false,
    agentIds: {},
  };
}
