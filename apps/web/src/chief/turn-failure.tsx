import { ChevronDown, ChevronUp, CircleAlert, Copy, X } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { Link } from 'react-router';
import {
  type TurnErrorCopy,
  type TurnErrorFacts,
  type TurnFailureAction,
  turnErrorCopy,
} from '../api/mappers.js';
import { Button } from '../components/ui/button.js';
import { Marker } from '../components/ui/marker.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import { settingsHref } from '../settings/settings-href.js';

export const ON_MAC = typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent);

const ACTION_LABELS: Record<TurnFailureAction, string> = {
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

export function TurnFailureLine({ error }: { error: TurnErrorFacts }) {
  const { t } = useI18n();
  const copy = turnErrorCopy(error, ON_MAC);
  const text = useCopyText()(copy);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const label = copy.kind === 'unknown' ? text.title : t('没完成：{title}', { title: text.title });
  return (
    <div role="note" className="flex flex-col gap-2">
      <Marker variant="separator" className="gap-1.5 text-meta text-content-tertiary">
        <Button
          variant="ghost"
          size="sm"
          data-testid="chief-turn-error"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="h-auto min-h-7 min-w-0 shrink gap-1.5 px-1 font-normal whitespace-normal text-content-tertiary hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-content-tertiary dark:hover:bg-transparent pointer-coarse:min-h-11"
        >
          <CircleAlert aria-hidden="true" className="size-4 flex-none" />
          <span className="min-w-0">{label}</span>
          {open ? (
            <ChevronUp aria-hidden="true" className="size-4 flex-none" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-4 flex-none" />
          )}
        </Button>
      </Marker>
      {open && (
        <span
          data-testid="chief-turn-error-detail"
          className="mx-auto block w-full max-w-140 text-meta text-pretty text-content-secondary"
        >
          {text.why}
          <RawError id={detailId} text={error.message} />
        </span>
      )}
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
  const actions = copy.actions.filter(
    (action) => (action !== 'retry' && action !== 'continue') || onRetry !== undefined,
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss();
  };
  return (
    <div
      role="alert"
      data-testid="chief-turn-error-card"
      data-kind={copy.kind}
      onKeyDown={onKeyDown}
      className={`${className} relative pr-12 shadow-(--e1)`}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5.5 flex-none text-(--destructive)" />
      <span className="min-w-0 flex-1">
        <b className="block text-ui font-semibold text-(--foreground)">{text.title}</b>
        <span className="block text-pretty">{text.why}</span>
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
                data-testid="chief-turn-retry"
                onClick={onRetry}
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
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('收起')}
        title={t('收起')}
        data-testid="chief-turn-error-dismiss"
        className="absolute top-1.5 right-1.5 text-content-tertiary pointer-coarse:size-11"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}
