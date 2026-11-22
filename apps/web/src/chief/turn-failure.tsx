import { ChevronDown, ChevronUp, CircleAlert, Copy, X } from 'lucide-react';
import { createContext, type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import {
  type TurnErrorCopy,
  type TurnErrorFacts,
  type TurnFailureAction,
  turnErrorCopy,
} from '../api/mappers.js';
import { canUpdateDesktop, updateDesktopNow } from '../board/desktop-update.js';
import { PANE_PARAM } from '../board/work-panel.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent, MarkerIcon } from '../components/ui/marker.js';
import { toastSuccess } from '../components/ui/toaster.js';
import type { QueueWait } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import { settingsHref } from '../settings/settings-href.js';

export const ON_MAC = typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent);

const FAIL_ICON_CLS = 'mt-0.5 size-5.5 flex-none text-(--destructive)';
const WAIT_ICON_CLS = 'mt-0.5 size-5.5 flex-none text-(--card-button)';

const ACTION_LABELS: Record<TurnFailureAction, string> = {
  update: '更新 Cairn',
  retry: '重试',
  continue: '继续',
  swap: '换 Coordinator 模型',
  pick: '选 Coordinator 模型',
  provider: '检查 {provider}',
  key: '重新填写 API key',
  settings: '打开模型设置',
};

function actionHref(action: TurnFailureAction, error: TurnErrorFacts): string | null {
  if (action === 'swap' || action === 'pick') return COORDINATOR_ROUTING_HREF;
  if (action === 'provider' || action === 'key')
    return error.providerId === undefined
      ? settingsHref('routing')
      : `${settingsHref('routing')}?item=provider:${error.providerId}`;
  if (action === 'settings') return settingsHref('routing');
  return null;
}

function useCopyText() {
  const { t } = useI18n();
  return (copy: TurnErrorCopy) => {
    const vars = { ...copy.vars, provider: copy.vars.provider || t('模型服务') };
    return { title: t(copy.title, vars), why: t(copy.why, vars), vars };
  };
}

function RawError({ id, text }: { id: string; text: string }) {
  const { t } = useI18n();
  return (
    <span
      id={id}
      data-testid="chief-turn-error-raw"
      className="relative mt-1 block rounded-lg bg-card py-2 pr-9 pl-2.5 font-mono text-caption whitespace-pre-wrap text-content-secondary shadow-(--edge-ring) [overflow-wrap:anywhere]"
    >
      {text}
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-1 right-1 text-content-tertiary pointer-coarse:size-11"
        aria-label={t('复制原始错误')}
        title={t('复制原始错误')}
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => toastSuccess(t('已复制')))
        }
      >
        <Copy className="size-4" />
      </Button>
    </span>
  );
}

export const CardFailureContext = createContext<string | null>(null);

export function TurnFailureMarker() {
  const { t } = useI18n();
  return (
    <Marker
      variant="separator"
      role="note"
      data-testid="chief-turn-error"
      className="gap-1.5 text-meta text-content-tertiary"
    >
      <MarkerIcon>
        <CircleAlert />
      </MarkerIcon>
      <MarkerContent>{t('没完成')}</MarkerContent>
    </Marker>
  );
}

function NoticeCard({
  testId,
  kind,
  tone,
  title,
  why,
  className,
  onDismiss,
  children,
}: {
  testId: string;
  kind: string;
  tone: 'fail' | 'wait';
  title: string;
  why: string;
  className: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss();
  };
  return (
    <div
      role="status"
      aria-live={tone === 'fail' ? 'assertive' : 'polite'}
      data-testid={testId}
      data-kind={kind}
      onKeyDown={onKeyDown}
      className={`${className} relative pr-12 shadow-(--e1)`}
    >
      <CircleAlert aria-hidden="true" className={tone === 'fail' ? FAIL_ICON_CLS : WAIT_ICON_CLS} />
      <span className="min-w-0 flex-1">
        <b className="block text-ui font-semibold text-(--foreground)">{title}</b>
        <span className="block text-pretty">{why}</span>
        {children}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('收起')}
        title={t('收起')}
        data-testid={`${testId}-dismiss`}
        className="absolute top-1.5 right-1.5 text-content-tertiary pointer-coarse:size-11"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

export function TurnFailureCard({
  error,
  className,
  onRetry,
  onDismiss,
}: {
  error: TurnErrorFacts;
  className: string;
  onRetry?: (() => void) | undefined;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const copy = turnErrorCopy(error, ON_MAC);
  const text = useCopyText()(copy);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const actions = copy.actions.filter((action) =>
    action === 'update'
      ? canUpdateDesktop()
      : (action !== 'retry' && action !== 'continue') || onRetry !== undefined,
  );
  return (
    <NoticeCard
      testId="chief-turn-error-card"
      kind={copy.kind}
      tone="fail"
      title={text.title}
      why={text.why}
      className={className}
      onDismiss={onDismiss}
    >
      <span className="mt-2 flex flex-wrap items-center gap-2">
        {actions.map((action, n) => {
          const href = actionHref(action, error);
          const label = t(ACTION_LABELS[action], text.vars);
          const variant = n === 0 ? 'default' : 'outline';
          return href === null ? (
            <Button
              key={action}
              size="sm"
              variant={variant}
              className="pointer-coarse:h-11"
              data-testid={action === 'update' ? 'chief-turn-update' : 'chief-turn-retry'}
              onClick={action === 'update' ? () => void updateDesktopNow() : onRetry}
            >
              {label}
            </Button>
          ) : (
            <Button
              key={action}
              size="sm"
              variant={variant}
              className="pointer-coarse:h-11"
              render={<Link to={href} />}
            >
              {label}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={detailId}
          className="gap-0.5 px-1 font-normal text-content-tertiary pointer-coarse:h-11"
          onClick={() => setOpen((v) => !v)}
        >
          {t('详情')}
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
      </span>
      {open && <RawError id={detailId} text={error.message} />}
    </NoticeCard>
  );
}

export function QueueWaitCard({
  wait,
  className,
  onDismiss,
}: {
  wait: QueueWait;
  className: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const computer = wait.kind === 'no-computer';
  const title = computer
    ? t('Coordinator 的电脑还没准备好')
    : wait.machine !== undefined
      ? t('执行机 {machine} 离线', { machine: wait.machine })
      : t('执行机离线');
  const why = computer
    ? t('这一步要用电脑，但还没有能用的电脑。打开执行机面板启动它，就绪后这一轮会自动接着跑。')
    : t(
        '这一步要在执行机上跑，但它现在不在线。确认电脑开着、Cairn 在运行，它一上线这一轮就会自动接着跑。',
      );
  return (
    <NoticeCard
      testId="chief-queue-wait-card"
      kind={wait.kind}
      tone="wait"
      title={title}
      why={why}
      className={className}
      onDismiss={onDismiss}
    >
      <span className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="pointer-coarse:h-11"
          render={<Link to={computer ? `/app?${PANE_PARAM}=machines` : settingsHref('machines')} />}
        >
          {computer ? t('打开电脑') : t('查看执行机')}
        </Button>
      </span>
    </NoticeCard>
  );
}
