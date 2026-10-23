// 步活动相位 store（#905）：conversation stream 的 activity 事件按会话暂存
// （单槽 = 最后一份；步终态 / 流重建即清，与 liveTextStore 同律）。
// useSyncExternalStore 消费——组件外单例，SSE 回调直写。
//
// 失败方式（判定与 daemon 侧 test/activity.test.ts F1–F7 同票）：
//   W1 陈旧相位跨步：store 单槽按会话键控，消费侧再按 stepId 对在跑步过滤
//      （mapper 内）——上一跑步的「思考中」不会挂到下一跑步头上。
//   W2 死相位残留：step 终态事件（done/failed/stopped）与 resync 都清槽；
//      server hub 镜像同律（订阅补发只发生在步仍在飞时）。
//   W3 冻住的「最近信号」：新鲜度秒数由渲染层 1s 计时器对 activity.at 走表
//      （live-row useLiveSeconds 复用）——没有 at 就不渲染该行（#471：
//      缺席的数，不是冻结的数）。

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
  /** 步终态 / 流重建：清槽（W2）。 */
  clear(conversationId: string): void {
    if (current.delete(conversationId)) emit();
  },
  /** 快照读：返回存储的对象引用（稳定，useSyncExternalStore 安全）。 */
  get(conversationId: string): StepActivity | null {
    return current.get(conversationId) ?? null;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** 相位 → 活行标签（zh 源串 = i18n 键，en 走词典；单源在此，详情 + 总管
 *  两面共用——#873「不新起一套」同律）。vars 供 t() 插值（工具名 / 重试轮）。 */
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
