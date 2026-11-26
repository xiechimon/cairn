import {
  type AgentTodo,
  type AgentTodoItem,
  agentTodoOfContent,
  BUILD_FAILURE_ROW_KIND,
  type BuildRecord,
  isActiveStepStatus,
  parseAgentTodoText,
  RETRY_PARKED_MARK,
  STOP_MESSAGE,
  type StepJournalRow,
  stripAgentTodoText,
  stripAnsiEscapes,
  systemRowOf,
  toolResultText,
  WORKSPACE_HOOK_ROW_KIND,
} from '@cairn/shared';
import {
  isJsonPlumbing,
  type MessageRow,
  textOfContent,
  toolCallOfContent,
} from '../api/mappers.js';
import type { DiffFile } from '../fixtures/records.js';
import type { EngineEvent, EngineRun, EngineRunState } from './engine-run.js';
import { threadEngines } from './thread-usage-model.js';

export interface LiveEngineRunInput {
  messages: readonly MessageRow[];
  steps: readonly StepJournalRow[];
  agentTodo: AgentTodo | null;
  pageTodo?: AgentTodoItem[] | null;
  build?: Pick<BuildRecord, 'errorMessage'> | null;
  liveText?: string;
}

const WORKSPACE_PREFIX =
  /^\/(?:(?:home|Users)\/[^/]+\/\.(?:pacman-chief|cairn)\/(?:workspaces|plans)\/[^/]+|home\/agent\/tasks\/[^/]+)\//;

const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const displayPath = (args: Record<string, unknown>): string =>
  String(args.file_path ?? args.path ?? '').replace(WORKSPACE_PREFIX, '');

const seconds = (call: { startedAt?: number; endedAt?: number }): number =>
  call.startedAt !== undefined && call.endedAt !== undefined
    ? Math.max(0, (call.endedAt - call.startedAt) / 1000)
    : 0;

function editDiff(args: Record<string, unknown>, name: string): DiffFile {
  const edits = name === 'multiedit' && Array.isArray(args.edits) ? args.edits : [args];
  const removed: string[] = [];
  const added: string[] = [];
  for (const edit of edits) {
    if (edit === null || typeof edit !== 'object') continue;
    const values = edit as Record<string, unknown>;
    const oldText = values.old_string ?? values.oldText;
    const newText = values.new_string ?? values.newText ?? values.content;
    if (typeof oldText === 'string' && oldText !== '') removed.push(...oldText.split('\n'));
    if (typeof newText === 'string' && newText !== '') added.push(...newText.split('\n'));
  }
  return {
    path: displayPath(args),
    added: added.length,
    removed: removed.length,
    hunks: [
      {
        header: '',
        lines: [
          ...removed.map((text) => ({ kind: 'del' as const, text })),
          ...added.map((text) => ({ kind: 'add' as const, text })),
        ],
      },
    ],
  };
}

function callEvent(call: {
  id: string;
  name: string;
  arguments: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt?: number;
  endedAt?: number;
}): EngineEvent {
  const args = recordOf(call.arguments);
  const name = call.name.toLowerCase().replace(/^mcp__cairn__/, '');
  if (name === 'read' || name === 'read_file') {
    const output = toolResultText(call.result) ?? '';
    return {
      kind: 'read',
      id: call.id,
      path: displayPath(args),
      lines: output === '' ? 0 : output.split('\n').length,
      seconds: seconds(call),
    };
  }
  if (name === 'edit' || name === 'write' || name === 'write_file' || name === 'multiedit') {
    return { kind: 'edit', id: call.id, file: editDiff(args, name) };
  }
  if (name === 'bash' || name === 'shell') {
    const output = toolResultText(call.result) ?? '';
    return {
      kind: 'run',
      id: call.id,
      command: typeof args.command === 'string' ? args.command : '',
      exit: call.isError === true ? 1 : call.result === undefined ? null : 0,
      output: output === '' ? [] : output.split('\n'),
      seconds: seconds(call),
    };
  }
  return {
    kind: 'unknown',
    id: call.id,
    type: call.name,
    payload: JSON.stringify({ arguments: call.arguments, result: call.result }, null, 2),
  };
}

function liveEvents(messages: readonly MessageRow[], liveText: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const m of messages) {
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      if (call.parent !== undefined) continue;
      if ((call.name === 'TodoWrite' || call.todo !== undefined) && call.isError !== true) {
        continue;
      }
      events.push(callEvent(call));
      continue;
    }
    if (m.role !== 'assistant') continue;
    const text = textOfContent(m.content);
    if (text === '' || isJsonPlumbing(text)) continue;
    const stripped = parseAgentTodoText(text) !== null ? stripAgentTodoText(text) : text;
    if (stripped.trim() === '') continue;
    events.push({ kind: 'text', id: m.id, text: stripped });
  }
  if (liveText.trim() !== '' && !isJsonPlumbing(liveText)) {
    const stripped =
      parseAgentTodoText(liveText) !== null ? stripAgentTodoText(liveText) : liveText;
    if (stripped.trim() !== '') events.push({ kind: 'text', id: 'live-text', text: stripped });
  }
  return events;
}

