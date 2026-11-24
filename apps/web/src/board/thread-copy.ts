import { isInfoOutput } from '@cairn/shared';
import type { TodoRecord } from '../fixtures/records.js';
import { FILE_NAME_PARAM, FILE_PARAM } from './file-pane.js';
import { STATUS_WORDS } from './status-words.js';

export type ThreadStatus = 'running' | 'needs-you' | 'failed' | 'done' | 'idle';

export function reviewOwnedByCoordinator(
  todo: Pick<TodoRecord, 'phase' | 'owner' | 'section' | 'output'>,
): boolean {
  if (todo.phase !== 'review') return false;
  if (todo.owner === 'coordinator') return true;
  if (todo.owner === 'owner' || todo.section === 'ready_for_review') return false;
  return isInfoOutput(todo.output);
}

export function threadStatus(todo: TodoRecord): ThreadStatus {
  switch (todo.phase) {
    case 'queued':
    case 'planning':
    case 'building':
      return 'running';
    case 'confirm':
    case 'needs_input':
      return 'needs-you';
    case 'review':
      return reviewOwnedByCoordinator(todo) ? 'running' : 'needs-you';
    case 'failed':
      return 'failed';
    case 'done':
    case 'stopped':
    case 'closed':
      return 'done';
    case 'todo':
      return 'idle';
  }
}

export const THREAD_PARAM = 'thread';

export const VIEW_PARAM = 'view';

export function withThread(search: string | URLSearchParams, id: string): URLSearchParams {
  const params = new URLSearchParams(search);
  params.set(THREAD_PARAM, id);
  params.delete(VIEW_PARAM);
  params.delete(FILE_PARAM);
  params.delete(FILE_NAME_PARAM);
  return params;
}

export function threadHref(id: string, homeSearch: string): string {
  return `/app?${withThread(homeSearch, id).toString()}`;
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
          ? '额度已用完，额度恢复后自动继续运行。'
          : '被限流，恢复后自动继续运行。',
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
      return reviewOwnedByCoordinator(todo)
        ? { state: STATUS_WORDS.inReview, reason: 'Coordinator 在跟进。' }
        : { state: STATUS_WORDS.needsYou, reason: '已就绪，等你审阅。', primary: '审阅' };
    case 'failed':
      return { state: STATUS_WORDS.failed, reason: '失败了，打开它重试。' };
    case 'queued':
      return todo.section === 'up_next'
        ? { state: STATUS_WORDS.waiting, reason: '等前置任务完成。' }
        : { state: STATUS_WORDS.running, reason: '准备开工。' };
    case 'planning':
      return { state: STATUS_WORDS.running, reason: '正在写计划。' };
    case 'building':
      return { state: STATUS_WORDS.running, reason: '正在动手。' };
    case 'done':
      return { state: STATUS_WORDS.done, reason: '任务已完成，发送消息即可继续。' };
    case 'stopped':
      return { state: STATUS_WORDS.stopped, reason: '你停下了它，发送消息即可重新开始。' };
    case 'closed':
      return { state: STATUS_WORDS.archived, reason: '任务已归档。' };
    case 'todo':
      return { state: STATUS_WORDS.idle, reason: '尚未开始。' };
  }
}
