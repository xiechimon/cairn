import { cn } from 'cn';
import { ChevronDown, Clock, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';
import { isVerdictStale, type PrCardModel, type PrCardResult } from './pr-card-model.js';
import { PrLink } from './pr-link.js';
import { PrRowMenu } from './pr-row-menu.js';

export interface PrCardProps {
  pr: PrCardModel;
  onViewDiff?: () => void;
  onResolve?: () => void;
  githubHref?: string;
  readOnly?: boolean;
  className?: string;
}

type Tone = 'neutral' | 'ok' | 'warn' | 'fail';

function resultWord(result: PrCardResult, t: TFunc): string {
  if (result === 'pass') return 'PASS';
  if (result === 'block') return 'BLOCK';
  return t('待定');
}

export function pillOf(pr: PrCardModel, t: TFunc): { label: string; tone: Tone } {
  if (isVerdictStale(pr)) return { label: t('需重新审核'), tone: 'warn' };
  switch (pr.state) {
    case 'open':
      return { label: t('已开启'), tone: 'neutral' };
    case 'conflicts':
      return { label: t('有冲突'), tone: 'fail' };
    case 'checks-running':
      return { label: t('检查运行中'), tone: 'neutral' };
    case 'checks-failed':
      return { label: t('检查未通过'), tone: 'fail' };
    case 'review-pending':
      return { label: t('等待审核'), tone: 'neutral' };
    case 'review-block':
      return { label: t('审核未通过'), tone: 'fail' };
    case 'closed':
      return { label: t('已关闭'), tone: 'neutral' };
    case 'draft':
      return { label: t('草稿'), tone: 'neutral' };
    case 'behind':
      return { label: t('落后于 main'), tone: 'warn' };
    case 'merge-blocked':
      return { label: t('GitHub 暂不允许合并'), tone: 'warn' };
    case 'review-pass':
      return { label: t('可合并'), tone: 'ok' };
    case 'queued':
      return { label: t('队列第 {n} 位', { n: pr.queuePosition ?? 1 }), tone: 'ok' };
    case 'merged':
      return { label: t('已合并'), tone: 'ok' };
    case 'owner-route':
      return { label: t('交给负责人'), tone: 'warn' };
  }
}

function Sha({ value }: { value: string }) {
  return <code className="font-mono tabular-nums">{value}</code>;
}

const FAILED_NAMES_SHOWN = 3;

function failedLine(pr: PrCardModel, t: TFunc): string | null {
  const { failed, failedNames = [] } = pr.checks;
  if (failed === 0) return null;
  if (failedNames.length === 0) return t('{failed} 个失败', { failed });
  const shown = failedNames.slice(0, FAILED_NAMES_SHOWN).join(', ');
  const more = failedNames.length - FAILED_NAMES_SHOWN;
  return t('{failed} 个失败：{names}', {
    failed,
    names: more > 0 ? `${shown} +${more}` : shown,
  });
}

function dotOf(pr: PrCardModel): { tone: string; label: 'failed' | 'running' | 'passed' } {
  if (pr.checks.failed > 0) return { tone: 'bg-destructive', label: 'failed' };
  if (pr.checks.running > 0) return { tone: 'bg-content-tertiary', label: 'running' };
  return { tone: 'bg-content-tertiary', label: 'passed' };
}

function stateIcon(pr: PrCardModel) {
  const Icon =
    pr.state === 'merged'
      ? GitMerge
      : pr.state === 'closed'
        ? GitPullRequestClosed
        : GitPullRequest;
  return <Icon aria-hidden strokeWidth={1.75} className="size-4 flex-none text-content-tertiary" />;
}

function CheckCount({ pr }: { pr: PrCardModel }) {
  const { t } = useI18n();
  const { passed, total } = pr.checks;
  if (total === 0 && pr.ciUnread === true) {
    return (
      <span
        data-slot="pr-checks"
        data-ci="unread"
        className="flex-none text-meta text-content-tertiary"
      >
        {t('CI 未读取')}
      </span>
    );
  }
  if (total === 0) return null;
  const dot = dotOf(pr);
  return (
    <span
      data-slot="pr-checks"
      data-ci={dot.label}
      title={t('检查通过 {passed} / {total}', { passed, total })}
      className="inline-flex flex-none items-center gap-1 text-meta text-content-tertiary tabular-nums"
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', dot.tone)} />
      {passed}/{total}
    </span>
  );
}

function verdictText(pr: PrCardModel, t: TFunc): string | null {
  const { verdict } = pr;
  if (pr.state === 'owner-route') return pr.ownerRoute ?? t('交给负责人合并');
  if (pr.state === 'conflicts') return t('与 main 冲突，解决后才会审核');
  if (pr.state === 'behind') return t('分支落后，更新后才能合并');
  if (pr.state === 'merge-blocked') return t('审核已通过，GitHub 还不允许合并');
  if (verdict == null) {
    return pr.state === 'draft' || pr.state === 'closed' ? null : t('还没有审核');
  }
  if (isVerdictStale(pr)) {
    return `${t('审核结论已过期')} (${t('评审于')} ${verdict.judgedHead} → ${pr.currentHead})`;
  }
  return `${t('审核 {result}', { result: resultWord(verdict.result, t) })} · ${t('评审于')} ${verdict.judgedHead}`;
}

function Details({ pr }: { pr: PrCardModel }) {
  const { t } = useI18n();
  const lenses = pr.verdict?.lenses ?? [];
  const blockers = pr.blockers ?? [];
  const verdict = verdictText(pr, t);
  const failures = failedLine(pr, t);
  const hasBranch = pr.branch !== undefined && pr.branch !== '';
  return (
    <div
      data-slot="pr-card-details"
      className="flex flex-col gap-1 pt-1.5 pl-5.5 text-meta text-content-tertiary"
    >
      <p data-slot="pr-card-title" className="m-0 break-words text-ui text-foreground">
        {pr.title}
      </p>
      {(hasBranch || pr.additions !== undefined) && (
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 tabular-nums">
          {hasBranch && (
            <span className="min-w-0 truncate font-mono">
              {pr.branch}
              {pr.base !== undefined && pr.base !== '' ? ` → ${pr.base}` : ''}
            </span>
          )}
          {pr.additions !== undefined && pr.deletions !== undefined && (
            <span>
              +{pr.additions} −{pr.deletions}
            </span>
          )}
        </p>
      )}
      {failures !== null && (
        <p data-slot="pr-card-failures" className="m-0 break-words">
          {failures}
        </p>
      )}
      {verdict !== null && <p className="m-0">{verdict}</p>}
      {lenses.length > 0 && (
        <p className="m-0">
          {lenses.map((lens) => `${lens.name} ${resultWord(lens.result, t)}`).join(' · ')}
        </p>
      )}
      {blockers.map((blocker) => (
        <p key={blocker} className="m-0 min-w-0 break-words">
          {blocker}
        </p>
      ))}
      {verdict === null && (
        <p className="m-0">
          {t('评审 head')} <Sha value={pr.currentHead} />
        </p>
      )}
    </div>
  );
}

export function PrCard(props: PrCardProps) {
  const { pr, className, githubHref, onViewDiff, onResolve, readOnly } = props;
  const { t } = useI18n();
  const pill = pillOf(pr, t);
  const needsResolve =
    readOnly !== true &&
    (pr.state === 'conflicts' || pr.state === 'checks-failed' || pr.state === 'review-block');
  return (
    <article
      data-slot="pr-card"
      data-state={pr.state}
      data-stale={isVerdictStale(pr) ? '' : undefined}
      className={cn('@container/pr min-w-0 rounded-(--radius-control) py-1.5 pr-1 pl-2', className)}
    >
      <Collapsible className="group/details">
        <div data-slot="pr-card-row" className="flex items-center gap-2">
          {stateIcon(pr)}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-meta text-content-secondary">
            {githubHref != null ? (
              <PrLink number={pr.number} url={githubHref} />
            ) : (
              <span className="flex-none font-medium tabular-nums">PR #{pr.number}</span>
            )}
            <span aria-hidden className="flex-none text-content-tertiary">
              ·
            </span>
            <span data-slot="pr-card-state" className="min-w-0 truncate">
              {pill.label}
            </span>
            <CheckCount pr={pr} />
            {pr.additions !== undefined && pr.deletions !== undefined && (
              <span
                data-slot="pr-card-diff"
                className="hidden flex-none items-center gap-1.5 text-content-tertiary tabular-nums @min-[24rem]/pr:flex"
              >
                <span aria-hidden>·</span>
                <span>+{pr.additions}</span>
                <span>−{pr.deletions}</span>
              </span>
            )}
          </div>
          <CollapsibleTrigger
            aria-label={t('详情')}
            className="inline-flex size-6 flex-none items-center justify-center rounded-md text-content-tertiary outline-none hover:text-content-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronDown className="size-4 group-data-[open]/details:rotate-180" />
          </CollapsibleTrigger>
          {githubHref != null && (
            <PrRowMenu
              number={pr.number}
              url={githubHref}
              onViewChanges={onViewDiff}
              onResolve={needsResolve ? onResolve : undefined}
            />
          )}
        </div>
        {pr.readAgoMinutes != null && (
          <p
            data-slot="pr-card-late"
            className="m-0 flex items-center gap-1.5 pt-0.5 pl-5.5 text-meta text-content-tertiary"
          >
            <Clock className="size-4 flex-none" aria-hidden />
            {t('{n} 分钟前读取，GitHub 可能被限流或延迟', { n: pr.readAgoMinutes })}
          </p>
        )}
        <CollapsibleContent>
          <Details pr={pr} />
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}
