import { z } from 'zod';

export const ACTION_CLASSES = ['free', 'confirm-once', 'send', 'submit', 'owner-only'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const EXTERNAL_ACTION_CLASSES = ['send', 'submit'] as const;
export type ExternalActionClass = (typeof EXTERNAL_ACTION_CLASSES)[number];

export function isExternalActionClass(
  actionClass: ActionClass,
): actionClass is ExternalActionClass {
  return (EXTERNAL_ACTION_CLASSES as readonly string[]).includes(actionClass);
}

export const ACTION_SCOPES = ['team', 'project'] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];

export const ACTION_SURFACES = ['web', 'coordinator', 'mcp', 'cli'] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

export const ACTION_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const OWNER_ONLY_EXCEPTION_IDS = [
  'set_secret',
  'delete_secrets',
  'merge_builds',
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
  targetOf(input: TInput): string;
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

const todoDeleteInput = z
  .object({ todoIds: z.array(z.string().min(1)).min(1).max(50) })
  .strict()
  .transform((input) => ({ todoIds: [...new Set(input.todoIds)].sort() }));
export type TodoDeleteInput = z.infer<typeof todoDeleteInput>;

export const todoDeleteAction: ActionEntry<TodoDeleteInput, unknown> = {
  id: 'todo.delete',
  toolName: 'delete_todos',
  inputSchema: todoDeleteInput,
  outputSchema: z.object({ deleted: z.array(z.string()), missing: z.array(z.string()) }).strict(),
  scope: 'team',
  class: 'confirm-once',
  standingGrant: false,
  inverse: null,
  surfaces: ['coordinator'],
  targetOf: (input) => input.todoIds.join(','),
};

export const SLICE1_ACTIONS = [
  projectArchiveAction,
  projectUnarchiveAction,
  projectDeleteAction,
  todoDeleteAction,
] as const;

export function actionByToolName(name: string): (typeof SLICE1_ACTIONS)[number] | undefined {
  return SLICE1_ACTIONS.find((entry) => entry.toolName === name);
}

export const CONNECTOR_ACTION_PREFIX = 'connector.';

export function isConnectorActionId(id: string): boolean {
  return id.startsWith(CONNECTOR_ACTION_PREFIX);
}

export function connectorActionId(slug: string, tool: string): string {
  return `${CONNECTOR_ACTION_PREFIX}${slug}.${tool}`;
}

export interface ConnectorToolHints {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
}

const connectorInputSchema = z.record(z.string(), z.unknown());
const connectorOutputSchema = z.unknown();

export function inputDigest(input: unknown): string {
  const text = JSON.stringify(input) ?? '';
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export function connectorActionEntry(
  slug: string,
  tool: string,
  hints: ConnectorToolHints | undefined,
): ActionEntry<Record<string, unknown>, unknown> {
  const actionClass: ActionClass =
    hints?.readOnlyHint === true ? 'free' : hints?.destructiveHint === true ? 'submit' : 'send';
  return {
    id: connectorActionId(slug, tool),
    toolName: `connector_${slug}__${tool}`,
    inputSchema: connectorInputSchema,
    outputSchema: connectorOutputSchema,
    scope: 'team',
    class: actionClass,
    standingGrant: false,
    inverse: null,
    surfaces: ['coordinator'],
    targetOf: (input) => `${slug}#${inputDigest(input)}`,
  };
}

export const COMPUTER_OBSERVE_TOOLS: readonly string[] = [
  'browser_snapshot',
  'computer_observe',
  'desktop_snapshot',
];

export const COMPUTER_DIRECT_TOOLS: readonly string[] = [
  'shell',
  'browser_navigate',
  'browser_act',
  'computer_act',
  'desktop_act',
];

export function connectorActionForId(actionId: string): ActionEntry | undefined {
  if (!isConnectorActionId(actionId)) return undefined;
  const rest = actionId.slice(CONNECTOR_ACTION_PREFIX.length);
  const split = rest.indexOf('.');
  if (split <= 0 || split + 1 >= rest.length) return undefined;
  return connectorActionEntry(rest.slice(0, split), rest.slice(split + 1), undefined);
}
