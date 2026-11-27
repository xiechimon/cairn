import type { ChiefStreamItem } from '../fixtures/records.js';
import { THREAD_PARAM } from './thread-copy.js';

export const MESSAGE_PARAM = 'msg';
export const MAX_MESSAGE_JUMP_PAGES = 20;

export interface MessageJumpView {
  loaded: boolean;
  stream: readonly ChiefStreamItem[];
  hasEarlier: boolean;
  loadingEarlier: boolean;
  failedEarlier: boolean;
  pagesLoaded: number;
}

export type MessageJumpStep =
  | { kind: 'idle' }
  | { kind: 'wait' }
  | { kind: 'focus'; messageId: string }
  | { kind: 'load-earlier' }
  | { kind: 'missing' };

export function messageHitHref(
  hit: { id: string; threadId: string; projectId: string | null },
  currentSearch: string,
): string {
  const params = new URLSearchParams();
  const scenario = new URLSearchParams(currentSearch).get('scenario');
  if (scenario !== null) params.set('scenario', scenario);
  if (hit.projectId !== null) {
    params.set('project', hit.projectId);
    params.set('chat', '1');
  } else {
    params.set('chief', hit.threadId);
  }
  params.set(MESSAGE_PARAM, hit.id);
  params.delete(THREAD_PARAM);
  return `/app?${params.toString()}`;
}

export function messageJumpStep(targetId: string | null, view: MessageJumpView): MessageJumpStep {
  if (targetId === null || targetId === '') return { kind: 'idle' };
  if (!view.loaded) return { kind: 'wait' };
  if (view.stream.some((item) => 'id' in item && item.id === targetId)) {
    return { kind: 'focus', messageId: targetId };
  }
  if (!view.hasEarlier || view.failedEarlier || view.pagesLoaded >= MAX_MESSAGE_JUMP_PAGES) {
    return { kind: 'missing' };
  }
  return view.loadingEarlier ? { kind: 'wait' } : { kind: 'load-earlier' };
}
