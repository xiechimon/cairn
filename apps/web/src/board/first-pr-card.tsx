import { type FirstPrReportPrompt, firstPrDiscussionUrl } from '@cairn/shared';
import { GitMerge } from 'lucide-react';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

export interface FirstPrCardInfo {
  href: string;
  title: string;
  body: string;
  daysToFirstPr: number | null;
}

export function firstPrCardInfo(
  prompt: FirstPrReportPrompt,
  teamCreatedAt: number,
): FirstPrCardInfo | null {
  if (!prompt.enabled || !prompt.due || prompt.dismissedAt !== null) return null;
  if (prompt.firstPrAt === null) return null;
  const elapsed = prompt.firstPrAt - teamCreatedAt;
  const daysToFirstPr = elapsed < 0 ? null : Math.floor(elapsed / 86_400_000);
  const href = firstPrDiscussionUrl({ daysToFirstPr });
  return {
    href,
    title: 'A first gated PR merged',
    body:
      daysToFirstPr === null
        ? 'Cairn can open a prefilled post in GitHub Discussions. Nothing is sent unless you submit it.'
        : `Cairn can open a prefilled post in GitHub Discussions. Nothing is sent unless you submit it. First PR: ${daysToFirstPr} days after starting.`,
    daysToFirstPr,
  };
}

export function FirstPrCard({ info, onDismiss }: { info: FirstPrCardInfo; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <NoticeBanner
      data-first-pr-card="true"
      aria-label={t('首个 PR')}
      tone="info"
      icon={GitMerge}
      title={t('首个 PR 已合并')}
      body={
        info.daysToFirstPr === null
          ? t('可以在 GitHub Discussions 发一条帖子，说明第一支 PR 用了多久')
          : t('第一支 PR 用了 {days} 天。可以在 GitHub Discussions 发一条帖子', {
              days: info.daysToFirstPr,
            })
      }
      actions={
        <>
          <Button variant="ghost" size="sm" className="text-content-secondary" onClick={onDismiss}>
            {t('不再显示')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="px-3"
            render={<a href={info.href} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            {t('分享到 Discussions')}
          </Button>
        </>
      }
    />
  );
}
