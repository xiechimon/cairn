import { z } from 'zod';
import { agentTodoItemSchema } from './agent-todo.js';
import type { BriefBackendId } from './brief-file.js';
import type { StepOtelContext } from './otel.js';
import { epochMs, recordId } from './records/common.js';
import { messageRecordSchema } from './records/message.js';
import {
  providerApiSchema,
  providerCompatSchema,
  providerModelSchema,
} from './records/provider.js';

export const toolCallRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
  result: z.unknown().optional(),
  isError: z.boolean().optional(),
  startedAt: epochMs.optional(),
  endedAt: epochMs.optional(),
  todo: z.array(agentTodoItemSchema).optional(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

export const modelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
});
export type ModelCost = z.infer<typeof modelCostSchema>;

export const modelUsageSchema = z.object({
  model: z.string(),
  input: z.number().int(),
  output: z.number().int(),
  cacheRead: z.number().int(),
  cacheWrite: z.number().int(),
  cost: modelCostSchema.optional(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;

export type AgentTokenUsage = readonly ModelUsage[];

export const agentTokenUsageSchema = z.array(modelUsageSchema);

export const providerConfigSchema = z.object({
  kind: z.enum(['api_key', 'oauth', 'http']),
  providerId: z.string(),
  label: z.string().optional(),
  baseUrl: z.string().optional(),
  api: providerApiSchema.optional(),
  compat: providerCompatSchema.optional(),
  authHeader: z.boolean().optional(),
  models: z.array(providerModelSchema).optional(),
  apiKey: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const toolSpecSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string(),
  parameters: z.unknown().optional(),
});
export type ToolSpec = z.infer<typeof toolSpecSchema>;

export interface LocalToolDef {
  name: string;
  label?: string;
  description: string;
  parameters?: unknown;
  execute(params: Record<string, unknown>): Promise<string>;
}

export const mcpEndpointSchema = z.object({
  slug: z.string(),
  transport: z.enum(['http', 'stdio']),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type McpEndpoint = z.infer<typeof mcpEndpointSchema>;

export const stepEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('thinking_delta'), text: z.string() }),
  z.object({ type: z.literal('toolcall_end'), call: toolCallRecordSchema }),
  z.object({ type: z.literal('message_update'), message: messageRecordSchema }),
  z.object({ type: z.literal('message_end'), message: messageRecordSchema }),
  z.object({ type: z.literal('message_stop'), message: messageRecordSchema }),
  z.object({ type: z.literal('compaction') }),
  z.object({ type: z.literal('compaction_start') }),
  z.object({ type: z.literal('compaction_end') }),
  z.object({ type: z.literal('auto_retry_start'), attempt: z.number().int() }),
  z.object({ type: z.literal('auto_retry_end'), attempt: z.number().int() }),
  z.object({ type: z.literal('steer'), text: z.string() }),
  z.object({ type: z.literal('done'), usage: agentTokenUsageSchema }),
  z.object({
    type: z.literal('error'),
    error: z.object({ message: z.string(), retryable: z.boolean() }),
  }),
]);
export type StepEvent = z.infer<typeof stepEventSchema>;

export const STEP_EVENT_TYPES = stepEventSchema.options.map(
  (o) => o.shape.type.value,
) as readonly string[];

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const thinkingLevelSchema = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export interface AgentBackendCapabilities {
  readonly name: string;
  readonly thinkingLevels: readonly string[];
  readonly oauthProviders: readonly string[];
  readonly compaction: boolean;
  readonly sessionResume: boolean;
}

export interface SessionOpts {
  provider: ProviderConfig;
  modelId: string;
  thinkingLevel?: string;
  systemPrompt?: string;
  tools?: ToolSpec[];
  remoteTools?: import('./protocol/chief-tools.js').RemoteToolDef[];
  executeRemoteTool?: (name: string, params: Record<string, unknown>) => Promise<string>;
  localTools?: LocalToolDef[];
  mcpServers?: McpEndpoint[];
  skillsAllowlist?: string[];
  injectedSkills?: string[];
  onSkillsResolved?: (names: {
    injected: string[];
    omitted: string[];
    unrendered: string[];
  }) => void;
  teamSkillsDir?: string;
  readOnly?: boolean;
  env?: Record<string, string>;
  telemetry?: StepOtelContext;
  cwd: string;
  prompt?: string;
  promptImages?: readonly DeliveredImage[];
}

export interface DeliveredImage {
  data: string;
  mimeType: string;
}

export interface AgentSessionHandle {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly events: AsyncIterable<StepEvent>;
  steer(text: string, images?: readonly DeliveredImage[]): Promise<void>;
  stop(): Promise<void>;
  usage(): AgentTokenUsage;
}

export interface BriefChannel {
  readonly backendId: BriefBackendId;
  composeBody(opts: SessionOpts, base: string | undefined): string;
}

export interface AgentBackend {
  readonly capabilities: AgentBackendCapabilities;
  readonly brief?: BriefChannel;
  createSession(opts: SessionOpts): Promise<AgentSessionHandle>;
  continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle>;
  adaptProviderCompat?(provider: ProviderConfig, errorMessage: string): ProviderConfig | null;
}

export const BACKEND_RUNTIME_IDS = ['claude-code', 'gemini'] as const;
export type BackendRuntimeId = (typeof BACKEND_RUNTIME_IDS)[number];

export function isBackendRuntimeId(v: unknown): v is BackendRuntimeId {
  return typeof v === 'string' && (BACKEND_RUNTIME_IDS as readonly string[]).includes(v);
}

export const sessionRefSchema = z.object({
  conversationId: recordId,
  sessionId: z.string().nullable(),
});
export type SessionRef = z.infer<typeof sessionRefSchema>;
