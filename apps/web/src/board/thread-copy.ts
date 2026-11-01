import type { StoneTone } from '../components/stone/tone.js';
import type { TodoRecord } from '../fixtures/records.js';
import { THREAD_TONE, threadStatus } from './sidebar-threads.js';

export interface ThreadCopy {
  state: string;
  reason: string;
  primary?: string;
}

export function threadCopy(todo: TodoRecord): ThreadCopy {
  if (todo.awaitingReply === true) {
    return { state: '待你处理', reason: '在问你一个问题。', primary: '回答' };
  }
  switch (todo.phase) {
    case 'confirm':
      return { state: '待你处理', reason: '计划已就绪，批准后开工。', primary: '看计划' };
    case 'review':
      return { state: '等你审阅', reason: '已就绪，等你审阅。', primary: '审阅' };
    case 'failed':
      return { state: '待你处理', reason: '失败了，打开它重试。' };
    case 'queued':
      return { state: '运行中', reason: '排队等机器。' };
    case 'planning':
      return { state: '运行中', reason: '正在写计划。' };
    case 'building':
      return { state: '运行中', reason: '正在动手。' };
    case 'done':
    case 'closed':
      return { state: '已解决', reason: '已完成。' };
    case 'todo':
      return { state: '空闲', reason: '还没开始。' };
  }
}

export function threadTone(todo: TodoRecord): StoneTone {
  if (todo.phase === 'done' || todo.phase === 'closed') return 'resolved';
  if (todo.phase === 'failed') return 'idle';
  if (todo.snoozeMode != null) return 'idle';
  if (todo.phase === 'review' && todo.awaitingReply !== true) return 'review';
  return THREAD_TONE[threadStatus(todo)];
}
