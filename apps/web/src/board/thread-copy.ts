import type { StoneTone } from '../components/stone/tone.js';
import type { TodoRecord } from '../fixtures/records.js';
import { STATUS_WORDS } from './status-words.js';

export type ThreadStatus = 'running' | 'needs-you' | 'failed' | 'done' | 'idle';

const THREAD_TONE: Record<ThreadStatus, StoneTone> = {
  running: 'working',
  'needs-you': 'waiting',
  failed: 'failed',
  done: 'resolved',
  idle: 'idle',
};

export function threadStatus(todo: TodoRecord): ThreadStatus {
  switch (todo.phase) {
    case 'queued':
    case 'planning':
    case 'building':
      return 'running';
    case 'confirm':
    case 'needs_input':
    case 'review':
      return 'needs-you';
    case 'failed':
      return 'failed';
    case 'done':
    case 'closed':
      return 'done';
    case 'todo':
      return 'idle';
  }
}

export const THREAD_PARAM = 'thread';

export const VIEW_PARAM = 'view';

export function threadHref(id: string, homeSearch: string): string {
  const params = new URLSearchParams(homeSearch);
  params.set(THREAD_PARAM, id);
  params.delete(VIEW_PARAM);
  return `/app?${params.toString()}`;
}

export function threadHrefFrom(id: string, search: string): string {
  const scenario = new URLSearchParams(search).get('scenario');
  return threadHref(id, scenario === null ? '' : new URLSearchParams({ scenario }).toString());
}

export interface ThreadCopy {
  state: string;
  reason: string;
  primary?: string;
}

export function threadCopy(todo: TodoRecord): ThreadCopy {
  if (todo.quotaWait != null) {
    return {
      state: STATUS_WORDS.running,
      reason:
        todo.quotaWait.kind === 'quota'
          ? '额度空了，等额度恢复后自动续跑。'
          : '被限流，等恢复后自动续跑。',
    };
  }
  switch (todo.phase) {
    case 'needs_input':
      return { state: STATUS_WORDS.needsYou, reason: '在问你一个问题。', primary: '回答' };
    case 'confirm':
      return {
        state: STATUS_WORDS.needsYou,
        reason: '计划已就绪，批准后开工。',
        primary: '看计划',
      };
    case 'review':
      return { state: STATUS_WORDS.needsYou, reason: '已就绪，等你审阅。', primary: '审阅' };
    case 'failed':
      return { state: STATUS_WORDS.failed, reason: '失败了，打开它重试。' };
    case 'queued':
      return { state: STATUS_WORDS.running, reason: '排队等 Runner。' };
    case 'planning':
      return { state: STATUS_WORDS.running, reason: '正在写计划。' };
    case 'building':
      return { state: STATUS_WORDS.running, reason: '正在动手。' };
    case 'done':
      return { state: STATUS_WORDS.done, reason: '任务已完成，发送消息即可继续。' };
    case 'closed':
      return { state: STATUS_WORDS.cancelled, reason: '任务已取消。' };
    case 'todo':
      return { state: STATUS_WORDS.idle, reason: '还没开始。' };
  }
}

export function threadTone(todo: TodoRecord): StoneTone {
  if (todo.phase === 'done' || todo.phase === 'closed') return 'resolved';
  if (todo.snoozeMode != null) return 'idle';
  if (todo.phase === 'review') return 'review';
  return THREAD_TONE[threadStatus(todo)];
}
