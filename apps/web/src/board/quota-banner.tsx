// 看板「等额度」横幅（#1261）：任一任务 waiting_quota 挂起时顶条显性——
// 哪一路 relay、什么事件（额度空/限流）、几个任务挂起、下次探测时刻。
// 票面三件套的「横幅」半（卡态 = todo-card 芯片、通知 = quota_wait 行）。
// 几何与 notify-banner 同族（banner 槽 + card-tier 视觉），数据面 = 既有
// todos 集合（todo doc SSE 失效重取已覆盖——挂起/释放都发 todo doc 事件，
// 横幅随之出现/消失，无独立订阅面）。live 与 fixture 面同判（fixture 的
// quotaWait 行走 scenario 数据）。

import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

/** 挂起聚合行：按 relay lane + 事件类型分组的显示形状。 */
export interface QuotaBannerInfo {
  lane: string;
  kindText: string;
  count: number;
  probe: string;
}

/** todos → 横幅聚合（纯函数；多 lane 多条，同 lane 同 kind 合并，probe 取
 * 最近的探测时刻——「什么时候恢复」答最早的那个）。null = 无挂起不渲染。 */
export function quotaBannerInfo(todos: readonly TodoRecord[]): QuotaBannerInfo[] | null {
  const groups = new Map<string, QuotaBannerInfo>();
  for (const todo of todos) {
    const q = todo.quotaWait;
    if (q == null) continue;
    const lane = q.label ?? q.providerId;
    const key = `${lane}|${q.kind}`;
    const kindText = q.kind === 'quota' ? '额度空' : '限流';
    const probe = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(q.probeAt);
    const prev = groups.get(key);
    if (prev === undefined) {
      groups.set(key, { lane, kindText, count: 1, probe });
      continue;
    }
    prev.count += 1;
    if (probe < prev.probe) prev.probe = probe;
  }
  return groups.size === 0 ? null : [...groups.values()];
}

/** 顶条横幅本体（e2e 锚 = data-quota-banner）。 */
export function QuotaBanner({ infos }: { infos: QuotaBannerInfo[] }) {
  const { t } = useI18n();
  // 单 lane 形 = 聚合行直陈（lane/kind/count/probe 全位）；多 lane 形退计数
  // 摘要（详情归各卡芯片，横幅不排队列清单）。
  const single = infos.length === 1 ? infos[0] : null;
  return (
    <section
      data-quota-banner="true"
      className="board-notify-banner flex h-16 items-center rounded-2xl border-0 bg-(--secondary) px-4 [box-shadow:var(--edge-ring),var(--card-shadow)]"
      aria-label={t('等额度')}
    >
      <span className="flex size-7 flex-none items-center justify-center rounded-full bg-(--badge-attention) text-[10px] leading-none font-bold text-(--badge-attention-fg)">
        …
      </span>
      <div className="ml-3.5 min-w-0">
        <div className="text-sm leading-5 font-medium text-foreground">
          {single != null
            ? t('{lane} {kind}，{count} 个任务挂起等额度', {
                lane: single.lane,
                kind: single.kindText,
                count: single.count,
              })
            : t('{count} 个任务因额度/限流挂起', { count: infos.length })}
        </div>
        <div className="text-xs leading-4 text-muted-foreground">
          {single != null
            ? t('额度恢复后自动续跑；{probe} 自动探测', { probe: single.probe })
            : t('额度恢复后自动续跑，无需人工操作')}
        </div>
      </div>
    </section>
  );
}
