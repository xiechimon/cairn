import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const SUBAGENT_TASK_TYPE = 'local_agent';
const FINISHED_MAX = 10;
const SETTLED_MEMORY = 50;
const DESCRIPTION_MAX = 200;
const SUMMARY_MAX = 2000;
const OUTPUT_FILE_MAX = 500;

export interface FinishedSubagent {
  description: string;
  status: string;
  outputFile: string;
  summary: string;
}

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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

export class BackgroundSubagents {
  private readonly descriptions = new Map<string, string>();
  private readonly foreground = new Set<string>();
  private readonly awaitingResult = new Set<string>();
  private readonly settled = new Set<string>();
  private live = new Set<string>();
  private finished: FinishedSubagent[] = [];
  private omitted = 0;

  note(msg: SDKMessage): void {
    const m = msg as TaskMessage;
    if (m.type !== 'system' || m.subtype === undefined) return;
    if (m.subtype === 'task_started') this.noteStarted(m);
    else if (m.subtype === 'task_updated') this.noteUpdated(m);
    else if (m.subtype === 'background_tasks_changed') this.noteLevel(m);
    else if (m.subtype === 'task_notification') this.noteSettled(m);
  }

  get pending(): readonly string[] {
    return [...this.live, ...this.awaitingResult].map((id) => this.descriptions.get(id) ?? id);
  }

  takeFinished(): { finished: FinishedSubagent[]; omitted: number } {
    const taken = { finished: this.finished, omitted: this.omitted };
    this.finished = [];
    this.omitted = 0;
    return taken;
  }

  private noteStarted(m: TaskMessage): void {
    if (m.task_id === undefined || m.task_type !== SUBAGENT_TASK_TYPE) return;
    this.descriptions.set(m.task_id, clip(m.description ?? m.task_id, DESCRIPTION_MAX));
    if (m.is_backgrounded === true) this.live.add(m.task_id);
    else this.foreground.add(m.task_id);
  }

  private noteUpdated(m: TaskMessage): void {
    if (m.task_id === undefined || !this.foreground.has(m.task_id)) return;
    if (m.patch?.description !== undefined)
      this.descriptions.set(m.task_id, clip(m.patch.description, DESCRIPTION_MAX));
    if (m.patch?.is_backgrounded !== true) return;
    this.foreground.delete(m.task_id);
    this.live.add(m.task_id);
  }

  private noteLevel(m: TaskMessage): void {
    const next = new Set<string>();
    for (const task of m.tasks ?? []) {
      if (task.task_id === undefined || task.task_type !== SUBAGENT_TASK_TYPE) continue;
      if (task.ambient === true || this.settled.has(task.task_id)) continue;
      if (!this.descriptions.has(task.task_id))
        this.descriptions.set(
          task.task_id,
          clip(task.description ?? task.task_id, DESCRIPTION_MAX),
        );
      this.foreground.delete(task.task_id);
      this.awaitingResult.delete(task.task_id);
      next.add(task.task_id);
    }
    for (const id of this.live) if (!next.has(id)) this.awaitingResult.add(id);
    this.live = next;
  }

  private noteSettled(m: TaskMessage): void {
    const id = m.task_id;
    if (id === undefined) return;
    if (this.foreground.delete(id)) {
      this.descriptions.delete(id);
      return;
    }
    if (!this.live.has(id) && !this.awaitingResult.has(id)) return;
    this.live.delete(id);
    this.awaitingResult.delete(id);
    this.remember(id);
    if (this.finished.length < FINISHED_MAX) {
      this.finished.push({
        description: this.descriptions.get(id) ?? id,
        status: clip(m.status ?? 'settled', DESCRIPTION_MAX),
        outputFile: clip(m.output_file ?? '', OUTPUT_FILE_MAX),
        summary: clip(m.summary ?? '', SUMMARY_MAX),
      });
    } else {
      this.omitted += 1;
    }
    this.descriptions.delete(id);
  }

  private remember(id: string): void {
    this.settled.add(id);
    if (this.settled.size <= SETTLED_MEMORY) return;
    const oldest = this.settled.values().next().value;
    if (oldest !== undefined) this.settled.delete(oldest);
  }
}
