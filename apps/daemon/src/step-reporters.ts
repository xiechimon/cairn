import { errorMessage } from '@cairn/shared';
import { type ActivityTracker, createActivityTracker } from './activity.js';
import { AgentTodoReporter } from './agent-todo.js';
import type { MachineApi } from './machine-client.js';

export interface StepReportersInput {
  stepId: string;
  client: () => MachineApi;
  log: (line: string) => void;
  now?: () => number;
}

export interface StepReporters {
  activity: ActivityTracker;
  agentTodo: AgentTodoReporter;
}

export function createStepReporters(input: StepReportersInput): StepReporters {
  const { stepId, log } = input;
  let activityRelayWarned = false;
  const activity = createActivityTracker({
    send: (report) => {
      input
        .client()
        .activity?.(stepId, report)
        ?.catch((err: unknown) => {
          if (activityRelayWarned) return;
          activityRelayWarned = true;
          log(`activity relay failed (suppressed until next step): ${errorMessage(err)}`);
        });
    },
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  activity.setPhase('preparing');
  const agentTodo = new AgentTodoReporter({
    send: (items) => input.client().agentTodo?.(stepId, { items }),
    onFirstError: (err) =>
      log(`agent todo relay failed (suppressed until next step): ${errorMessage(err)}`),
  });
  return { activity, agentTodo };
}
