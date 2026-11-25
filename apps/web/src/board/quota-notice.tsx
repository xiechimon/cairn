import { NoticeLine } from '../components/chat/notice-line.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { formatRetryClock, quotaResumePhrase } from './retry-copy.js';

export interface QuotaNoticeInfo {
  lane: string;
  kind: 'quota' | 'capacity';
  kindText: string;
  count: number;
  probe: string;
  probeAt: number;
}

export function quotaNoticeInfo(todos: readonly TodoRecord[]): QuotaNoticeInfo[] | null {
  const groups = new Map<string, QuotaNoticeInfo>();
  for (const todo of todos) {
    const quota = todo.quotaWait;
    if (quota == null) continue;
    const lane = quota.label ?? quota.providerId;
    const key = `${lane}|${quota.kind}`;
    const kindText = quota.kind === 'quota' ? '额度空' : '限流';
    const probe = formatRetryClock(quota.probeAt);
    const previous = groups.get(key);
    if (previous === undefined) {
      groups.set(key, {
        lane,
        kind: quota.kind,
        kindText,
        count: 1,
        probe,
        probeAt: quota.probeAt,
      });
      continue;
    }
    previous.count += 1;
    if (quota.probeAt < previous.probeAt) {
      previous.probeAt = quota.probeAt;
      previous.probe = probe;
    }
  }
  return groups.size === 0 ? null : [...groups.values()];
}

export function QuotaNotice({ infos }: { infos: QuotaNoticeInfo[] }) {
  const { t } = useI18n();
  const single = infos.length === 1 ? infos[0] : null;
  const totalCount = infos.reduce((sum, item) => sum + item.count, 0);
  const earliest =
    infos.length === 0
      ? null
      : infos.reduce((min, item) => (item.probeAt < min.probeAt ? item : min)).probe;
  const singleLine = single != null ? quotaResumePhrase(single.kind, single.probeAt) : null;
  return (
    <div data-quota-banner="" className="mb-3">
      <NoticeLine
        tone="waiting"
        waiting
        label={
          <>
            <b className="font-semibold text-foreground">
              {single != null
                ? t('{lane} {kind}，{count} 个任务挂起等额度', {
                    lane: single.lane,
                    kind: t(single.kindText),
                    count: single.count,
                  })
                : t('{count} 个任务因额度/限流挂起', { count: totalCount })}
            </b>{' '}
            {singleLine != null
              ? t(singleLine.key, singleLine.params)
              : earliest !== null
                ? t('最早 {probe} 恢复后自动继续', { probe: earliest })
                : t('额度恢复后自动继续')}
          </>
        }
      />
    </div>
  );
}
