import { cn } from 'cn';
import { ChevronDown, Clock, ExternalLink, GitPullRequest } from 'lucide-react';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { Button } from '../ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';
import { isVerdictStale, type PrCardModel, type PrCardResult } from './pr-card-model.js';

export interface PrCardProps {
  pr: PrCardModel;
  onViewDiff?: () => void;
  onResolve?: () => void;
  githubHref?: string;
  readOnly?: boolean;
  className?: string;
}

type Tone = 'neutral' | 'ok' | 'warn' | 'fail';

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  ok: 'bg-(--chip-done-bg) text-(--chip-done-fg)',
  warn: 'bg-(--chip-confirm-bg) text-(--chip-confirm-fg)',
  fail: 'bg-(--chip-failed-bg) text-(--chip-failed-fg)',
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-content-secondary',
  ok: 'text-(--chip-done-fg)',
  warn: 'text-(--chip-confirm-fg)',
  fail: 'text-(--fail-fg)',
};

const RESULT_TONE: Record<PrCardResult, Tone> = { pass: 'ok', block: 'fail', pending: 'neutral' };

function resultWord(result: PrCardResult, t: TFunc): string {
  if (result === 'pass') return 'PASS';
  if (result === 'block') return 'BLOCK';
  return t('待定');
}

export function pillOf(pr: PrCardModel, t: TFunc): { label: string; tone: Tone } {
  if (pr.state !== 'merged' && isVerdictStale(pr)) return { label: t('需重新审核'), tone: 'warn' };
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

function VerdictLine({ pr }: { pr: PrCardModel }) {
  const { t } = useI18n();
  const { verdict } = pr;
  const stale = isVerdictStale(pr);
  const current = (
    <>
      {' · head '}
      <Sha value={pr.currentHead} />
    </>
  );
  if (pr.state === 'merged' && verdict != null) {
    return (
      <p className="m-0 text-meta text-content-secondary">
        {t('审核 {result}', { result: resultWord(verdict.result, t) })}
        {' · '}
        {t('评审于')} <Sha value={verdict.judgedHead} />
      </p>
    );
  }
  if (pr.state === 'checks-running' || pr.state === 'checks-failed') {
    return (
      <p
        className={cn(
          'm-0 text-meta',
          pr.state === 'checks-failed' ? 'text-(--fail-fg)' : 'text-content-secondary',
        )}
      >
        {checksSummary(pr, t)}
        {current}
      </p>
    );
  }
  if (pr.state === 'closed' || pr.state === 'draft') {
    return (
      <p className="m-0 text-meta text-content-secondary">
        {checksSummary(pr, t)}
        {current}
      </p>
    );
  }
  if (pr.state === 'behind' || pr.state === 'merge-blocked') {
    return (
      <p className="m-0 text-meta text-(--chip-confirm-fg)">
        {pr.state === 'behind'
          ? t('分支落后，更新后才能合并')
          : t('审核已通过，GitHub 还不允许合并')}
        {current}
      </p>
    );
  }
  if (pr.state === 'conflicts') {
    return (
      <p className="m-0 text-meta text-(--fail-fg)">
        {t('与 main 冲突，解决后才会审核')}
        {current}
      </p>
    );
  }
  if (pr.state === 'owner-route') {
    return (
      <p className="m-0 text-meta text-(--chip-confirm-fg)">
        {pr.ownerRoute ?? t('交给负责人合并')}
        {verdict != null && !stale && (
          <>
            {' · '}
            {t('审核 {result}', { result: resultWord(verdict.result, t) })}
            {' · '}
            {t('评审于')} <Sha value={verdict.judgedHead} />
          </>
        )}
      </p>
    );
  }
  if (verdict == null) {
    return (
      <p className="m-0 text-meta text-content-tertiary">
        {t('还没有审核')}
        {current}
      </p>
    );
  }
  if (stale) {
    return (
      <p className="m-0 text-meta text-(--chip-confirm-fg)">
        {t('head 已移到')} <Sha value={pr.currentHead} /> {'· '}
        {t('审核结论已过期')} ({t('评审于')} <Sha value={verdict.judgedHead} />)
      </p>
    );
  }
  return (
    <p className={cn('m-0 text-meta', TONE_TEXT[RESULT_TONE[verdict.result]])}>
      {t('审核 {result}', { result: resultWord(verdict.result, t) })} {'· '}
      {t('评审于')} <Sha value={verdict.judgedHead} />
    </p>
  );
}

function checksSummary(pr: PrCardModel, t: TFunc): string {
  const { passed, failed, running, total } = pr.checks;
  if (failed > 0) return t('{failed} 个失败 · {passed}/{total} 通过', { failed, passed, total });
  if (running > 0)
    return t('{running} 个运行中 · {passed}/{total} 通过', { running, passed, total });
  return t('{passed}/{total} 通过', { passed, total });
}

function Details({ pr }: { pr: PrCardModel }) {
  const { t } = useI18n();
  const lenses = pr.verdict?.lenses ?? [];
  const blockers = pr.blockers ?? [];
  return (
    <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 pt-2 text-meta">
      {pr.repo != null && (
        <>
          <dt className="text-content-tertiary">{t('仓库')}</dt>
          <dd className="m-0 min-w-0 truncate font-mono text-content-secondary">{pr.repo}</dd>
        </>
      )}
      {pr.branch != null && (
        <>
          <dt className="text-content-tertiary">{t('分支')}</dt>
          <dd className="m-0 min-w-0 truncate font-mono text-content-secondary">{pr.branch}</dd>
        </>
      )}
      <dt className="text-content-tertiary">{t('检查')}</dt>
      <dd className="m-0 text-content-secondary">{checksSummary(pr, t)}</dd>
      {pr.verdict != null && (
        <>
          <dt className="text-content-tertiary">{t('评审 head')}</dt>
          <dd className="m-0 text-content-secondary">
            <Sha value={pr.verdict.judgedHead} />
            {isVerdictStale(pr) && (
              <>
                {' → '}
                <Sha value={pr.currentHead} />
              </>
            )}
          </dd>
        </>
      )}
      {lenses.length > 0 && (
        <>
          <dt className="text-content-tertiary">{t('审核视角')}</dt>
          <dd className="m-0 flex flex-wrap gap-1">
            {lenses.map((lens) => (
              <span
                key={lens.name}
                className={cn(
                  'inline-flex h-5 items-center rounded-md px-1.5 text-caption',
                  TONE_CHIP[RESULT_TONE[lens.result]],
                )}
              >
                {lens.name} {resultWord(lens.result, t)}
              </span>
            ))}
          </dd>
        </>
      )}
      {blockers.length > 0 && (
        <>
          <dt className="text-content-tertiary">{t('阻塞项')}</dt>
          <dd className="m-0 flex min-w-0 flex-col gap-0.5 text-content-secondary">
            {blockers.map((blocker) => (
              <span key={blocker} className="min-w-0 break-words">
                {blocker}
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

function Actions({ pr, onViewDiff, onResolve, githubHref, readOnly }: PrCardProps) {
  const { t } = useI18n();
  const needsResolve =
    readOnly !== true &&
    (pr.state === 'conflicts' || pr.state === 'checks-failed' || pr.state === 'review-block');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {needsResolve && (
        <Button size="sm" onClick={onResolve} className="h-6.5 px-2.25 text-meta">
          {t('解决')}
        </Button>
      )}
      {(readOnly !== true || onViewDiff != null) && (
        <Button
          size="sm"
          variant="outline"
          onClick={onViewDiff}
          className="h-6.5 px-2.25 text-meta"
        >
          {t('查看 diff')}
        </Button>
      )}
      {githubHref != null && (
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<a href={githubHref} target="_blank" rel="noreferrer" />}
          className="h-6.5 px-2.25 text-meta"
        >
          {t('在 GitHub 打开')}
          <ExternalLink />
        </Button>
      )}
    </div>
  );
}

export function PrCard(props: PrCardProps) {
  const { pr, className } = props;
  const { t } = useI18n();
  const pill = pillOf(pr, t);
  return (
    <article
      data-slot="pr-card"
      data-state={pr.state}
      data-stale={pr.state !== 'merged' && isVerdictStale(pr) ? '' : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl bg-card px-3.5 py-3 shadow-(--e1)',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <GitPullRequest className="size-3.5 flex-none text-content-secondary" />
        <span className="flex-none text-meta text-content-secondary tabular-nums">
          #{pr.number}
        </span>
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-foreground">
          {pr.title}
        </h3>
        <span
          data-slot="pr-card-state"
          className={cn(
            'inline-flex h-5.5 flex-none items-center rounded-lg px-2 text-caption font-medium whitespace-nowrap',
            TONE_CHIP[pill.tone],
          )}
        >
          {pill.label}
        </span>
      </div>
      {pr.readAgoMinutes != null && (
        <p
          data-slot="pr-card-late"
          className="m-0 flex items-center gap-1.5 text-meta text-(--chip-confirm-fg)"
        >
          <Clock className="size-3 flex-none" aria-hidden />
          {t('{n} 分钟前读取，GitHub 可能被限流或延迟', { n: pr.readAgoMinutes })}
        </p>
      )}
      <VerdictLine pr={pr} />
      <Actions {...props} />
      <Collapsible className="group/details">
        <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md text-meta text-content-tertiary outline-none hover:text-content-secondary focus-visible:ring-3 focus-visible:ring-ring/50">
          {t('详情')}
          <ChevronDown className="size-3 transition-transform group-data-[open]/details:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Details pr={pr} />
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}
