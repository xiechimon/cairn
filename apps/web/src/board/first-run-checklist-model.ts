import type { ChiefGetResponse, TeamRoutingSettings } from '@cairn/shared';

export const FIRST_RUN_STEP_IDS = ['models', 'machine'] as const;
export type FirstRunStepId = (typeof FIRST_RUN_STEP_IDS)[number];

export interface ModelSides {
  coordinator: boolean;
  tasks: boolean;
}

export interface FirstRunFacts {
  models: ModelSides | undefined;
  machinesReady: number | undefined;
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

export function modelSides(
  canAnswer: boolean | undefined,
  modelSources: number | undefined,
): ModelSides | undefined {
  if (canAnswer === undefined || modelSources === undefined) return undefined;
  return { coordinator: canAnswer, tasks: modelSources > 0 };
}

export function bothSidesHaveModels(models: ModelSides): boolean {
  return models.coordinator && models.tasks;
}

export function firstRunSteps(facts: FirstRunFacts): FirstRunStep[] | null {
  const { models, machinesReady } = facts;
  if (models === undefined || machinesReady === undefined) return null;
  return [
    { id: 'models', done: bothSidesHaveModels(models) },
    { id: 'machine', done: machinesReady > 0 },
  ];
}

export function nextOpenStep(steps: readonly FirstRunStep[] | null): FirstRunStepId | null {
  return steps?.find((step) => !step.done)?.id ?? null;
}

export function firstRunComplete(steps: readonly FirstRunStep[] | null): boolean {
  return steps === null || steps.every((step) => step.done);
}

export type SetupStepId = 'models' | 'confirm';

export interface SetupProgress {
  models: ModelSides;
  confirmed: boolean;
}

export function modelsConfirmed(settings: TeamRoutingSettings): boolean {
  const saved = new Set(settings.rules.map((rule) => rule.use));
  return saved.has('coordinator');
}

export function setupOpenStep(progress: SetupProgress): SetupStepId | null {
  if (!bothSidesHaveModels(progress.models)) return 'models';
  return progress.confirmed ? null : 'confirm';
}

export function resolvedSetupStep(
  progress: SetupProgress,
  options?: { reviewing?: boolean; returnToModels?: boolean },
): SetupStepId | null {
  const natural = setupOpenStep(progress);
  if (natural === null) return null;
  if (options?.reviewing === true) return 'models';
  if (options?.returnToModels === true && natural === 'confirm') return 'models';
  return natural;
}

export function canSelectSetupStep(
  target: SetupStepId,
  open: SetupStepId,
  progress: SetupProgress,
  reviewing: boolean,
): boolean {
  if (target === open) return false;
  if (target === 'models') return open === 'confirm';
  return !reviewing && setupOpenStep(progress) === 'confirm';
}

export function modelSourceKeys(
  providers: readonly { id: string }[],
  connections: readonly { id: string; available?: boolean | undefined }[],
): readonly string[] {
  return [
    ...providers.map((provider) => `provider:${provider.id}`),
    ...connections
      .filter((connection) => connection.available !== false)
      .map((connection) => `connection:${connection.id}`),
  ];
}

export function hasAddedModelSource(
  baseline: readonly string[],
  current: readonly string[],
): boolean {
  const known = new Set(baseline);
  return current.some((key) => !known.has(key));
}

export function holdFirstRunFrame(input: {
  setupHome: boolean;
  decision: boolean | undefined;
  projects: number | undefined;
  remembered: boolean;
  failed: boolean;
}): boolean {
  if (!input.setupHome || input.decision !== undefined || input.failed) return false;
  return input.remembered || input.projects === 0;
}

export function setupShown(input: {
  projects: number | undefined;
  progress: SetupProgress | undefined;
}): boolean | undefined {
  if (input.projects === undefined) return undefined;
  if (input.projects > 0) return false;
  if (input.progress === undefined) return undefined;
  return setupOpenStep(input.progress) !== null;
}

export function projectCreationBlocked(input: {
  projects: number | undefined;
  progress: SetupProgress | undefined;
}): boolean {
  if (input.projects === undefined || input.projects > 0 || input.progress === undefined) {
    return false;
  }
  return setupOpenStep(input.progress) !== null;
}
