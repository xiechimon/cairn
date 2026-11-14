import { PUBLISHED_PACKAGES } from '@cairn/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useChief, useMachines, useProviders } from '../api/hooks.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { Key, Monitor, Settings } from '../icons/index.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/routing-settings-page.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  coordinatorCanAnswer,
  type FirstRunStepId,
  firstRunSteps,
  modelSourceCount,
  nextOpenStep,
} from './first-run-checklist-model.js';

const CHIP_CLS =
  "h-7 flex-none cursor-pointer gap-1.5 rounded-lg border-none bg-(--menu-hover) px-2 text-meta font-normal text-(--text-secondary) hover:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const CODE_CLS = 'rounded bg-(--menu-hover) px-1 py-px font-mono text-meta text-(--text-secondary)';

export function useComposerSetupStep(): FirstRunStepId | null {
  const { live, teamId } = useLiveData();
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const steps = firstRunSteps({
    modelSources: modelSourceCount(
      providersQ.data?.providers,
      routingQ.data === undefined ? undefined : (routingQ.data.connections ?? []),
    ),
    machinesOnline: machinesQ.data?.filter((machine) => machine.online).length,
    coordinatorCanAnswer: coordinatorCanAnswer(chiefQ.data),
  });
  return live ? nextOpenStep(steps) : null;
}

export function ComposerSetupHint({ next }: { next: FirstRunStepId }) {
  const { t } = useI18n();
  const copy: Record<FirstRunStepId, { icon: ReactNode; label: string; hint: ReactNode }> = {
    'model-source': {
      icon: <Key width={16} height={16} />,
      label: t('接入模型来源'),
      hint: t('添加模型服务商，或在 Runner 上登录 Claude Code'),
    },
    machine: {
      icon: <Monitor width={16} height={16} />,
      label: t('连接一台 Runner'),
      hint: (
        <>
          {t('运行')} <code className={CODE_CLS}>{`${PUBLISHED_PACKAGES.cli.command} start`}</code>{' '}
          {t('连接这台 Runner')}
        </>
      ),
    },
    coordinator: {
      icon: <Settings width={16} height={16} />,
      label: t('打开工作路由'),
      hint: t('先创建 Coordinator 规则，它才能回答你的消息。'),
    },
  };
  const { icon, label, hint } = copy[next];
  const href =
    next === 'coordinator'
      ? COORDINATOR_ROUTING_HREF
      : settingsHref(next === 'model-source' ? 'providers' : 'machines');
  return (
    <>
      <Button
        variant="ghost"
        data-testid="composer-setup-chip"
        data-step={next}
        className={CHIP_CLS}
        render={<Link to={href} />}
      >
        {icon}
        {label}
      </Button>
      <span
        data-testid="composer-setup-hint"
        className="ml-1 min-w-0 truncate text-meta text-(--text-tertiary)"
      >
        {hint}
      </span>
    </>
  );
}
