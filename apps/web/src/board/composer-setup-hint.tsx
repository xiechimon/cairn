import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useChief, useMachines, useProviders } from '../api/hooks.js';
import { useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { Key, Monitor } from '../icons/index.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  coordinatorCanAnswer,
  type FirstRunStepId,
  firstRunSteps,
  type ModelSides,
  modelSides,
  modelSourceCount,
  nextOpenStep,
} from './first-run-checklist-model.js';

const CHIP_CLS =
  "h-7 flex-none cursor-pointer gap-1.5 rounded-lg border-none bg-(--menu-hover) px-2 text-meta font-normal text-(--text-secondary) hover:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const CODE_CLS = 'rounded bg-(--menu-hover) px-1 py-px font-mono text-meta text-(--text-secondary)';

export interface ComposerSetupStep {
  next: FirstRunStepId;
  models: ModelSides;
}

export function useComposerSetupStep(): ComposerSetupStep | null {
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
      machinesOnline: machinesQ.data?.filter((machine) => machine.online).length,
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

function runnerStep(
  machines: readonly { name: string; online?: boolean }[] | undefined,
  command: string,
  t: TFunc,
): { label: string; hint: ReactNode } {
  const offline = (machines ?? []).filter((machine) => machine.online === false);
  const [only] = offline;
  if (only === undefined) {
    return {
      label: t('连接一台 Runner'),
      hint: withCode(t('在要干活的电脑上运行 `{command}`', { command })),
    };
  }
  if (offline.length === 1) {
    return {
      label: t('{name} 离线', { name: only.name }),
      hint: withCode(t('在 {name} 上运行 `{command}` 让它重新上线', { name: only.name, command })),
    };
  }
  return {
    label: t('{n} 台 Runner 都离线', { n: offline.length }),
    hint: withCode(t('在其中一台上运行 `{command}` 让它重新上线', { command })),
  };
}

export function ComposerSetupHint({ step: { next, models } }: { step: ComposerSetupStep }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const runner = runnerStep(machinesQ.data, `${PUBLISHED_PACKAGES.cli.command} start`, t);
  const copy: Record<FirstRunStepId, { icon: ReactNode; label: string; hint: ReactNode }> = {
    models: {
      icon: <Key width={16} height={16} />,
      ...(models.tasks
        ? {
            label: t('Coordinator 还缺模型'),
            hint: t('添加一个服务商，Coordinator 用不了 Claude Code 登录'),
          }
        : {
            label: t('接入模型来源'),
            hint: t('添加模型服务商，或在 Runner 上登录 Claude Code'),
          }),
    },
    machine: {
      icon: <Monitor width={16} height={16} />,
      ...runner,
    },
  };
  const { icon, label, hint } = copy[next];
  const href = settingsHref(next === 'models' ? 'providers' : 'machines');
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
