import { z } from 'zod';

export const MODEL_SOURCE_RUNTIMES = ['pi', 'claude-code', 'gemini'] as const;
export const modelSourceRuntimeSchema = z.enum(MODEL_SOURCE_RUNTIMES);
export type ModelSourceRuntime = z.infer<typeof modelSourceRuntimeSchema>;

export const MODEL_SOURCE_RUNTIME_LABELS: Record<ModelSourceRuntime, string> = {
  pi: 'pi',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
};

export const modelSourceModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.string().optional(),
  liveness: z.enum(['alive', 'dead', 'unknown']).optional(),
});
export type ModelSourceModel = z.infer<typeof modelSourceModelSchema>;

export const claudeBinInfoSchema = z.object({
  path: z.string().min(1),
  version: z.string().nullable(),
});
export type ClaudeBinInfoWire = z.infer<typeof claudeBinInfoSchema>;

export const claudeAuthStateSchema = z.object({
  state: z.enum(['logged-in', 'not-logged-in', 'unknown']),
  method: z.string().optional(),
  provider: z.string().optional(),
  reason: z.string().optional(),
});
export type ClaudeAuthStateWire = z.infer<typeof claudeAuthStateSchema>;

export const modelSourceSchema = z.object({
  runtime: modelSourceRuntimeSchema,
  installed: z.boolean(),
  hostname: z.string(),
  machineId: z.string().optional(),
  models: z.array(modelSourceModelSchema),
  bin: claudeBinInfoSchema.nullable().optional(),
  auth: claudeAuthStateSchema.optional(),
});
export type ModelSource = z.infer<typeof modelSourceSchema>;

export const modelSourcesEnvelopeSchema = z.object({
  sources: z.array(modelSourceSchema),
});
export type ModelSourcesEnvelope = z.infer<typeof modelSourcesEnvelopeSchema>;

export const CLAUDE_MODEL_SLOT_PATTERN = /^ANTHROPIC_([A-Z0-9_]+)_MODEL$/;

export function parseClaudeCodeModelSource(raw: unknown, hostname: string): ModelSource {
  const notInstalled: ModelSource = {
    runtime: 'claude-code',
    installed: false,
    hostname,
    models: [],
  };
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return notInstalled;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return notInstalled;
  }
  const settings = parsed as { model?: unknown; env?: unknown };
  const env = settings.env;
  const envRecord: Record<string, unknown> =
    typeof env === 'object' && env !== null && !Array.isArray(env)
      ? (env as Record<string, unknown>)
      : {};
  const models: ModelSourceModel[] = [];
  const seen = new Set<string>();
  if (typeof settings.model === 'string' && settings.model !== '') {
    const mapped = envRecord[`ANTHROPIC_DEFAULT_${settings.model.toUpperCase()}_MODEL`];
    const id = typeof mapped === 'string' && mapped !== '' ? mapped : settings.model;
    models.push({ id, name: id, slot: 'default' });
    seen.add(id);
  }
  for (const [key, value] of Object.entries(envRecord)) {
    const match = CLAUDE_MODEL_SLOT_PATTERN.exec(key);
    const slot = match?.[1];
    if (slot === undefined || typeof value !== 'string' || value === '') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    models.push({ id: value, name: value, slot: slot.toLowerCase().replace(/_/g, '-') });
  }
  return { runtime: 'claude-code', installed: true, hostname, models };
}

export const claudeCodeReportSchema = z.object({
  installed: z.boolean(),
  hostname: z.string(),
  models: z.array(modelSourceModelSchema),
  bin: claudeBinInfoSchema.nullable().optional(),
  auth: claudeAuthStateSchema.optional(),
});
export type ClaudeCodeReport = z.infer<typeof claudeCodeReportSchema>;

export const modelRefSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
});
export type ModelRef = z.infer<typeof modelRefSchema>;
