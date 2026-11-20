import { PUBLISHED_PACKAGES } from '@cairn/shared';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
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

export const OWN_RUNNER_START_GRACE_MS = 15_000;

function useHeldFor(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) {
      setHeld(false);
      return;
    }
    const id = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return active && held;
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
  const [appRunsLocal] = useState(() => localRunnerBridge() !== null);
  const runnerMissing = live && next === 'machine';
  const runnerMissingSettled = useHeldFor(runnerMissing && appRunsLocal, OWN_RUNNER_START_GRACE_MS);
  if (runnerMissing && appRunsLocal && !runnerMissingSettled) return null;
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

interface LocalRunnerBridge {
  reconnect: () => Promise<void>;
}

function localRunnerBridge(): LocalRunnerBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { localRunner?: LocalRunnerBridge } })
    .cairnDesktop;
  return desktop?.localRunner ?? null;
}

export function runnerStep(
  machines: readonly { name: string; online?: boolean; kind?: 'local' | 'remote' }[] | undefined,
  command: string,
  appRunsLocal: boolean,
  t: TFunc,
): { label: string; hint: ReactNode; reconnect: boolean } {
  const offline = (machines ?? []).filter((machine) => machine.online === false);
  const [only] = offline;
  if (only === undefined) {
    return {
      label: t('连接一台执行机'),
      hint: withCode(t('在要干活的电脑上运行 `{command}`', { command })),
      reconnect: false,
    };
  }
  if (offline.length === 1 && only.kind === 'local' && appRunsLocal) {
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

export function ComposerSetupHint({ step: { next, models } }: { step: ComposerSetupStep }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const [bridge] = useState(localRunnerBridge);
  const [reconnecting, setReconnecting] = useState(false);
  const { reconnect, ...runner } = runnerStep(
    machinesQ.data,
    `${PUBLISHED_PACKAGES.cli.command} start`,
    bridge !== null,
    t,
  );
  const copy: Record<FirstRunStepId, { icon: ReactNode; label: string; hint: ReactNode }> = {
    models: {
      icon: <Key width={16} height={16} />,
      ...(models.tasks
        ? {
            label: t('Coordinator 还缺模型'),
            hint: t('添加一个 Coordinator 能用的服务商，或 Claude 订阅加装好 Claude Code 的执行机'),
          }
        : {
            label: t('接入模型来源'),
            hint: t('添加模型服务商，或添加 Claude 订阅'),
          }),
    },
    machine: {
      icon: <Monitor width={16} height={16} />,
      ...runner,
    },
  };
  const { icon, label, hint } = copy[next];
  const href = settingsHref(next === 'models' ? 'routing' : 'machines');
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
      {next === 'machine' && reconnect && bridge !== null && (
        <Button
          variant="ghost"
          size="xs"
          data-testid="composer-setup-reconnect"
          className="ml-1 flex-none text-(--text-secondary)"
          disabled={reconnecting}
          onClick={() => {
            setReconnecting(true);
            void bridge.reconnect().finally(() => setReconnecting(false));
          }}
        >
          {t(reconnecting ? '正在重新连接…' : '重新连接')}
        </Button>
      )}
    </>
  );
}
