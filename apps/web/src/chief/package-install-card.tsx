import { cn } from 'cn';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

type PackageInstallItem = Extract<ChiefStreamItem, { kind: 'package-install' }>;

type Decision = 'approve' | 'decline';
type Problem = 'owner-only' | 'closed' | 'failed' | null;

export function PackageInstallCard({ item }: { item: PackageInstallItem }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const { decidePackageInstall } = useApiMutations(teamId);
  const [decided, setDecided] = useState<Decision | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const waiting = item.outcome === 'waiting';
  const asking = waiting && decided === null;

  const decide = (decision: Decision) => {
    setProblem(null);
    decidePackageInstall.mutate(
      { packages: item.packages, decision },
      {
        onSuccess: () => setDecided(decision),
        onError: (error) =>
          setProblem(
            error instanceof ApiError && error.status === 403
              ? 'owner-only'
              : error instanceof ApiError && error.status === 409
                ? 'closed'
                : 'failed',
          ),
      },
    );
  };

  const title = waiting
    ? decided === 'approve'
      ? t('正在安装系统软件')
      : decided === 'decline'
        ? t('没有安装')
        : t('Coordinator 想安装系统软件')
    : item.outcome === 'installed'
      ? t('已安装系统软件')
      : t('没有安装');

  const meta = waiting
    ? decided === null
      ? t('批准后以 root 装进它的电脑，电脑更新或恢复后会自动重装。')
      : null
    : item.outcome === 'declined'
      ? t('你拒绝了这次安装。')
      : item.outcome === 'not-answered'
        ? t('没有等到批准，这一步已停止。')
        : item.outcome === 'failed'
          ? t('安装没有完成，Coordinator 会说明原因。')
          : null;

  const problemText =
    problem === 'owner-only'
      ? t('只有这台 Cairn 的所有者能批准安装。')
      : problem === 'closed'
        ? t('这次安装请求已经结束。')
        : problem === 'failed'
          ? t('没能提交，请稍后重试。')
          : null;

  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }} className="mt-5">
      <section
        data-testid="chief-package-install"
        data-outcome={waiting && decided !== null ? `${decided}d` : item.outcome}
        aria-label={t('安装系统软件')}
        className={cn(REPLY_BUBBLE_CLS, 'flex flex-col gap-1 py-3')}
      >
        <p className="m-0 flex items-center gap-2 text-ui font-title text-foreground">
          {asking && (
            <span
              aria-hidden="true"
              data-slot="needs-you-dot"
              className="size-1.5 flex-none rounded-full bg-(--card-button)"
            />
          )}
          {title}
        </p>
        <p
          className="m-0 flex flex-wrap gap-x-2 gap-y-1 text-meta text-foreground"
          data-testid="chief-package-install-names"
        >
          {item.packages.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </p>
        {meta !== null && <p className="m-0 text-meta text-content-secondary">{meta}</p>}
        {asking && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              className="pointer-coarse:h-11 pointer-coarse:px-4"
              disabled={decidePackageInstall.isPending}
              data-testid="chief-package-install-approve"
              onClick={() => decide('approve')}
            >
              {t('批准安装')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="pointer-coarse:h-11 pointer-coarse:px-4"
              disabled={decidePackageInstall.isPending}
              data-testid="chief-package-install-decline"
              onClick={() => decide('decline')}
            >
              {t('拒绝')}
            </Button>
          </div>
        )}
        {problemText !== null && (
          <p
            role="alert"
            className="m-0 text-meta text-destructive"
            data-testid="chief-package-install-problem"
          >
            {problemText}
          </p>
        )}
      </section>
    </MessageScrollerItem>
  );
}
