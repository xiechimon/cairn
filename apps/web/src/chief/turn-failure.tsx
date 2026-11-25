import { X } from 'lucide-react';
import { createContext, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  type TurnErrorCopy,
  type TurnErrorFacts,
  type TurnFailureAction,
  turnErrorCopy,
} from '../api/mappers.js';
import { canUpdateDesktop, updateDesktopNow } from '../board/desktop-update.js';
import { PANE_PARAM } from '../board/work-panel.js';
import { NoticeLine } from '../components/chat/notice-line.js';
import { Button } from '../components/ui/button.js';
import type { QueueWait } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import { settingsHref } from '../settings/settings-href.js';

export const ON_MAC = typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent);

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
    const vars = { ...copy.vars, provider: copy.vars.provider || t('该服务商') };
    return { title: t(copy.title, vars), why: t(copy.why, vars), vars };
  };
}

export const CardFailureContext = createContext<string | null>(null);

function NoticeCard({
  testId,
  kind,
  tone,
  title,
  why,
  className,
  onDismiss,
  detail,
  detailTestId,
  children,
}: {
  testId: string;
  kind: string;
  tone: 'fail' | 'wait';
  title: string;
  why: string;
  className: string;
  onDismiss: () => void;
  detail?: { lines: string[]; raw: string } | undefined;
  detailTestId?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss();
  };
  return (
    <div data-kind={kind} className={className}>
      <NoticeLine
        testId={testId}
        tone={tone === 'fail' ? 'danger' : 'waiting'}
        waiting={tone === 'wait'}
        detail={detail}
        detailTestId={detailTestId}
        onKeyDown={onKeyDown}
        label={
          <>
            <b className="font-semibold text-foreground">{title}</b> <span>{why}</span>
          </>
        }
        actions={
          <>
            {children}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('收起')}
              title={t('收起')}
              data-testid={`${testId}-dismiss`}
              className="size-6 text-content-tertiary pointer-coarse:size-11"
              onClick={onDismiss}
            >
              <X />
            </Button>
          </>
        }
      />
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
      detail={{ lines: [], raw: error.message }}
      detailTestId="chief-turn-error-raw"
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
      </span>
    </NoticeCard>
  );
}

export function QueueWaitCard({
  wait,
  className,
  onDismiss,
  onSwitchMachine,
  switching,
}: {
  wait: QueueWait;
  className: string;
  onDismiss: () => void;
  onSwitchMachine?: (stepId: string, machineId: string) => void;
  switching?: boolean;
}) {
  const { t } = useI18n();
  const computer = wait.kind === 'no-computer';
  const alternates = computer ? [] : (wait.alternateMachines ?? []);
  const primaryAlt = wait.stepId !== undefined ? alternates[0] : undefined;
  const canSwitch = primaryAlt !== undefined && onSwitchMachine !== undefined;
  const title = computer
    ? t('Coordinator 的电脑尚未就绪')
    : wait.machine !== undefined
      ? t('执行机 {machine} 离线', { machine: wait.machine })
      : t('执行机离线');
  const why = computer
    ? t('这一步需要电脑，但暂无可用的电脑。打开执行机面板启动它，就绪后本轮会自动继续。')
    : wait.lockReason === 'local-project'
      ? t('此项目文件夹仅在该执行机本地。确认电脑已开机、Cairn 正在运行，上线后本轮会自动继续。')
      : canSwitch
        ? t('这一步正在等该执行机恢复，也可以直接切换到另一台在线执行机继续。')
        : t(
            '这一步要在执行机上运行，但它当前离线。确认电脑已开机、Cairn 正在运行，执行机上线后本轮会自动继续。',
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
        {canSwitch && wait.stepId !== undefined && (
          <Button
            size="sm"
            disabled={switching}
            className="pointer-coarse:h-11"
            data-testid="chief-queue-switch-machine"
            onClick={() => {
              if (wait.stepId !== undefined) onSwitchMachine(wait.stepId, primaryAlt.machineId);
            }}
          >
            {t('改在 {machine} 继续', { machine: primaryAlt.name })}
          </Button>
        )}
        <Button
          size="sm"
          variant={canSwitch ? 'outline' : 'default'}
          className="pointer-coarse:h-11"
          render={<Link to={computer ? `/app?${PANE_PARAM}=machines` : settingsHref('machines')} />}
        >
          {computer ? t('打开电脑') : t('查看执行机')}
        </Button>
      </span>
    </NoticeCard>
  );
}
