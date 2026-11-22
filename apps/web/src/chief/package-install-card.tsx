import { Ban, CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalCard, ApprovalHistoryLine } from './approval-card.js';
import { installCardOf } from './approval-card-model.js';

type PackageInstallItem = Extract<ChiefStreamItem, { kind: 'package-install' }>;

type Decision = 'approve' | 'decline';
type Problem = 'owner-only' | 'closed' | 'failed' | null;

const APPROVE_TEST_ID = 'chief-package-install-approve';
const DECLINE_TEST_ID = 'chief-package-install-decline';
const HISTORY_ICON_CLS = 'size-4 text-content-tertiary';

export function PackageInstallCard({ item }: { item: PackageInstallItem }) {
  const { t, locale } = useI18n();
  const { teamId } = useLiveData();
  const { decidePackageInstall } = useApiMutations(teamId);
  const [decided, setDecided] = useState<Decision | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const waiting = item.outcome === 'waiting';
  const asking = waiting && decided === null;
  const list = (items: readonly string[]) =>
    items.length < 2
      ? items.join('')
      : t('{rest} 和 {last}', {
          rest: items.slice(0, -1).join(locale === 'zh' ? '、' : ', '),
          last: items[items.length - 1] ?? '',
        });
  const card = installCardOf(item.packages, t, list);

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

  const problemText =
    problem === 'owner-only'
      ? t('只有这台 Cairn 的所有者能批准安装。')
      : problem === 'closed'
        ? t('这次安装请求已经结束。')
        : problem === 'failed'
          ? t('未能提交，请稍后重试。')
          : null;

  const outcome = waiting && decided !== null ? `${decided}d` : item.outcome;
  const history =
    outcome === 'approved'
      ? {
          status: t('正在安装'),
          icon: <RingSpinner className={HISTORY_ICON_CLS} />,
        }
      : outcome === 'installed'
        ? {
            status: t('已安装'),
            icon: <CircleCheck strokeWidth={1.75} className={HISTORY_ICON_CLS} />,
          }
        : outcome === 'declined'
          ? { status: t('已拒绝'), icon: <Ban strokeWidth={1.75} className={HISTORY_ICON_CLS} /> }
          : outcome === 'not-answered'
            ? {
                status: t('没有等到批准'),
                icon: <Ban strokeWidth={1.75} className={HISTORY_ICON_CLS} />,
              }
            : outcome === 'failed'
              ? {
                  status: t('安装没有完成'),
                  icon: <CircleAlert strokeWidth={1.75} className={HISTORY_ICON_CLS} />,
                }
              : null;

  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }} className="mt-5">
      {asking || history === null ? (
        <ApprovalCard
          testId="chief-package-install"
          outcome={outcome}
          card={card}
          disabled={decidePackageInstall.isPending}
          busy={
            decidePackageInstall.isPending
              ? decidePackageInstall.variables?.decision === 'decline'
                ? DECLINE_TEST_ID
                : APPROVE_TEST_ID
              : null
          }
          actions={
            asking
              ? [
                  {
                    label: t('批准安装'),
                    testId: APPROVE_TEST_ID,
                    onClick: () => decide('approve'),
                  },
                  { label: t('拒绝'), testId: DECLINE_TEST_ID, onClick: () => decide('decline') },
                ]
              : []
          }
          problem={problemText}
        />
      ) : (
        <ApprovalHistoryLine
          testId="chief-package-install"
          outcome={outcome}
          card={card}
          status={history.status}
          icon={history.icon}
        />
      )}
    </MessageScrollerItem>
  );
}
