import { type AgentTodoItem, parseAgentTodoText } from '@cairn/shared';

export { parseAgentTodoText };

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
