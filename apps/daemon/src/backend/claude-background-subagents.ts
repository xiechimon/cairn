import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const SUBAGENT_TASK_TYPE = 'local_agent';

interface TaskMessage {
  type?: string;
  subtype?: string;
  task_id?: string;
  task_type?: string;
  is_backgrounded?: boolean;
  description?: string;
  status?: string;
  output_file?: string;
  summary?: string;
  patch?: { is_backgrounded?: boolean; description?: string };
  tasks?: { task_id?: string; task_type?: string; description?: string; ambient?: boolean }[];
}

export class BackgroundSubagents {
  private readonly descriptions = new Map<string, string>();
  private readonly foreground = new Set<string>();
  private readonly live = new Set<string>();
  private finished: string[] = [];

  note(msg: SDKMessage): void {
    const m = msg as TaskMessage;
    if (m.type !== 'system' || m.subtype === undefined) return;
    if (m.subtype === 'task_started') this.noteStarted(m);
    else if (m.subtype === 'task_updated') this.noteUpdated(m);
    else if (m.subtype === 'background_tasks_changed') this.noteLevel(m);
    else if (m.subtype === 'task_notification') this.noteSettled(m);
  }

  get running(): readonly string[] {
    return [...this.live].map((id) => this.descriptions.get(id) ?? id);
  }

  takeFinished(): string[] {
    return this.finished.splice(0);
  }

  private noteStarted(m: TaskMessage): void {
    if (m.task_id === undefined || m.task_type !== SUBAGENT_TASK_TYPE) return;
    this.descriptions.set(m.task_id, m.description ?? m.task_id);
    if (m.is_backgrounded === true) this.live.add(m.task_id);
    else this.foreground.add(m.task_id);
  }

  private noteUpdated(m: TaskMessage): void {
    if (m.task_id === undefined || !this.foreground.has(m.task_id)) return;
    if (m.patch?.description !== undefined) this.descriptions.set(m.task_id, m.patch.description);
    if (m.patch?.is_backgrounded !== true) return;
    this.foreground.delete(m.task_id);
    this.live.add(m.task_id);
  }

  private noteLevel(m: TaskMessage): void {
    for (const task of m.tasks ?? []) {
      if (task.task_id === undefined || task.task_type !== SUBAGENT_TASK_TYPE) continue;
      if (task.ambient === true || this.foreground.has(task.task_id)) continue;
      if (!this.descriptions.has(task.task_id))
        this.descriptions.set(task.task_id, task.description ?? task.task_id);
      this.live.add(task.task_id);
    }
  }

  private noteSettled(m: TaskMessage): void {
    if (m.task_id === undefined) return;
    this.foreground.delete(m.task_id);
    const description = this.descriptions.get(m.task_id);
    if (description === undefined && !this.live.has(m.task_id)) return;
    this.live.delete(m.task_id);
    this.descriptions.delete(m.task_id);
    this.finished.push(
      `- ${description ?? m.task_id}: ${m.status ?? 'settled'}. Output file: ${m.output_file ?? 'none'}. Summary: ${m.summary ?? 'none'}`,
    );
  }
}
