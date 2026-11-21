import semver from 'semver';
import { z } from 'zod';
import { thinkingLevelSchema } from '../thinking-levels.js';
import { claudeLoginSchema } from './claude-login.js';

export const MODEL_SOURCE_RUNTIMES = [
  'pi',
  'claude-code',
  'gemini',
  'devin',
  'antigravity',
] as const;
export const modelSourceRuntimeSchema = z.enum(MODEL_SOURCE_RUNTIMES);
export type ModelSourceRuntime = z.infer<typeof modelSourceRuntimeSchema>;

export const MODEL_SOURCE_RUNTIME_LABELS: Record<ModelSourceRuntime, string> = {
  pi: 'pi',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
  devin: 'Devin',
  antigravity: 'Antigravity',
};

export const DEFAULT_ANTIGRAVITY_MODELS: readonly ModelSourceModel[] = [
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', slot: 'builtin' },
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', slot: 'builtin' },
  { id: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)', slot: 'builtin' },
  { id: 'gemini-pro-orchestrator-argon', name: 'Orchestrator (Argon)', slot: 'builtin' },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    slot: 'builtin',
    thinkingLevels: ['low', 'medium', 'high'],
    thinkingDefault: 'high',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    slot: 'builtin',
    thinkingLevels: [],
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    slot: 'builtin',
    thinkingLevels: [],
  },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', slot: 'builtin', thinkingLevels: [] },
];

export const DEFAULT_DEVIN_MODELS: readonly ModelSourceModel[] = [
  {
    id: 'swe-2-high',
    name: 'SWE-2',
    slot: 'builtin',
    thinkingLevels: ['medium', 'high', 'max'],
    thinkingDefault: 'high',
  },
  {
    id: 'swe-2-flash-medium',
    name: 'SWE-2 Flash',
    slot: 'builtin',
    thinkingLevels: ['medium', 'high', 'max'],
    thinkingDefault: 'medium',
  },
  { id: 'adaptive', name: 'Adaptive', slot: 'builtin', thinkingLevels: [] },
];

export const reportedModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.string().optional(),
  liveness: z.enum(['alive', 'dead', 'unknown']).optional(),
  thinkingLevels: z.array(thinkingLevelSchema).optional(),
  thinkingDefault: thinkingLevelSchema.optional(),
  inServerThinkingLevels: z.array(thinkingLevelSchema).optional(),
  inServerThinkingDefault: thinkingLevelSchema.optional(),
});

export const modelSourceModelSchema = reportedModelSchema.extend({
  updateRequired: z
    .object({ runtime: z.string(), current: z.string(), required: z.string() })
    .optional(),
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
  provider: z.string().min(1).optional(),
  providerLabel: z.string().optional(),
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

export const DEFAULT_CLAUDE_CODE_MODELS: readonly ModelSourceModel[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', slot: 'builtin' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', slot: 'builtin' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', slot: 'builtin' },
];

export const CLAUDE_CODE_MIN_CLI_VERSIONS: Readonly<Record<string, string>> = {
  'claude-opus-5-5': '2.1.280',
  'claude-sonnet-5-5': '2.1.284',
  'claude-haiku-5-5': '2.1.293',
  'claude-fable-5-2': '2.1.321',
  'claude-fable-5-1': '2.1.257',
  'claude-opus-5': '2.1.219',
  'claude-fable-5': '2.1.169',
  'claude-opus-4-8': '2.1.154',
  'claude-opus-4-7': '2.1.111',
};

export function claudeCodeUpdateRequired(
  modelId: string,
  cliVersion: string | null | undefined,
): { runtime: string; current: string; required: string } | null {
  const required = CLAUDE_CODE_MIN_CLI_VERSIONS[modelId.replace(LONG_CONTEXT_SUFFIX, '')];
  const current = semver.coerce(cliVersion ?? '')?.version;
  if (required === undefined || current === undefined || semver.gte(current, required)) return null;
  return { runtime: 'Claude Code', current, required };
}

const CLAUDE_CODE_ALIAS_FAMILIES: Readonly<Record<string, string>> = {
  best: 'opus',
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
  fable: 'fable',
};
const UNRESOLVABLE_CLAUDE_CODE_ALIASES = new Set(['default', 'opusplan']);
const LONG_CONTEXT_SUFFIX = /\[1m\]$/i;
export const CLAUDE_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]*$/;

export function canonicalClaudeModelId(
  id: string,
  newestFirst: readonly { id: string }[] = DEFAULT_CLAUDE_CODE_MODELS,
): string | null {
  const bare = id.trim().replace(LONG_CONTEXT_SUFFIX, '');
  const key = bare.toLowerCase();
  if (bare === '' || UNRESOLVABLE_CLAUDE_CODE_ALIASES.has(key)) return null;
  const family = CLAUDE_CODE_ALIAS_FAMILIES[key];
  if (family === undefined) return bare;
  const prefix = `claude-${family}-`;
  return (
    newestFirst.find((model) => model.id.startsWith(prefix))?.id ??
    DEFAULT_CLAUDE_CODE_MODELS.find((model) => model.id.startsWith(prefix))?.id ??
    null
  );
}

export function canonicalClaudeModels<T extends { id: string; name: string }>(
  models: readonly T[],
  newestFirst: readonly { id: string; name: string }[] = DEFAULT_CLAUDE_CODE_MODELS,
): T[] {
  const names = new Map(
    [...DEFAULT_CLAUDE_CODE_MODELS, ...newestFirst].map((model) => [model.id, model.name]),
  );
  const byId = new Map<string, T>();
  for (const model of models) {
    const id = canonicalClaudeModelId(model.id, newestFirst);
    if (id === null || byId.has(id)) continue;
    const name = id === model.id && model.name !== model.id ? model.name : (names.get(id) ?? id);
    byId.set(id, { ...model, id, name });
  }
  return [...byId.values()];
}

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
  models: z.array(reportedModelSchema),
  bin: claudeBinInfoSchema.nullable().optional(),
  auth: claudeAuthStateSchema.optional(),
  login: claudeLoginSchema.optional(),
});
export type ClaudeCodeReport = z.infer<typeof claudeCodeReportSchema>;

export const modelRefSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
});
export type ModelRef = z.infer<typeof modelRefSchema>;
