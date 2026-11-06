import type { ChiefGetResponse } from '@cairn/shared';

export const FIRST_RUN_STEP_IDS = ['model-source', 'machine', 'coordinator'] as const;
export type FirstRunStepId = (typeof FIRST_RUN_STEP_IDS)[number];

export interface FirstRunFacts {
  modelSources: number | undefined;
  machinesOnline: number | undefined;
  coordinatorCanAnswer: boolean | undefined;
}

export interface FirstRunStep {
  id: FirstRunStepId;
  done: boolean;
}

export function modelSourceCount(
  providers: readonly { id: string }[] | undefined,
  connections: readonly { id: string; available?: boolean | undefined }[] | undefined,
): number | undefined {
  if (providers === undefined || connections === undefined) return undefined;
  return (
    providers.length + connections.filter((connection) => connection.available !== false).length
  );
}

export function coordinatorCanAnswer(chief: ChiefGetResponse | undefined): boolean | undefined {
  if (chief === undefined) return undefined;
  return chief.agentActor != null && Boolean(chief.agentActor.modelId);
}

export function firstRunSteps(facts: FirstRunFacts): FirstRunStep[] | null {
  const { modelSources, machinesOnline, coordinatorCanAnswer: canAnswer } = facts;
  if (modelSources === undefined || machinesOnline === undefined || canAnswer === undefined) {
    return null;
  }
  return [
    { id: 'model-source', done: modelSources > 0 },
    { id: 'machine', done: machinesOnline > 0 },
    { id: 'coordinator', done: canAnswer },
  ];
}

export function firstRunComplete(steps: readonly FirstRunStep[] | null): boolean {
  return steps === null || steps.every((step) => step.done);
}
