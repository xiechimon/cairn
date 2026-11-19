import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { BACKGROUND_TASK_TEXT_MAX, type BackgroundTask } from '@cairn/shared';

const TASK_TYPES: Record<string, BackgroundTask['type']> = {
  local_agent: 'agent',
  local_bash: 'shell',
};

const SETTLED_STATUS: Record<string, BackgroundTask['status']> = {
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped',
  killed: 'stopped',
};

interface TaskFrame {
  type?: string;
  subtype?: string;
  task_id?: string;
  tool_use_id?: string;
  task_type?: string;
  description?: string;
  prompt?: string;
  ambient?: boolean;
  is_backgrounded?: boolean;
  status?: string;
  summary?: string;
  usage?: { total_tokens?: number; tool_uses?: number };
  patch?: { status?: string; description?: string; end_time?: number; is_backgrounded?: boolean };
}

function clip(text: string): string {
  return text.length > BACKGROUND_TASK_TEXT_MAX ? text.slice(0, BACKGROUND_TASK_TEXT_MAX) : text;
}

export class BackgroundTaskRows {
  private readonly tasks = new Map<string, BackgroundTask>();
  private readonly foreground = new Map<string, BackgroundTask>();
  readonly unknownTypes = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  note(msg: SDKMessage): BackgroundTask[] {
    const m = msg as TaskFrame;
    if (m.type !== 'system' || m.task_id === undefined) return [];
    if (m.subtype === 'task_started') return this.started(m, m.task_id);
    const waiting = this.foreground.get(m.task_id);
    if (waiting !== undefined) {
      if (m.subtype === 'task_notification') this.foreground.delete(m.task_id);
      if (m.subtype !== 'task_updated' || m.patch?.is_backgrounded !== true) return [];
      this.foreground.delete(m.task_id);
      return this.put({ ...waiting, startedAt: this.now() });
    }
    const task = this.tasks.get(m.task_id);
    if (task === undefined || task.status !== 'running') return [];
    if (m.subtype === 'task_progress') {
      return this.put({
        ...task,
        ...(m.usage?.tool_uses !== undefined ? { toolUses: m.usage.tool_uses } : {}),
        ...(m.usage?.total_tokens !== undefined ? { tokens: m.usage.total_tokens } : {}),
        ...(m.summary ? { summary: clip(m.summary) } : {}),
      });
    }
    if (m.subtype === 'task_updated') {
      const status = SETTLED_STATUS[m.patch?.status ?? ''];
      const description = m.patch?.description;
      if (status === undefined && description === undefined) return [];
      return this.put({
        ...task,
        ...(description !== undefined ? { description: clip(description) } : {}),
        ...(status !== undefined ? { status, endedAt: m.patch?.end_time ?? this.now() } : {}),
      });
    }
    if (m.subtype === 'task_notification') {
      return this.put({
        ...task,
        status: SETTLED_STATUS[m.status ?? ''] ?? 'done',
        endedAt: this.now(),
        ...(m.usage?.tool_uses !== undefined ? { toolUses: m.usage.tool_uses } : {}),
        ...(m.usage?.total_tokens !== undefined ? { tokens: m.usage.total_tokens } : {}),
        ...(m.summary ? { summary: clip(m.summary) } : {}),
      });
    }
    return [];
  }

  settleRunning(status: 'orphaned' | 'stopped'): BackgroundTask[] {
    const at = this.now();
    return [...this.tasks.values()]
      .filter((task) => task.status === 'running')
      .flatMap((task) => this.put({ ...task, status, endedAt: at }));
  }

  get running(): readonly BackgroundTask[] {
    return [...this.tasks.values()].filter((task) => task.status === 'running');
  }

  private started(m: TaskFrame, taskId: string): BackgroundTask[] {
    if (m.ambient === true) return [];
    const type = TASK_TYPES[m.task_type ?? ''];
    if (type === undefined) {
      const key = m.task_type ?? 'unknown';
      this.unknownTypes.set(key, (this.unknownTypes.get(key) ?? 0) + 1);
      return [];
    }
    const task: BackgroundTask = {
      taskId,
      ...(m.tool_use_id !== undefined ? { toolCallId: m.tool_use_id } : {}),
      type,
      description: clip(m.description ?? taskId),
      ...(m.prompt ? { prompt: clip(m.prompt) } : {}),
      status: 'running',
      startedAt: this.now(),
    };
    const backgrounded = m.is_backgrounded ?? type === 'shell';
    if (!backgrounded) {
      this.foreground.set(taskId, task);
      return [];
    }
    return this.put(task);
  }

  private put(task: BackgroundTask): BackgroundTask[] {
    this.tasks.set(task.taskId, task);
    return [task];
  }
}
