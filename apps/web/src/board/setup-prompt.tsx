import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { Key, Monitor } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useChief, useMachines, useProviders } from '../api/hooks.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { BANNER_CLS } from '../chief/chief-outage-banner.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { localRunnerBridge } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { settingsHref } from '../settings/settings-href.js';
import { UpdateCairnButton } from './desktop-update.js';
import {
  coordinatorCanAnswer,
  type FirstRunStepId,
  firstRunSteps,
  type ModelSides,
  modelSides,
  modelSourceCount,
  nextOpenStep,
} from './first-run-checklist-model.js';

const CODE_CLS = 'rounded bg-(--menu-hover) px-1 py-px font-mono text-meta text-(--text-secondary)';

export interface SetupStep {
  next: FirstRunStepId;
  models: ModelSides;
}

export function useSetupStep(): SetupStep | null {
  const { live, teamId } = useLiveData();
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const models = modelSides(
    coordinatorCanAnswer(chiefQ.data),
    modelSourceCount(
      providersQ.data?.providers,
      routingQ.data === undefined ? undefined : (routingQ.data.connections ?? []),
    ),
  );
  const next = nextOpenStep(
    firstRunSteps({
      models,
      machinesReady: machinesQ.data?.filter(
        (machine) => machine.online || machine.starting === true,
      ).length,
    }),
  );
  return live && next !== null && models !== undefined ? { next, models } : null;
}

function withCode(text: string): ReactNode {
  let offset = 0;
  return text.split('`').map((part, order) => {
    const key = offset;
    offset += part.length + 1;
    return order % 2 === 1 ? (
      <code key={key} className={CODE_CLS}>
        {part}
      </code>
    ) : (
      <Fragment key={key}>{part}</Fragment>
    );
  });
}

export function runnerStep(
  machines: readonly { name: string; online?: boolean; kind?: 'local' | 'remote' }[] | undefined,
  command: string,
  t: TFunc,
): { label: string; hint: ReactNode; reconnect: boolean } {
  const offline = (machines ?? []).filter((machine) => machine.online === false);
  const [only] = offline;
  if (only === undefined) {
    return {
      label: t('连接一台执行机'),
      hint: withCode(t('在要执行任务的电脑上运行 `{command}`', { command })),
      reconnect: false,
    };
  }
  if (offline.length === 1 && only.kind === 'local') {
    return {
      label: t('{name} 离线', { name: only.name }),
      hint: t('Cairn 会在这台电脑唤醒后自动重连'),
      reconnect: true,
    };
  }
  if (offline.length === 1) {
    return {
      label: t('{name} 离线', { name: only.name }),
      hint: withCode(t('在 {name} 上运行 `{command}` 让它重新上线', { name: only.name, command })),
      reconnect: false,
    };
  }
  return {
    label: t('{n} 台执行机都离线', { n: offline.length }),
    hint: withCode(t('在其中一台上运行 `{command}` 让它重新上线', { command })),
    reconnect: false,
  };
}

function ModelsPrompt({ models, empty }: { models: ModelSides; empty: boolean }) {
  const { t } = useI18n();
  const href = settingsHref('routing');
  const hint = models.tasks
    ? t('添加一个 Coordinator 可用的服务商，或添加 Claude 订阅和已安装 Claude Code 的执行机')
    : t('添加服务商，或添加 Claude 订阅');
  if (empty) {
    return (
      <div
        data-testid="setup-prompt"
        data-step="models"
        data-variant="empty"
        className="mx-auto mb-10 flex w-[calc(100%-2rem)] max-w-chat flex-1 flex-col items-center justify-center gap-4 text-center"
      >
        <p className="m-0 voice-title text-page text-balance text-foreground">
          {models.tasks
            ? t('Coordinator 还缺模型')
            : t('先接入一个模型来源，Coordinator 才能回复你')}
        </p>
        <Button
          data-testid="setup-prompt-action"
          size="lg"
          className="h-11 gap-2 rounded-md px-5 text-heading"
          render={<Link to={href} />}
        >
          <Key className="size-5" />
          {t('接入模型来源')}
        </Button>
        <p className="m-0 text-ui text-balance text-content-secondary">{hint}</p>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="setup-prompt"
      data-step="models"
      data-variant="line"
      className={`${BANNER_CLS} items-center`}
    >
      <Key aria-hidden="true" className="size-5 flex-none text-(--waiting-ink)" />
      <span className="min-w-0 flex-1">{t('Coordinator 现在没有模型可用')}</span>
      <Button
        variant="outline"
        size="sm"
        data-testid="setup-prompt-action"
        className="flex-none px-3"
        render={<Link to={href} />}
      >
        {t('接入模型来源')}
      </Button>
    </div>
  );
}

function MachinePrompt() {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const [bridge] = useState(localRunnerBridge);
  const [reconnecting, setReconnecting] = useState(false);
  const { label, hint, reconnect } = runnerStep(
    machinesQ.data,
    `${PUBLISHED_PACKAGES.cli.command} start`,
    t,
  );
  return (
    <div
      role="status"
      data-testid="setup-prompt"
      data-step="machine"
      data-variant="line"
      className={`${BANNER_CLS} items-center`}
    >
      <Monitor aria-hidden="true" className="size-5 flex-none text-icon" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-testid="setup-prompt-label" className="text-foreground">
          {label}
        </span>
        <span data-testid="setup-prompt-hint" className="min-w-0 break-words">
          {hint}
        </span>
      </span>
      {reconnect ? (
        bridge !== null ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="setup-prompt-reconnect"
            className="flex-none px-3"
            disabled={reconnecting}
            onClick={() => {
              setReconnecting(true);
              void bridge
                .reconnect()
                .catch((error) => toastError(t('未能重新连接，请重试。'), error))
                .finally(() => setReconnecting(false));
            }}
          >
            {t(reconnecting ? '正在重新连接…' : '重新连接')}
          </Button>
        ) : (
          <UpdateCairnButton testId="setup-prompt-update-cairn" className="px-3" />
        )
      ) : (
        <Button
          variant="outline"
          size="sm"
          data-testid="setup-prompt-action"
          className="flex-none px-3"
          render={<Link to={settingsHref('machines')} />}
        >
          {t('查看执行机')}
        </Button>
      )}
    </div>
  );
}

export function SetupPrompt({ step, empty }: { step: SetupStep; empty: boolean }) {
  return step.next === 'models' ? (
    <ModelsPrompt models={step.models} empty={empty} />
  ) : (
    <MachinePrompt />
  );
}
