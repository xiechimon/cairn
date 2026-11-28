import { z } from 'zod';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const thinkingLevelSchema = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

const CLAUDE_EFFORT_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Claude Code 2.1.x model table: effort, xhigh and max are each denied for the
// listed ids; every other claude-* id is offered all five levels on first-party
// backends. Measured from the installed CLI's model table and its capability gates.
const CLAUDE_NO_EFFORT: readonly string[] = [
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-sonnet-4-0',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];
const CLAUDE_NO_XHIGH: readonly string[] = [
  ...CLAUDE_NO_EFFORT,
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
];
const CLAUDE_NO_MAX: readonly string[] = [...CLAUDE_NO_EFFORT, 'claude-opus-4-5'];

const CLAUDE_EFFORT_DEFAULT: Readonly<Record<string, ThinkingLevel>> = {
  'claude-opus-5-5': 'medium',
  'claude-sonnet-5-5': 'medium',
  'claude-haiku-5-5': 'medium',
  'claude-fable-5-2': 'medium',
  'claude-opus-4-7': 'xhigh',
};

const LONG_CONTEXT_SUFFIX = /\[1m\]$/i;

function modelDenied(id: string, deny: readonly string[]): boolean {
  return deny.some((denied) => id === denied || id.startsWith(`${denied}-`));
}

export interface ClaudeCodeThinkingOptions {
  customBackend?: boolean;
}

export function claudeCodeThinkingLevels(
  modelId: string,
  options: ClaudeCodeThinkingOptions = {},
): ThinkingLevel[] {
  const id = modelId.trim().toLowerCase().replace(LONG_CONTEXT_SUFFIX, '');
  if (
    options.customBackend === true ||
    !id.startsWith('claude-') ||
    id.includes('claude-3-') ||
    modelDenied(id, CLAUDE_NO_EFFORT)
  ) {
    return [];
  }
  return CLAUDE_EFFORT_LEVELS.filter(
    (level) =>
      (level !== 'xhigh' || !modelDenied(id, CLAUDE_NO_XHIGH)) &&
      (level !== 'max' || !modelDenied(id, CLAUDE_NO_MAX)),
  );
}

export function claudeCodeThinkingDefault(
  modelId: string,
  options: ClaudeCodeThinkingOptions = {},
): ThinkingLevel | undefined {
  if (claudeCodeThinkingLevels(modelId, options).length === 0) return undefined;
  const id = modelId.trim().toLowerCase().replace(LONG_CONTEXT_SUFFIX, '');
  const listed = Object.keys(CLAUDE_EFFORT_DEFAULT).find(
    (denied) => id === denied || id.startsWith(`${denied}-`),
  );
  return listed === undefined ? 'high' : CLAUDE_EFFORT_DEFAULT[listed];
}

const ACP_OFF = 'none';

export function acpThoughtLevel(value: string): ThinkingLevel | undefined {
  return THINKING_LEVELS.find((level) => (level === 'off' ? ACP_OFF : level) === value);
}

export function acpThoughtLevels(values: Iterable<string>): ThinkingLevel[] {
  const offered = new Set(values);
  return THINKING_LEVELS.filter((level) => offered.has(level === 'off' ? ACP_OFF : level));
}

export function acpThoughtValue(level: string, values: Iterable<string>): string | undefined {
  const value = level === 'off' ? ACP_OFF : level;
  return new Set(values).has(value) ? value : undefined;
}

export function distinctThinkingLevels(
  supported: readonly ThinkingLevel[],
  sentAs: Partial<Record<ThinkingLevel, string | null>>,
): ThinkingLevel[] {
  const sentValue = (level: ThinkingLevel) => sentAs[level] ?? level;
  return supported.filter(
    (level) =>
      sentValue(level) === level ||
      !supported.some((other) => other !== level && sentValue(other) === sentValue(level)),
  );
}

const DEVIN_EFFORT_SUFFIX_RE = /^(.*)-(none|off|minimal|low|medium|high|xhigh|max)$/;

export function devinVariantEffort(modelId: string): {
  baseId: string;
  level: ThinkingLevel;
} | null {
  const match = DEVIN_EFFORT_SUFFIX_RE.exec(modelId.trim().toLowerCase());
  if (match === null || !match[1] || !match[2]) return null;
  const level = acpThoughtLevel(match[2] === 'off' ? ACP_OFF : match[2]);
  if (level === undefined) return null;
  return { baseId: match[1], level };
}

const DEVIN_SWE = {
  'swe-2': { name: 'SWE-2', defaultEffort: 'high' },
  'swe-2-flash': { name: 'SWE-2 Flash', defaultEffort: 'medium' },
  'swe-2-1': { name: 'SWE-2.1', defaultEffort: 'medium' },
} as const;

function sweModel(id: string) {
  return Object.hasOwn(DEVIN_SWE, id) ? DEVIN_SWE[id as keyof typeof DEVIN_SWE] : undefined;
}

export function devinSweVariant(id: string) {
  const variant = devinVariantEffort(id);
  return variant !== null && sweModel(variant.baseId) !== undefined ? variant : null;
}

export function devinWireModel(
  provider: string | null,
  id: string | null,
  effort?: string | null,
): string | null {
  if (provider !== 'devin' || id === null) return id;
  const variant = devinSweVariant(id);
  const baseId = variant?.baseId ?? id;
  const model = sweModel(baseId);
  if (model === undefined) return id;
  const chosen = thinkingLevelSchema.safeParse(effort);
  const suffix = chosen.success ? chosen.data : (variant?.level ?? model.defaultEffort);
  return `${baseId}-${suffix === 'off' ? 'none' : suffix}`;
}

export function devinCatalogFamilies<
  T extends {
    id: string;
    name: string;
    thinkingLevels?: ThinkingLevel[];
    thinkingDefault?: ThinkingLevel;
  },
>(models: readonly T[]): T[] {
  const families = new Map<string, T>();
  for (const model of models) {
    const variant = devinSweVariant(model.id);
    const id = variant?.baseId ?? model.id;
    const family = sweModel(id);
    const previous = families.get(id);
    if (family === undefined) {
      if (previous === undefined) families.set(id, model);
      continue;
    }
    const levels = new Set([
      ...(previous?.thinkingLevels ?? []),
      ...(model.thinkingLevels ?? []),
      ...(variant !== null ? [variant.level] : []),
    ]);
    const first = previous ?? model;
    const thinkingDefault = first.thinkingDefault ?? variant?.level ?? family.defaultEffort;
    families.set(id, {
      ...first,
      id,
      name: family.name,
      thinkingLevels: THINKING_LEVELS.filter((level) => levels.has(level)),
      thinkingDefault,
    });
  }
  return [...families.values()];
}

export function devinInferredThinking(modelId: string): {
  thinkingLevels?: ThinkingLevel[];
  thinkingDefault?: ThinkingLevel;
} {
  const id = modelId.trim().toLowerCase();
  if (id === '' || id === 'adaptive' || id.startsWith('fusion-')) return {};
  if (/^glm-5(?:-|$)/.test(id)) {
    const suffix = devinVariantEffort(id);
    const thinkingDefault: ThinkingLevel = suffix?.level === 'max' ? 'max' : 'high';
    return { thinkingLevels: ['off', 'high', 'max'], thinkingDefault };
  }
  const parsed = devinVariantEffort(id);
  if (parsed === null) return {};
  const { baseId, level } = parsed;
  if (baseId.startsWith('claude-')) {
    const claudeBase = /^claude-(\d+)-([a-z]+)$/.exec(baseId);
    const normalized = claudeBase ? `claude-${claudeBase[2]}-${claudeBase[1]}` : baseId;
    const levels = claudeCodeThinkingLevels(normalized);
    if (levels.length === 0) return {};
    return levels.includes(level)
      ? { thinkingLevels: levels, thinkingDefault: level }
      : { thinkingLevels: levels };
  }
  if (/^gpt-6(?:-|$)/.test(baseId)) {
    return {
      thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      thinkingDefault: level,
    };
  }
  if (/^gemini-/.test(baseId) && (level === 'low' || level === 'medium' || level === 'high')) {
    return {
      thinkingLevels: ['low', 'medium', 'high'],
      thinkingDefault: level,
    };
  }
  if (
    /^kimi-k3(?:-|$)/.test(baseId) &&
    level !== 'off' &&
    level !== 'minimal' &&
    level !== 'xhigh'
  ) {
    return {
      thinkingLevels: ['low', 'medium', 'high', 'max'],
      thinkingDefault: level,
    };
  }
  return {};
}
