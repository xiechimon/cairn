import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export interface QuotaBannerInfo {
  lane: string;
  kindText: string;
  count: number;
  probe: string;
}

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

export function QuotaBanner({ infos }: { infos: QuotaBannerInfo[] }) {
  const { t } = useI18n();
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
