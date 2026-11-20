import { z } from 'zod';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const thinkingLevelSchema = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

const CLAUDE_EFFORT_LEVELS: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const CLAUDE_EFFORT_MODEL = /^claude-(?:opus|sonnet|haiku|fable)-(\d+)/;

export function claudeCodeThinkingLevels(modelId: string): ThinkingLevel[] {
  const major = CLAUDE_EFFORT_MODEL.exec(modelId)?.[1];
  return major !== undefined && Number(major) >= 5 ? [...CLAUDE_EFFORT_LEVELS] : [];
}

const CLAUDE_MEDIUM_DEFAULT_MODEL = /^claude-(?:opus|sonnet|haiku)-5-5(?:$|\[)/;

export function claudeCodeThinkingDefault(modelId: string): ThinkingLevel | undefined {
  return CLAUDE_MEDIUM_DEFAULT_MODEL.test(modelId) ? 'medium' : undefined;
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
