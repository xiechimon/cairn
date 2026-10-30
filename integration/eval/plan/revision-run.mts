import type { PromptSet } from '../chief-dispatch/prompt-set.mts';
import {
  bootStack,
  disposeLeftovers,
  type RosterAgent,
  relayBaseUrl,
  relayKey,
  resetTurnState,
  type SeededWorld,
  type Stack,
  seedWorld,
  type TurnEvidence,
} from '../chief-dispatch/stack.mts';
import {
  createPlanningBuild,
  driveRevisionTurn,
  type PlanRevisionArmResult,
  seedPriorPlan,
} from './revision-arm.mts';
import {
  gradeRevisionCase,
  type RevisionCase,
  type RevisionPairArtifacts,
} from './revision-grade.mts';

export interface RevisionArmRun extends PlanRevisionArmResult {
  arm: 'feedback' | 'no-feedback';
  error: string | null;
}

export interface RevisionRun {
  caseId: string;
  model: string;
  feedbackArm: RevisionArmRun;
  controlArm: RevisionArmRun;
  usage: { input_tokens: number; output_tokens: number };
  grade: { grade: Record<string, number>; explanation: Record<string, string> };
}

const PLAN_TASK_SPEC = {
  title: 'Fix the Safari export download',
  spec: 'The export button does nothing on Safari. Ship it with a regression test.',
};

async function withWorld<T>(
  opts: { roster: RosterAgent[]; model: string; promptSet?: PromptSet },
  body: (ctx: { stack: Stack; world: SeededWorld }) => Promise<T>,
): Promise<T> {
  const stack = await bootStack(opts.promptSet !== undefined ? { promptSet: opts.promptSet } : {});
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: relayBaseUrl(),
      relayKey: relayKey(),
      roster: opts.roster,
      chiefModelId: opts.model,
    });
    resetTurnState(stack);
    return await body({ stack, world });
  } finally {
    await stack.close();
    disposeLeftovers();
  }
}

async function runArm(
  input: RevisionCase,
  arm: 'feedback' | 'no-feedback',
  opts: { roster: RosterAgent[]; model: string; timeoutMs: number; promptSet?: PromptSet },
): Promise<RevisionArmRun> {
  return withWorld(opts, async ({ stack, world }) => {
    const { buildId } = await createPlanningBuild(stack, world, PLAN_TASK_SPEC);
    await seedPriorPlan(stack, {
      projectId: world.projectId,
      buildId,
      priorPlan: input.priorPlan,
    });
    try {
      const result = await driveRevisionTurn(stack, {
        projectId: world.projectId,
        buildId,
        arms: { priorPlan: input.priorPlan, feedback: input.feedback },
        timeoutMs: opts.timeoutMs,
        withholdFeedback: arm === 'no-feedback',
      });
      return { ...result, arm, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw harnessFailure(input.id, arm, message);
    }
  });
}

function harnessFailure(caseId: string, arm: string, message: string): Error {
  const error = new Error(`plan revision ${caseId}/${arm}: ${message}`) as Error & {
    failure_class?: string;
  };
  error.failure_class = 'harness_error';
  return error;
}

function requireExecuted(run: RevisionArmRun): RevisionArmRun {
  if (run.error !== null) throw harnessFailure(run.arm, run.arm, run.error);
  if (run.revision.stepStatus !== 'done') {
    throw harnessFailure(run.arm, run.arm, `revision step ended ${run.revision.stepStatus}`);
  }
  const spent = run.revision.usage.input + run.revision.usage.output;
  if (spent === 0) throw harnessFailure(run.arm, run.arm, 'revision turn recorded no usage');
  return run;
}

export async function runRevisionCase(
  input: RevisionCase,
  opts: {
    roster: RosterAgent[];
    model: string;
    timeoutMs: number;
    promptSet?: PromptSet;
  },
): Promise<RevisionRun> {
  const feedbackArm = requireExecuted(await runArm(input, 'feedback', opts));
  const controlArm = requireExecuted(await runArm(input, 'no-feedback', opts));
  const artifacts: RevisionPairArtifacts = {
    feedbackArm: {
      planContent: feedbackArm.revision.planContent,
      stepStatus: feedbackArm.revision.stepStatus,
    },
    controlArm: {
      planContent: controlArm.revision.planContent,
      stepStatus: controlArm.revision.stepStatus,
    },
  };
  const grade = gradeRevisionCase(input, artifacts);
  const usage = (arm: RevisionArmRun) => ({
    input: arm.revision.usage.input,
    output: arm.revision.usage.output,
  });
  const a = usage(feedbackArm);
  const b = usage(controlArm);
  return {
    caseId: input.id,
    model: opts.model,
    feedbackArm,
    controlArm,
    usage: { input_tokens: a.input + b.input, output_tokens: a.output + b.output },
    grade,
  };
}

function armLines(arm: RevisionArmRun): string[] {
  const lines = [
    `[${arm.arm}] rejection: prior plan v${arm.rejection.priorPlanVersion}, phase=${arm.rejection.phase}, step=${arm.rejection.stepStatus}`,
    `[${arm.arm}] revision: versions=${arm.revision.planVersions.join('->')} step=${arm.revision.stepStatus} ` +
      `usage=${arm.revision.usage.input}in/${arm.revision.usage.output}out ` +
      `${(arm.revision.wallMs / 1000).toFixed(1)}s`,
  ];
  const prompt = arm.revision.prompt?.trim() ?? '';
  if (prompt !== '') lines.push(`[${arm.arm}] replan prompt: ${prompt}`);
  const plan = arm.revision.planContent?.trim() ?? '';
  lines.push(`[${arm.arm}] final plan artifact:`);
  lines.push(plan === '' ? '(none)' : plan);
  return lines;
}

export function revisionRunRecord(run: RevisionRun): { role: string; content: string }[] {
  return [
    { role: 'revision-stage', content: armLines(run.feedbackArm).join('\n') },
    { role: 'revision-stage', content: armLines(run.controlArm).join('\n') },
    {
      role: 'revision-grade',
      content: Object.entries(run.grade.explanation)
        .map(([k, v]) => `${k}=${run.grade.grade[k]} (${v})`)
        .join('\n'),
    },
  ];
}

export function revisionEvidence(run: RevisionRun): TurnEvidence {
  const feedbackArm = run.feedbackArm.revision;
  const usage = {
    input: run.feedbackArm.revision.usage.input + run.controlArm.revision.usage.input,
    output: run.feedbackArm.revision.usage.output + run.controlArm.revision.usage.output,
    cacheRead: run.feedbackArm.revision.usage.cacheRead + run.controlArm.revision.usage.cacheRead,
    cacheWrite:
      run.feedbackArm.revision.usage.cacheWrite + run.controlArm.revision.usage.cacheWrite,
  };
  return {
    threadId: run.caseId,
    stepStatus: feedbackArm.stepStatus,
    toolCalls: [],
    runBuildsArgs: [],
    assistantText: feedbackArm.planContent ?? '',
    createdTodoIds: [],
    createdTodoRows: [],
    buildRows: [],
    model: run.model,
    usage,
    wallMs: run.feedbackArm.revision.wallMs + run.controlArm.revision.wallMs,
  };
}
