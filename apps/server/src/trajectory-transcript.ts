import type { TokenCounts } from '@cairn/shared';

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function tokenCounts(usage: unknown): TokenCounts | undefined {
  if (!isRecord(usage)) return undefined;
  const counts: TokenCounts = {
    input: num(usage.input) ?? num(usage.input_tokens),
    output: num(usage.output) ?? num(usage.output_tokens),
    cacheRead: num(usage.cacheRead) ?? num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cacheWrite) ?? num(usage.cache_creation_input_tokens),
  };
  return Object.values(counts).some((count) => count !== undefined) ? counts : undefined;
}

export function costUsd(usage: unknown): number | undefined {
  return isRecord(usage) && isRecord(usage.cost) ? num(usage.cost.total) : undefined;
}

export interface ToolCall {
  id: string | undefined;
  name: string;
  arguments: unknown;
}

export function toolCallsOf(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): ToolCall[] => {
    if (!isRecord(block)) return [];
    const name = str(block.name);
    if (name === undefined) return [];
    if (block.type === 'toolCall') return [{ id: str(block.id), name, arguments: block.arguments }];
    if (block.type === 'tool_use') return [{ id: str(block.id), name, arguments: block.input }];
    return [];
  });
}

export interface ToolOutcome {
  at: number | undefined;
  failed: boolean;
  result: unknown;
}

export function toolOutcomesOf(transcript: Json[]): Map<string, ToolOutcome> {
  const outcomes = new Map<string, ToolOutcome>();
  for (const row of transcript) {
    const at = num(row.timestamp);
    const piId = str(row.toolCallId);
    if (piId !== undefined) {
      outcomes.set(piId, { at, failed: row.isError === true, result: row.content });
      continue;
    }
    if (row.role !== 'user' || !Array.isArray(row.content)) continue;
    for (const block of row.content) {
      const claudeId =
        isRecord(block) && block.type === 'tool_result' ? str(block.tool_use_id) : undefined;
      if (isRecord(block) && claudeId !== undefined)
        outcomes.set(claudeId, { at, failed: block.is_error === true, result: block.content });
    }
  }
  return outcomes;
}
