import {
  AGENT_TODO_LINE_RE,
  AGENT_TODO_MARKER_STATES,
  AGENT_TODO_MAX_ITEMS,
  type AgentTodoItem,
} from '@cairn/shared';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export function parseAgentTodoText(text: string): AgentTodoItem[] | null {
  let run: AgentTodoItem[] | null = null;
  let inFence = false;
  for (const raw of text.split('\n')) {
    if (FENCE_OPEN.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = AGENT_TODO_LINE_RE.exec(raw);
    if (m === null) {
      run = null;
      continue;
    }
    const content = (m[2] ?? '').trim();
    if (content === '') continue;
    const state = AGENT_TODO_MARKER_STATES[m[1] ?? ''];
    if (state === undefined) continue;
    run = run ?? [];
    if (run.length < AGENT_TODO_MAX_ITEMS) {
      run.push({ text: content, state });
    }
  }
  return run !== null && run.length > 0 ? run : null;
}

export interface AgentTodoReporterOptions {
  send: (items: AgentTodoItem[]) => Promise<unknown> | undefined;
  onFirstError: (err: unknown) => void;
}

export class AgentTodoReporter {
  private last: AgentTodoItem[] | null = null;
  private failed = false;

  constructor(private readonly options: AgentTodoReporterOptions) {}

  report(items: readonly AgentTodoItem[]): void {
    if (items.length === 0) return;
    if (
      this.last !== null &&
      this.last.length === items.length &&
      this.last.every((it, i) => {
        const next = items[i];
        return next !== undefined && it.text === next.text && it.state === next.state;
      })
    ) {
      return;
    }
    this.last = items.map((it) => ({ ...it }));
    this.options.send(items.map((it) => ({ ...it })))?.catch((err: unknown) => {
      if (this.failed) return;
      this.failed = true;
      this.options.onFirstError(err);
    });
  }
}
