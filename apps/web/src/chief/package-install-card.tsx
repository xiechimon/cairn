import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalCard } from './approval-card.js';

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
      <ApprovalCard
        testId="chief-package-install"
        outcome={waiting && decided !== null ? `${decided}d` : item.outcome}
        waiting={asking}
        card={{
          title,
          summary: null,
          fields: [{ label: t('软件包'), value: item.packages.join(' '), mono: true }],
          details: [],
          note: meta,
        }}
        disabled={decidePackageInstall.isPending}
        actions={
          asking
            ? [
                {
                  label: t('批准安装'),
                  primary: true,
                  testId: 'chief-package-install-approve',
                  onClick: () => decide('approve'),
                },
                {
                  label: t('拒绝'),
                  primary: false,
                  testId: 'chief-package-install-decline',
                  onClick: () => decide('decline'),
                },
              ]
            : []
        }
        problem={problemText}
      />
    </MessageScrollerItem>
  );
}
