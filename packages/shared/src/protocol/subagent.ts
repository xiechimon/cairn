import { z } from 'zod';
import type { RemoteToolDef } from './chief-tools.js';

export const SUBAGENT_TOOL_NAME = 'subagent';
export const SUBAGENT_REQUEST_ID_PREFIX = 'subagent:';
export const SUBAGENT_MAX_CONCURRENT = 4;

export function isSubagentRequestId(requestId: string | undefined): boolean {
  return requestId?.startsWith(SUBAGENT_REQUEST_ID_PREFIX) === true;
}
export const SUBAGENT_MAX_PER_TURN = 8;
export const SUBAGENT_SUMMARY_MAX_CHARS = 8_000;
export const SUBAGENT_CONTEXT_MAX_CHARS = 16_000;
export const SUBAGENT_LABEL_MAX_CHARS = 60;
export const SUBAGENT_TIMEOUT_DEFAULT_SEC = 120;
export const SUBAGENT_TIMEOUT_MIN_SEC = 10;
export const SUBAGENT_TIMEOUT_MAX_SEC = 300;
export const SUBAGENT_MAX_TURNS_DEFAULT = 15;
export const SUBAGENT_MAX_TURNS_MIN = 1;
export const SUBAGENT_MAX_TURNS_MAX = 30;
export const SUBAGENT_FORK_MAX_CONTEXT_RATIO = 0.6;
export const SUBAGENT_CHILD_STEPS_MAX = 30;

export const SUBAGENT_SYSTEM_PROMPT = [
  'You are a focused read-only sub-agent assisting Cairn Coordinator.',
  'Complete the assigned lookup or analysis concisely and return factual findings with exact IDs, names, or citations.',
  'Never ask the user questions, never mutate state, and never spawn further sub-agents.',
  'Keep the final answer crisp and directly usable by the Coordinator.',
].join('\n');

export const SUBAGENT_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'todos',
  'threads',
  'projects',
  'models',
  'machines',
  'skills',
  'docs',
  'usage',
  'issues',
  'pull_requests',
  'workflow_runs',
  'conversation',
  'search_history',
  'read_history',
  'channel_messages',
  'inspect_run',
  'memories',
  'attachment',
]);

export const SUBAGENT_HOST_READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep']);

export const SUBAGENT_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  SUBAGENT_TOOL_NAME,
  'ask_user',
  'notify_user',
  'request_secret',
  'suggest_replies',
  'create_todo',
  'open_thread',
  'stop_thread',
  'update_todo',
  'delete_todos',
  'archive_todos',
  'unarchive_todos',
  'complete_todos',
  'cancel_builds',
  'merge_builds',
  'create_project',
  'update_project',
  'archive_project',
  'unarchive_project',
  'delete_project',
  'connect_repo',
  'create_skill',
  'update_skill',
  'schedule_todo',
  'unschedule_todo',
  'save_memory',
  'update_memory',
  'delete_memory',
  'set_secret',
  'delete_secrets',
  'request_takeover',
  'install_packages',
  'shell',
  'user_computer_shell',
  'user_computer_act',
  'user_computer_observe',
  'computer_act',
  'computer_observe',
  'desktop_act',
  'desktop_snapshot',
  'phone_act',
  'phone_observe',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'tool_search',
  'call_tool',
]);

const UNTRUSTED_HOST_PREFIXES = [
  'user_computer_',
  'computer_',
  'desktop_',
  'phone_',
  'browser_',
] as const;

export const subagentToolInputSchema = z.object({
  task: z.string().trim().min(1),
  label: z.string().trim().max(SUBAGENT_LABEL_MAX_CHARS).optional(),
  context: z.string().max(SUBAGENT_CONTEXT_MAX_CHARS).optional(),
  mode: z.enum(['fresh', 'fork']).optional(),
  tools: z.union([z.literal('read-only'), z.array(z.string().min(1))]).optional(),
  timeoutSec: z.number().finite().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
});
export type SubagentToolInput = z.infer<typeof subagentToolInputSchema>;

export const subagentChildStepSchema = z.object({
  name: z.string(),
  argSummary: z.string().optional(),
  isError: z.boolean().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type SubagentChildStep = z.infer<typeof subagentChildStepSchema>;

export const subagentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});
export type SubagentUsage = z.infer<typeof subagentUsageSchema>;

export const subagentStatusSchema = z.enum(['completed', 'failed', 'timed_out', 'aborted']);
export type SubagentStatus = z.infer<typeof subagentStatusSchema>;

export const subagentToolResultSchema = z.object({
  status: subagentStatusSchema,
  summary: z.string(),
  partial: z.boolean().optional(),
  error: z.string().optional(),
  childId: z.string(),
  runtime: z.string(),
  model: z.string(),
  toolCalls: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  usage: subagentUsageSchema,
  childSteps: z.array(subagentChildStepSchema).max(SUBAGENT_CHILD_STEPS_MAX).optional(),
  label: z.string().optional(),
  mode: z.enum(['fresh', 'fork']).optional(),
  fallbackFromFork: z.boolean().optional(),
});
export type SubagentToolResult = z.infer<typeof subagentToolResultSchema>;

export const subagentLiveProgressSchema = z.object({
  status: z.enum(['queued', 'running']),
  label: z.string().optional(),
  childId: z.string().optional(),
  toolCalls: z.number().int().nonnegative(),
  lastTool: z.string().optional(),
  startedAt: z.number().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});
