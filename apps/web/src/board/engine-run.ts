import type { ComponentType, ReactNode } from 'react';
import type { ActionStep } from '../components/chat/trace-steps.js';
import type { DiffFile, TodoRecord } from '../fixtures/records.js';
import type { TaskItem } from '../lib/markdown.js';

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

export interface EngineChoice {
  difficulty: 'easy' | 'standard' | 'hard';
  modelTier: 'inexpensive' | 'mid' | 'strong';
  effort: 'low' | 'medium' | 'high';
  reason: string;
}

export interface EngineRun {
  engine: string;
  state: EngineRunState;
  elapsedSeconds: number | null;
  costUsd: number | null;
  choice: EngineChoice;
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

export const ENGINE_STATE_WORDS = {
  running: '运行中',
  waiting: '等你输入',
  finished: '已完成',
  failed: '失败',
  taken_over: '你已接管',
} as const satisfies Record<EngineRunState, string>;

export const ENGINE_CHOICE_WORDS = {
  difficulty: { easy: '低难度', standard: '标准难度', hard: '高难度' },
  modelTier: { inexpensive: '经济模型', mid: '中档模型', strong: '强模型' },
  effort: { low: '低推理强度', medium: '中等推理强度', high: '高推理强度' },
} as const;

export function engineCost(costUsd: number | null): string | null {
  if (costUsd === null) return null;
  return `$${costUsd < 0.01 && costUsd > 0 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

export function engineCanTakeOver(state: EngineRunState): boolean {
  return state === 'running' || state === 'waiting';
}

export function enginePlanItems(plan: readonly EnginePlanStep[]): TaskItem[] {
  return plan.map((step) => ({
    state: step.state,
    segments: [{ text: step.text }],
    blocks: [],
  }));
}

export function engineTraceStep(event: Extract<EngineEvent, { kind: 'read' | 'run' }>): ActionStep {
  return event.kind === 'read'
    ? { kind: 'read', path: event.path, lines: event.lines, secs: event.seconds }
    : {
        kind: 'run',
        command: event.command,
        exit: event.exit,
        output: event.output,
        secs: event.seconds,
      };
}
