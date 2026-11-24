import { Hourglass } from 'lucide-react';
import { NoticeBanner } from '../components/notice-banner.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { formatRetryClock, quotaResumePhrase } from './retry-copy.js';

export interface QuotaBannerInfo {
  lane: string;
  kind: 'quota' | 'capacity';
  kindText: string;
  count: number;
  probe: string;
  probeAt: number;
}

export function quotaBannerInfo(todos: readonly TodoRecord[]): QuotaBannerInfo[] | null {
  const groups = new Map<string, QuotaBannerInfo>();
  for (const todo of todos) {
    const q = todo.quotaWait;
    if (q == null) continue;
    const lane = q.label ?? q.providerId;
    const key = `${lane}|${q.kind}`;
    const kindText = q.kind === 'quota' ? '额度空' : '限流';
    const probe = formatRetryClock(q.probeAt);
    const prev = groups.get(key);
    if (prev === undefined) {
      groups.set(key, { lane, kind: q.kind, kindText, count: 1, probe, probeAt: q.probeAt });
      continue;
    }
    prev.count += 1;
    if (q.probeAt < prev.probeAt) {
      prev.probeAt = q.probeAt;
      prev.probe = probe;
    }
  }
  return groups.size === 0 ? null : [...groups.values()];
}

export function QuotaBanner({ infos }: { infos: QuotaBannerInfo[] }) {
  const { t } = useI18n();
  const single = infos.length === 1 ? infos[0] : null;
  const earliest =
    infos.length === 0
      ? null
      : infos.reduce((min, item) => (item.probeAt < min.probeAt ? item : min)).probe;
  const singleLine = single != null ? quotaResumePhrase(single.kind, single.probeAt) : null;
  return (
    <NoticeBanner
      data-quota-banner="true"
      aria-label={t('等额度')}
      tone="waiting"
      icon={Hourglass}
      title={
        single != null
          ? t('{lane} {kind}，{count} 个任务挂起等额度', {
              lane: single.lane,
              kind: t(single.kindText),
              count: single.count,
            })
          : t('{count} 个任务因额度/限流挂起', { count: infos.length })
      }
      body={
        singleLine != null
          ? t(singleLine.key, singleLine.params)
          : earliest !== null
            ? t('最早 {probe} 恢复后自动继续', { probe: earliest })
            : t('额度恢复后自动继续')
      }
    />
  );
}
