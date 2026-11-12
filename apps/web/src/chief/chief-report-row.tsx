import type {
  ChiefReportContent,
  ChiefReportTodoRef,
  IntakeItem,
  RetroProposal,
} from '@cairn/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ThreadLink } from '../board/thread-link.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

const CARD_CLS =
  'mb-3 flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3 text-ui leading-6 text-foreground';
const SECTION_CLS = 'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5';
const LABEL_CLS = 'truncate pt-px text-meta text-content-tertiary';
const REF_CLS = 'text-foreground hover:underline';
const ONE_LINE_CLS = 'my-3 text-center text-meta text-content-tertiary';

function TodoRefs({ refs }: { refs: readonly ChiefReportTodoRef[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-2">
      {refs.map((ref) => (
        <ThreadLink key={ref.id} todoId={ref.id} className={REF_CLS}>
          #{ref.seq} {ref.title}
        </ThreadLink>
      ))}
    </span>
  );
}

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
  const y = report.yesterday;
  const intake = report.intake ?? [];
  const quietYesterday =
    y.finishedCount + y.mergedCount + y.failedCount + y.retries + y.quotaWaits === 0 &&
    y.verdicts.pass + y.verdicts.block === 0;
  if (
    report.status === 'posted' &&
    quietYesterday &&
    report.retro.length === 0 &&
    intake.length === 0
  )
    return (
      <MessageScrollerItem style={{ contentVisibility: 'visible' }}>
        <p className={ONE_LINE_CLS} data-testid="chief-report" data-variant="one-line">
          {t('今天的日报：昨天没有新进展。')}
          {report.needsYou.count > 0 && (
            <Link to="/app" className={REF_CLS}>
              {t('{n} 件等你', { n: report.needsYou.count })}
            </Link>
          )}
        </p>
      </MessageScrollerItem>
    );
  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }}>
      <section
        data-testid="chief-report"
        data-status={report.status}
        aria-label={t('今天的日报')}
        className={CARD_CLS}
      >
        <h3 className="m-0 text-ui font-medium text-foreground">
          {t('今天的日报 · 昨天（{day}）', { day: report.covers })}
        </h3>
        {report.status !== 'posted' && (
          <p className="m-0 text-meta text-content-tertiary" data-testid="chief-report-notice">
            {report.status === 'retrying'
              ? t('日报没写成，过一会儿再试一次；先看昨天的数字。')
              : t('日报两次都没写成；下面是昨天的原始数字。')}
          </p>
        )}
        <div className={SECTION_CLS} data-testid="chief-report-yesterday">
          <span className={LABEL_CLS}>{t('昨天的进展')}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <span>
              {t(
                '完成 {done} · 合并 {merged} · 失败 {failed} · 重跑 {retries} · 等额度 {quota} · 审查通过 {pass} / 拦下 {block}',
                {
                  done: y.finishedCount,
                  merged: y.mergedCount,
                  failed: y.failedCount,
                  retries: y.retries,
                  quota: y.quotaWaits,
                  pass: y.verdicts.pass,
                  block: y.verdicts.block,
                },
              )}
            </span>
            {y.finished.length > 0 && (
              <span className="flex flex-wrap gap-x-2">
                <span className="text-content-tertiary">{t('完成：')}</span>
                <TodoRefs refs={y.finished} />
              </span>
            )}
            {y.merged.length > 0 && (
              <span className="flex flex-wrap gap-x-2">
                <span className="text-content-tertiary">{t('合并：')}</span>
                {y.merged.map((pr) =>
                  pr.prUrl === null ? (
                    <ThreadLink key={pr.id} todoId={pr.id} className={REF_CLS}>
                      #{pr.seq} {pr.title}
                    </ThreadLink>
                  ) : (
                    <a
                      key={pr.id}
                      href={pr.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={REF_CLS}
                    >
                      PR {pr.prNumber ?? ''} · #{pr.seq} {pr.title}
                    </a>
                  ),
                )}
              </span>
            )}
            {y.failed.length > 0 && (
              <span className="flex flex-wrap gap-x-2">
                <span className="text-content-tertiary">{t('失败：')}</span>
                <TodoRefs refs={y.failed} />
              </span>
            )}
          </div>
        </div>
        <div className={SECTION_CLS} data-testid="chief-report-needs-you">
          <span className={LABEL_CLS}>{t('等你的事')}</span>
          <span>
            {report.needsYou.count === 0 ? (
              t('没有等你的事')
            ) : (
              <Link to="/app" className={REF_CLS}>
                {t('{n} 件等你，去处理', { n: report.needsYou.count })}
              </Link>
            )}
          </span>
        </div>
        {report.status === 'posted' && report.retroRan && (
          <div className={SECTION_CLS} data-testid="chief-report-retro">
            <span className={LABEL_CLS}>{t('复盘')}</span>
            {report.retro.length === 0 ? (
              <span>{t('昨天的对话里没找到值得改的地方')}</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {report.retro.map((proposal) => (
                  <ProposalItem key={proposal.id} proposal={proposal} />
                ))}
              </ul>
            )}
          </div>
        )}
        {report.status === 'posted' && intake.length > 0 && (
          <div className={SECTION_CLS} data-testid="chief-report-intake">
            <span className={LABEL_CLS}>{t('外部动态')}</span>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {intake.map((item) => (
                <IntakeRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        )}
        {(report.truncated.length > 0 || report.retro.length > 0) && (
          <p className="m-0 border-t border-border pt-2.5 text-meta text-content-tertiary">
            {report.truncated.length > 0 &&
              t('这些来源太长，只读了后面的部分：{sources}。', {
                sources: report.truncated.join('、'),
              })}
            {report.retro.length > 0 &&
              t('复盘建议只是草稿：点「建成线程」才会建线程，建好后也要你自己开始。')}
          </p>
        )}
      </section>
    </MessageScrollerItem>
  );
}
