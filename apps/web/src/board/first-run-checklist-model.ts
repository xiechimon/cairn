import type { ChiefGetResponse } from '@cairn/shared';

export const FIRST_RUN_STEP_IDS = ['provider', 'machine', 'coordinator'] as const;
export type FirstRunStepId = (typeof FIRST_RUN_STEP_IDS)[number];

export interface FirstRunFacts {
  providerCount: number | undefined;
  machinesOnline: number | undefined;
  coordinatorCanAnswer: boolean | undefined;
}

export interface FirstRunStep {
  id: FirstRunStepId;
  done: boolean;
}

export function coordinatorCanAnswer(chief: ChiefGetResponse | undefined): boolean | undefined {
  if (chief === undefined) return undefined;
  return chief.agentActor != null && Boolean(chief.agentActor.modelId);
}

export function firstRunSteps(facts: FirstRunFacts): FirstRunStep[] | null {
  const { providerCount, machinesOnline, coordinatorCanAnswer: canAnswer } = facts;
  if (providerCount === undefined || machinesOnline === undefined || canAnswer === undefined) {
    return null;
  }
  return [
    { id: 'provider', done: providerCount > 0 },
    { id: 'machine', done: machinesOnline > 0 },
    { id: 'coordinator', done: canAnswer },
  ];
}

export function firstRunComplete(steps: readonly FirstRunStep[] | null): boolean {
  return steps === null || steps.every((step) => step.done);
}