export type SubagentLiveProgress = z.infer<typeof subagentLiveProgressSchema>;

export const SUBAGENT_TOOL_DEF: RemoteToolDef = {
  name: SUBAGENT_TOOL_NAME,
  description:
    'Run a focused read-only sub-agent in this Coordinator turn and return its bounded summary straight back without creating a task thread. Use for parallel multi-record lookups, run diagnostics, or history checks.',
  replaySafe: true,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Self-contained lookup or analysis task for the sub-agent.',
      },
      label: {
        type: 'string',
        description: 'Short label shown in the chat trace row (at most 60 characters).',
      },
      context: {
        type: 'string',
        description: 'Optional focused background context (at most 16,000 characters).',
      },
      mode: {
        type: 'string',
        description:
          'Optional mode: "fresh" (default) starts clean; "fork" clones parent history to reuse prompt cache.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional read-only tool subset; omit for all default read-only tools.',
      },
      timeoutSec: {
        type: 'integer',
        description: 'Optional wall-clock timeout in seconds (10 to 300, default 120).',
      },
      maxTurns: {
        type: 'integer',
        description: 'Optional max tool rounds (1 to 30, default 15).',
      },
    },
    required: ['task'],
  },
};

export function clampSubagentTimeoutSec(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SUBAGENT_TIMEOUT_DEFAULT_SEC;
  return Math.min(SUBAGENT_TIMEOUT_MAX_SEC, Math.max(SUBAGENT_TIMEOUT_MIN_SEC, Math.round(value)));
}

export function clampSubagentMaxTurns(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return SUBAGENT_MAX_TURNS_DEFAULT;
  return Math.min(SUBAGENT_MAX_TURNS_MAX, Math.max(SUBAGENT_MAX_TURNS_MIN, Math.round(value)));
}

export function resolveSubagentAllowedTools(
  requested: 'read-only' | readonly string[] | undefined,
  parentAvailable: readonly string[],
  options: {
    readOnlyConnectors?: ReadonlySet<string>;
    untrustedTurn?: boolean;
  } = {},
): string[] {
  const parentSet = new Set(parentAvailable);
  const connectors = options.readOnlyConnectors ?? new Set<string>();
  const untrusted = options.untrustedTurn === true;
  const isPermitted = (name: string): boolean => {
    if (!parentSet.has(name)) return false;
    if (SUBAGENT_FORBIDDEN_TOOLS.has(name)) return false;
    if (untrusted && UNTRUSTED_HOST_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      return false;
    }
    return (
      SUBAGENT_READ_ONLY_TOOLS.has(name) ||
      SUBAGENT_HOST_READ_TOOLS.has(name) ||
      connectors.has(name)
    );
  };
  const candidates =
    requested === undefined || requested === 'read-only' ? parentAvailable : requested;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of candidates) {
    if (seen.has(name) || !isPermitted(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

const CONTROL_TAG_RE =
  /<(\/?(?:system-reminder|turn_state|untrusted|preferences|how_you_work|channel|asking|talking|events|delivery|tools|turn_notes|quick_replies))\b[^>]*>/gi;
const ROLE_LINE_RE = /^([ \t]*)(Human|Assistant|System):/gm;

export function sanitizeSubagentSummary(
  text: string,
  childId: string,
): { summary: string; truncated: boolean; flaggedPatterns: string[] } {
  const flagged = new Set<string>();
  let cleaned = text.replace(CONTROL_TAG_RE, (match, tag: string) => {
    flagged.add(tag.replace(/^\//, '').toLowerCase());
    return `&lt;${match.slice(1)}`;
  });
  cleaned = cleaned.replace(ROLE_LINE_RE, (_match, indent: string, role: string) => {
    flagged.add(`${role}:`);
    return `${indent}\\${role}:`;
  });
  const flaggedPatterns = [...flagged];
  if (flaggedPatterns.length > 0) {
    cleaned = `[subagent output escaped instruction-shaped pattern(s): ${flaggedPatterns.join(', ')}]\n${cleaned}`;
  }
  if (cleaned.length <= SUBAGENT_SUMMARY_MAX_CHARS) {
    return { summary: cleaned, truncated: false, flaggedPatterns };
  }
  const suffix = `\n[truncated; full trace in childId=${childId}]`;
  return {
    summary: `${cleaned.slice(0, SUBAGENT_SUMMARY_MAX_CHARS)}${suffix}`,
    truncated: true,
    flaggedPatterns,
  };
}

export function subagentLabelOf(input: { task?: unknown; label?: unknown }): string {
  if (typeof input.label === 'string' && input.label.trim() !== '') {
    return input.label.trim().slice(0, SUBAGENT_LABEL_MAX_CHARS);
  }
  if (typeof input.task === 'string' && input.task.trim() !== '') {
    const firstLine = input.task.trim().split(/\r?\n/)[0] ?? '';
    return firstLine.length <= SUBAGENT_LABEL_MAX_CHARS
      ? firstLine
      : `${firstLine.slice(0, SUBAGENT_LABEL_MAX_CHARS - 1)}…`;
  }
  return '';
}

export function buildSubagentUserPrompt(task: string, context?: string): string {
  if (context === undefined || context.trim() === '') return task;
  const bounded = context.slice(0, SUBAGENT_CONTEXT_MAX_CHARS);
  return `${task}\n\n<context>\n${bounded}\n</context>`;
}
