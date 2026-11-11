import { z } from 'zod';

export const ACTION_CLASSES = ['free', 'confirm-once', 'owner-only'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const ACTION_SCOPES = ['team', 'project'] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];

export const ACTION_SURFACES = ['web', 'coordinator', 'mcp', 'cli'] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

export const ACTION_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const OWNER_ONLY_EXCEPTION_IDS = [
  'set_secret',
  'delete_secrets',
  'merge_builds',
  'rest.merge-policy',
  'rest.ship-route',
  'rest.eval-ruler',
] as const;

export interface ActionEntry<TInput = unknown, TOutput = unknown> {
  id: string;
  toolName: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  scope: ActionScope;
  class: ActionClass;
  standingGrant: boolean;
  inverse: string | null;
  surfaces: readonly ActionSurface[];
  targetOf: (input: TInput) => string;
}

const projectTargetInput = z.object({ projectId: z.string().min(1) }).strict();
export type ProjectTargetInput = z.infer<typeof projectTargetInput>;

const archiveOutput = z
  .object({ projectId: z.string(), archivedAt: z.number().nullable() })
  .strict();
const deleteOutput = z.object({ projectId: z.string(), deleted: z.literal(true) }).strict();

function projectAction<TOutput>(
  entry: ActionEntry<ProjectTargetInput, TOutput>,
): ActionEntry<ProjectTargetInput, TOutput> {
  return entry;
}

export const projectArchiveAction = projectAction({
  id: 'project.archive',
  toolName: 'archive_project',
  inputSchema: projectTargetInput,
  outputSchema: archiveOutput,
  scope: 'project',
  class: 'free',
  standingGrant: false,
  inverse: 'project.unarchive',
  surfaces: ['web', 'coordinator'],
  targetOf: (input) => input.projectId,
});

export const projectUnarchiveAction = projectAction({
  id: 'project.unarchive',
  toolName: 'unarchive_project',
  inputSchema: projectTargetInput,
  outputSchema: archiveOutput,
  scope: 'project',
  class: 'free',
  standingGrant: false,
  inverse: 'project.archive',
  surfaces: ['web', 'coordinator'],
  targetOf: (input) => input.projectId,
});

export const projectDeleteAction = projectAction({
  id: 'project.delete',
  toolName: 'delete_project',
  inputSchema: projectTargetInput,
  outputSchema: deleteOutput,
  scope: 'project',
  class: 'confirm-once',
  standingGrant: false,
  inverse: null,
  surfaces: ['web', 'coordinator'],
  targetOf: (input) => input.projectId,
});

export const SLICE1_ACTIONS = [
  projectArchiveAction,
  projectUnarchiveAction,
  projectDeleteAction,
] as const;

export function actionById(id: string): (typeof SLICE1_ACTIONS)[number] | undefined {
  return SLICE1_ACTIONS.find((entry) => entry.id === id);
}

export function actionByToolName(name: string): (typeof SLICE1_ACTIONS)[number] | undefined {
  return SLICE1_ACTIONS.find((entry) => entry.toolName === name);
}