function rawOf(event: EngineEvent): string {
  switch (event.kind) {
    case 'text':
      return `● ${stripAnsiEscapes(event.text)}`;
    case 'read':
      return `● Read(${event.path})\n  ⎿ Read ${event.lines} lines`;
    case 'edit':
      return `● Update(${event.file.path})\n  ⎿ +${event.file.added} −${event.file.removed ?? 0}`;
    case 'run': {
      const tail = event.output.findLast((line) => line.trim() !== '');
      const summary =
        tail !== undefined ? stripAnsiEscapes(tail) : event.exit === null ? 'Running…' : '';
      return `● Bash(${event.command})\n  ⎿ ${summary}`;
    }
    case 'question':
      return `? ${stripAnsiEscapes(event.text)}`;
    case 'unknown':
      return `● ${event.type}`;
  }
}

function systemRawLine(m: MessageRow): string | null {
  if (m.role !== 'system') return null;
  const row = systemRowOf(m.content);
  if (row !== null) {
    if (row.kind === WORKSPACE_HOOK_ROW_KIND && row.status !== 'ok') {
      const output = stripAnsiEscapes(row.output.trim());
      return output === ''
        ? `● Hook(.agents/${row.name}) failed`
        : `● Hook(.agents/${row.name}) failed\n  ⎿ ${output}`;
    }
    if (row.kind === BUILD_FAILURE_ROW_KIND) {
      const reason = stripAnsiEscapes(row.reason.trim());
      return reason === '' ? null : `✕ ${reason}`;
    }
    return null;
  }
  const text = textOfContent(m.content).trim();
  if (text.startsWith(RETRY_PARKED_MARK)) return `✕ ${stripAnsiEscapes(text)}`;
  return null;
}

function synthesizeRawOutput(
  events: readonly EngineEvent[],
  messages: readonly MessageRow[],
  state: EngineRunState,
  buildError: string | null,
): string {
  const lines = events.map(rawOf);
  const systemLines = messages.flatMap((m) => {
    const line = systemRawLine(m);
    return line === null ? [] : [line];
  });
  lines.push(...systemLines);
  if (
    state === 'failed' &&
    buildError !== null &&
    !lines.some((line) => line.includes(buildError))
  ) {
    lines.push(`✕ ${buildError}`);
  } else if (
    state === 'stopped' &&
    !lines.some((line) => line.includes(buildError ?? STOP_MESSAGE))
  ) {
    lines.push(`■ ${buildError ?? STOP_MESSAGE}`);
  }
  return lines.join('\n');
}

function liveState(steps: readonly StepJournalRow[], buildError: string | null): EngineRunState {
  if (steps.some((step) => isActiveStepStatus(step.status))) return 'running';
  if (buildError !== null) return buildError === STOP_MESSAGE ? 'stopped' : 'failed';
  if (steps.at(-1)?.status === 'done') return 'finished';
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'stopped')) return 'stopped';
  return 'finished';
}

function rowsTodo(messages: LiveEngineRunInput['messages']): AgentTodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const items = agentTodoOfContent(m.content);
    if (items !== null) return items;
  }
  return null;
}

export function liveEngineRun({
  messages,
  steps,
  agentTodo,
  pageTodo = null,
  build,
  liveText = '',
}: LiveEngineRunInput): EngineRun | null {
  const engineSteps = steps.filter((step) => step.route?.harness != null);
  const engine = threadEngines(engineSteps).at(-1);
  if (engine === undefined) return null;
  const rawError = build?.errorMessage?.trim();
  const buildError = rawError ? stripAnsiEscapes(rawError) : null;
  const state = liveState(engineSteps, buildError);
  const events = liveEvents(messages, liveText);
  const claimed = engineSteps.find((step) => step.status === 'claimed');
  return {
    engine,
    state,
    elapsedSeconds: null,
    costUsd: null,
    plan:
      agentTodo !== null && steps.some((step) => step.id === agentTodo.stepId)
        ? agentTodo.items
        : (rowsTodo(messages) ?? parseAgentTodoText(liveText) ?? pageTodo ?? []),
    events,
    rawOutput: synthesizeRawOutput(events, messages, state, buildError),
    stepId: claimed?.id ?? engineSteps.at(-1)?.id,
  };
}
