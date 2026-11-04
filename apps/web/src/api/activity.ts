import type { StepActivity } from '@cairn/shared';
import type { TVars } from '../i18n/translate.js';

type Listener = () => void;

const current = new Map<string, StepActivity>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const activityStore = {
  set(conversationId: string, activity: StepActivity): void {
    current.set(conversationId, activity);
    emit();
  },
  clear(conversationId: string): void {
    if (current.delete(conversationId)) emit();
  },
  get(conversationId: string): StepActivity | null {
    return current.get(conversationId) ?? null;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function activityLabel(activity: StepActivity): { label: string; vars?: TVars } {
  switch (activity.phase) {
    case 'preparing':
      return { label: '准备工作区...' };
    case 'starting':
      return { label: '正在连接模型...' };
    case 'thinking':
      return { label: '模型思考中...' };
    case 'responding':
      return { label: '模型输出中...' };
    case 'tool':
      return { label: '正在执行工具：{n}', vars: { n: activity.tool ?? 'tool' } };
    case 'retrying':
      return { label: '自动重试中（第 {n} 轮）...', vars: { n: activity.attempt ?? 1 } };
    case 'compacting':
      return { label: '正在压缩上下文...' };
    case 'awaiting_model':
      return { label: '等待模型响应...' };
  }
}
