import {
  type AgentTodo,
  type AgentTodoItem,
  agentTodoOfContent,
  type BuildRecord,
  isActiveStepStatus,
  STOP_MESSAGE,
  type StepJournalRow,
  toolResultText,
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
}

const WORKSPACE_PREFIX =
  /^\/(?:home|Users)\/[^/]+\/\.(?:pacman-chief|cairn)\/(?:workspaces|plans)\/[^/]+\//;

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
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const name = call.name.toLowerCase();
  if (name === 'read') {
    const output = toolResultText(call.result) ?? '';
    return {
      kind: 'read',
      id: call.id,
      path: displayPath(args),
      lines: output === '' ? 0 : output.split('\n').length,
      seconds: seconds(call),
    };
  }
  if (name === 'edit' || name === 'write' || name === 'multiedit') {
    return { kind: 'edit', id: call.id, file: editDiff(args, name) };
  }
  if (name === 'bash') {
    const output = toolResultText(call.result) ?? '';
    return {
      kind: 'run',
      id: call.id,
      command: typeof args.command === 'string' ? args.command : '',
      exit: call.result === undefined ? null : call.isError === true ? 1 : 0,
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

function liveEvents(messages: readonly MessageRow[]): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const m of messages) {
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      events.push(callEvent(call));
      continue;
    }
    if (m.role !== 'assistant') continue;
    const text = textOfContent(m.content);
    if (text === '' || isJsonPlumbing(text)) continue;
    events.push({ kind: 'text', id: m.id, text });
  }
  return events;
}

function rawOf(event: EngineEvent): string {
  switch (event.kind) {
    case 'text':
      return `● ${event.text}`;
    case 'read':
      return `● Read(${event.path})\n  ⎿ Read ${event.lines} lines`;
    case 'edit':
      return `● Update(${event.file.path})\n  ⎿ +${event.file.added} −${event.file.removed ?? 0}`;
    case 'run':
      return `● Bash(${event.command})\n  ⎿ ${event.output.at(-1) ?? (event.exit === null ? 'Running…' : '')}`;
    case 'question':
      return `? ${event.text}`;
    case 'unknown':
      return `● ${event.type}`;
  }
}

function liveState(steps: readonly StepJournalRow[], buildError: string | null): EngineRunState {
  if (steps.some((step) => isActiveStepStatus(step.status))) return 'running';
  if (buildError !== null) return buildError === STOP_MESSAGE ? 'stopped' : 'failed';
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
}: LiveEngineRunInput): EngineRun | null {
  const engineSteps = steps.filter((step) => step.route?.harness != null);
  const engine = threadEngines(engineSteps).at(-1);
  if (engine === undefined) return null;
  const events = liveEvents(messages);
  const claimed = engineSteps.find((step) => step.status === 'claimed');
  return {
    engine,
    state: liveState(engineSteps, build?.errorMessage ?? null),
    elapsedSeconds: null,
    costUsd: null,
    plan:
      agentTodo !== null && steps.some((step) => step.id === agentTodo.stepId)
        ? agentTodo.items
        : (rowsTodo(messages) ?? pageTodo ?? []),
    events,
    rawOutput: events.map(rawOf).join('\n'),
    stepId: claimed?.id ?? engineSteps.at(-1)?.id,
  };
}
