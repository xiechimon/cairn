import type { ChiefReportContent, IntakeItem, RetroProposal } from '@cairn/shared';
import { type ReactNode, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ThreadLink } from '../board/thread-link.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

const REF_CLS = 'text-foreground hover:underline';
const LINE_CLS = 'my-3 text-center text-meta text-content-tertiary';
const OPEN_CLS = 'px-0 text-meta font-normal no-underline hover:underline';
const DRAFTS_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;

function Decision({
  proposal,
  children,
}: {
  proposal: Pick<RetroProposal, 'id' | 'status' | 'todoId'>;
  children: (status: RetroProposal['status'], footer: ReactNode) => ReactNode;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [local, setLocal] = useState<Pick<RetroProposal, 'status' | 'todoId'> | null>(null);
  const status = local?.status ?? proposal.status;
  const todoId = local?.todoId ?? proposal.todoId;
  const decide = (decision: 'accept' | 'dismiss') => {
    if (!live) {
      setLocal({ status: decision === 'accept' ? 'accepted' : 'dismissed', todoId: null });
      return;
    }
    mutations.decideRetroProposal.mutate(
      { proposalId: proposal.id, decision },
      {
        onSuccess: (updated) => setLocal({ status: updated.status, todoId: updated.todoId }),
        onError: (error) => toastError(t('没能更新这条建议，请重试。'), error),
      },
    );
  };
  const footer =
    status === 'draft' ? (
      <span className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={mutations.decideRetroProposal.isPending}
          onClick={() => decide('accept')}
        >
          {t('建成线程')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={mutations.decideRetroProposal.isPending}
          onClick={() => decide('dismiss')}
        >
          {t('不用了')}
        </Button>
      </span>
    ) : (
      <span className="text-meta text-content-tertiary">
        {status === 'accepted' ? (
          todoId === null ? (
            t('已建成线程')
          ) : (
            <ThreadLink todoId={todoId} className={REF_CLS}>
              {t('已建成线程')}
            </ThreadLink>
          )
        ) : (
          t('已忽略')
        )}
      </span>
    );
  return children(status, footer);
}

function ProposalItem({ proposal }: { proposal: RetroProposal }) {
  const { t } = useI18n();
  const source = proposal.source;
  return (
    <Decision proposal={proposal}>
      {(status, footer) => (
        <li
          data-testid="chief-report-proposal"
          data-status={status}
          className="flex min-w-0 flex-col gap-1 data-[status=dismissed]:opacity-60"
        >
          <span className="font-medium text-foreground">{proposal.title}</span>
          <span>{proposal.what}</span>
          <span className="text-meta text-content-tertiary">
            {t('为什么没拦住：{why}', { why: proposal.why })}
          </span>
          <span className="text-meta text-content-tertiary">
            {t('防护：{safeguard}', { safeguard: proposal.safeguard })}
          </span>
          <span className="text-meta text-content-tertiary">
            {t('出处：')}
            {source.todoId === null ? (
              t('协调者对话')
            ) : (
              <ThreadLink todoId={source.todoId} className={REF_CLS}>
                {source.label}
              </ThreadLink>
            )}
          </span>
          {footer}
        </li>
      )}
    </Decision>
  );
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function IntakeRow({ item }: { item: IntakeItem }) {
  const { t } = useI18n();
  return (
    <Decision proposal={item}>
      {(status, footer) => (
        <li
          data-testid="chief-report-intake-item"
          data-status={status}
          className="flex min-w-0 flex-col gap-1 data-[status=dismissed]:opacity-60"
        >
          <span className="font-medium text-foreground">{item.claim}</span>
          <span className="text-meta text-content-tertiary">
            {t('来源：')}
            <a href={item.url} target="_blank" rel="noopener noreferrer" className={REF_CLS}>
              {sourceHost(item.url)}
            </a>
          </span>
          <span className="text-meta text-content-tertiary">
            {t('对应：{matches}', { matches: item.matches })}
          </span>
          <span className="text-meta text-content-tertiary">
            {t('建议动作：{action}', { action: item.action })}
          </span>
          {footer}
        </li>
      )}
    </Decision>
  );
}

export function ChiefReportRow({ report }: { report: ChiefReportContent }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<ReadonlySet<string> | null>(null);
  const y = report.yesterday;
  const intake = report.intake ?? [];
  const drafts = [...report.retro, ...intake].filter((item) => item.status === 'draft');
  const decidable = drafts.length > 0 && Date.now() - report.madeAt <= DRAFTS_SHOWN_MS;
  const quiet =
    y.finishedCount + y.mergedCount + y.failedCount + y.retries + y.quotaWaits === 0 &&
    y.verdicts.pass + y.verdicts.block === 0;
  const counts = { done: y.finishedCount, merged: y.mergedCount, failed: y.failedCount };
  const summary =
    report.status !== 'posted'
      ? t('日报没写成，昨天：完成 {done} · 合并 {merged} · 失败 {failed}', counts)
      : quiet
        ? t('今天的日报：昨天没有新进展')
        : t('今天的日报：完成 {done} · 合并 {merged} · 失败 {failed}', counts);
  const retro = report.retro.filter((item) => shown?.has(item.id));
  const outside = intake.filter((item) => shown?.has(item.id));
  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }}>
      <p className={LINE_CLS} data-testid="chief-report" data-status={report.status}>
        {summary}
        {decidable && (
          <>
            {' · '}
            <Button
              variant="link"
              size="xs"
              data-testid="chief-report-open"
              className={OPEN_CLS}
              onClick={() => setShown(new Set(drafts.map((item) => item.id)))}
            >
              {t('{n} 条建议等你决定 →', { n: drafts.length })}
            </Button>
          </>
        )}
      </p>
      <DialogShell
        open={shown !== null}
        onClose={() => setShown(null)}
        title={t('等你决定的建议')}
        subtitle={t('来自 {day} 的日报', { day: report.covers })}
      >
        <div className="flex flex-col gap-5" data-testid="chief-report-drafts">
          {retro.length > 0 && (
            <section className="flex min-w-0 flex-col gap-2" data-testid="chief-report-retro">
              <h3 className="m-0 text-meta font-normal text-content-tertiary">{t('复盘')}</h3>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {retro.map((proposal) => (
                  <ProposalItem key={proposal.id} proposal={proposal} />
                ))}
              </ul>
            </section>
          )}
          {outside.length > 0 && (
            <section className="flex min-w-0 flex-col gap-2" data-testid="chief-report-intake">
              <h3 className="m-0 text-meta font-normal text-content-tertiary">{t('外部动态')}</h3>
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {outside.map((item) => (
                  <IntakeRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
          <p className="m-0 text-meta text-content-tertiary">
            {t('点「建成线程」才会建线程，建好后也要你自己开始。')}
          </p>
        </div>
      </DialogShell>
    </MessageScrollerItem>
  );
}
