import type { ComponentType, ReactNode } from 'react';
import { isNarrationPreamble } from '../detail/narration-preamble.js';
import { formatWorkDuration } from '../detail/work-trace.js';
import type { DiffFile, TodoRecord, TranscriptItem, WorkStep } from '../fixtures/records.js';
import type { ThreadUsageSummary } from './thread-usage-model.js';

export type EngineRunState = 'running' | 'waiting' | 'finished' | 'failed' | 'taken_over';
export type EngineAnswer = 'allowed' | 'refused';

export interface EnginePlanStep {
  text: string;
  state: 'done' | 'doing' | 'todo';
}

export type EngineEvent =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'read'; id: string; path: string; lines: number; seconds: number }
  | { kind: 'edit'; id: string; file: DiffFile }
  | {
      kind: 'run';
      id: string;
      command: string;
      exit: number | null;
      output: string[];
      seconds: number;
    }
  | { kind: 'question'; id: string; text: string; answer: EngineAnswer | null }
  | { kind: 'unknown'; id: string; type: string; payload: string };

export interface EngineRun {
  engine: string;
  state: EngineRunState;
  elapsedSeconds: number | null;
  costUsd: number | null;
  plan: EnginePlanStep[];
  events: EngineEvent[];
  rawOutput: string;
}

export interface EngineRunActions {
  answer: (eventId: string, answer: EngineAnswer) => void;
  takeOver: () => void;
  handBack: () => void;
}

export interface EngineRunView {
  run: EngineRun;
  actions?: EngineRunActions;
  controls?: ReactNode;
  phase?: TodoRecord['phase'];
}

export type EngineRunStage = ComponentType<{
  children: (view: EngineRunView) => ReactNode;
}>;

function engineCost(costUsd: number | null): string | null {
  if (costUsd === null) return null;
  return `$${costUsd < 0.01 && costUsd > 0 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

export function engineUsageSummary(
  summary: ThreadUsageSummary,
  run: EngineRun,
): ThreadUsageSummary {
  return {
    ...summary,
    engines: [run.engine],
    duration:
      run.elapsedSeconds === null ? summary.duration : formatWorkDuration(run.elapsedSeconds),
    cost: engineCost(run.costUsd) ?? summary.cost,
  };
}

export function engineCanTakeOver(state: EngineRunState): boolean {
  return state === 'running' || state === 'waiting';
}

const settled = { error: false, running: false, unfinished: false } as const;

function engineWorkStep(event: Exclude<EngineEvent, { kind: 'text' | 'question' }>): WorkStep {
  switch (event.kind) {
    case 'read':
      return {
        kind: 'call',
        id: event.id,
        action: 'read',
        label: 'read',
        target: event.path,
        output: null,
        seconds: event.seconds,
        ...settled,
      };
    case 'edit': {
      const lines = event.file.hunks.flatMap((hunk) => hunk.lines);
      return {
        kind: 'call',
        id: event.id,
        action: 'edit',
        label: 'edit',
        target: event.file.path,
        diff: { added: event.file.added, removed: event.file.removed ?? 0 },
        changes: {
          added: lines.filter((line) => line.kind === 'add').map((line) => line.text),
          removed: lines.filter((line) => line.kind === 'del').map((line) => line.text),
        },
        output: null,
        seconds: null,
        ...settled,
      };
    }
    case 'run':
      return {
        kind: 'call',
        id: event.id,
        action: 'run',
        label: 'bash',
        command: event.command,
        output: event.output.length > 0 ? event.output.join('\n') : null,
        seconds: event.seconds,
        error: event.exit !== null && event.exit !== 0,
        running: event.exit === null,
        unfinished: false,
      };
    case 'unknown':
      return {
        kind: 'call',
        id: event.id,
        action: 'tool',
        label: event.type,
        target: event.type,
        output: event.payload,
        seconds: null,
        ...settled,
      };
  }
}

export function enginePendingQuestion(
  run: EngineRun,
): Extract<EngineEvent, { kind: 'question' }> | null {
  const last = run.events.at(-1);
  return last?.kind === 'question' && last.answer === null ? last : null;
}

export function engineTranscript(run: EngineRun): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pending = enginePendingQuestion(run);
  const visible = run.events.filter((event) => event !== pending);
  let steps: WorkStep[] = [];
  const flush = (id: string) => {
    if (steps.length === 0) return;
    const isRunning = steps.some((step) => step.kind === 'call' && step.running);
    items.push({
      kind: 'work',
      id: `engine-work-${id}`,
      steps,
      ...(isRunning ? { running: true } : {}),
    });
    steps = [];
  };
  for (let index = 0; index < visible.length; index++) {
    const event = visible[index];
    if (!event) continue;
    const nextEvent = visible[index + 1];
    if (event.kind === 'text') {
      if (
        isNarrationPreamble(event.text) &&
        nextEvent !== undefined &&
        nextEvent.kind !== 'text' &&
        nextEvent.kind !== 'question'
      ) {
        flush(event.id);
        steps.push({ kind: 'say', id: event.id, text: event.text });
      } else {
        flush(event.id);
        items.push({ kind: 'robot', id: event.id, markdown: event.text });
      }
    } else if (event.kind === 'question') {
      flush(event.id);
      items.push({ kind: 'robot', id: event.id, markdown: event.text });
      items.push({
        kind: 'note',
        id: `${event.id}-answer`,
        text: event.answer === 'allowed' ? '已允许这一次' : '已拒绝',
      });
    } else {
      steps.push(engineWorkStep(event));
    }
  }
  flush('end');
  if (run.plan.length > 0) {
    const todoRow: TranscriptItem = { kind: 'agent-todo', items: run.plan };
    const tail = items.at(-1);
    if (tail?.kind === 'work' && tail.running === true) {
      items.splice(items.length - 1, 0, todoRow);
    } else {
      items.push(todoRow);
    }
  }
  return items;
}
