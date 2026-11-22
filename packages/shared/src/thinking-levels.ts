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
