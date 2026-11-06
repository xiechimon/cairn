import { Link } from 'react-router';
import { useChief, useMachines, useProviders } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  coordinatorCanAnswer,
  FIRST_RUN_STEP_IDS,
  type FirstRunStepId,
  firstRunComplete,
  firstRunSteps,
} from './first-run-checklist-model.js';

const STEP_COPY: Record<FirstRunStepId, { title: string; hint: string; action: string }> = {
  provider: {
    title: '添加模型服务',
    hint: '接入一个模型服务商，Coordinator 才有模型可用。',
    action: '去添加',
  },
  machine: {
    title: '连接一台机器',
    hint: '机器在线，任务才有地方运行。',
    action: '去连接',
  },
  coordinator: {
    title: '设置 Coordinator',
    hint: '给 Coordinator 选一个 Agent，它才能回答。',
    action: '去设置',
  },
};

const STEP_DONE_COPY: Record<FirstRunStepId, string> = {
  provider: '模型服务已添加',
  machine: '有机器在线',
  coordinator: 'Coordinator 可以回答',
};

export function FirstRunChecklist({
  onOpenCoordinatorSettings,
}: {
  onOpenCoordinatorSettings: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const providersQ = useProviders(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const steps = firstRunSteps({
    providerCount: providersQ.data?.providers.length,
    machinesOnline: machinesQ.data?.filter((machine) => machine.online).length,
    coordinatorCanAnswer: coordinatorCanAnswer(chiefQ.data),
  });
  if (!live || steps === null || firstRunComplete(steps)) return null;
  const firstOpen = steps.find((step) => !step.done)?.id;
  const actionFor = (id: FirstRunStepId, label: string) => {
    const variant = id === firstOpen ? 'default' : 'outline';
    if (id === 'coordinator') {
      return (
        <Button
          size="sm"
          variant={variant}
          className="ml-auto flex-none"
          onClick={onOpenCoordinatorSettings}
        >
          {label}
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant={variant}
        className="ml-auto flex-none"
        render={<Link to={settingsHref(id === 'provider' ? 'providers' : 'machines')} />}
      >
        {label}
      </Button>
    );
  };
  return (
    <section
      data-testid="first-run-checklist"
      aria-label={t('开始使用')}
      className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-182 flex-none rounded-(--radius-card) bg-(--card) p-4 text-ui ring-1 ring-(--border)"
    >
      <h2 className="m-0 text-card-title font-semibold text-foreground">
        {t('先接上这三样，Coordinator 才能回答')}
      </h2>
      <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {FIRST_RUN_STEP_IDS.map((id) => {
          const step = steps.find((candidate) => candidate.id === id);
          const done = step?.done === true;
          const copy = STEP_COPY[id];
          return (
            <li
              key={id}
              data-testid={`first-run-step-${id}`}
              data-done={done ? 'true' : 'false'}
              className="flex min-h-9 items-center gap-3"
            >
              <StatusGlyph
                kind={done ? 'done' : 'ring'}
                className={done ? 'text-running-text' : 'text-content-tertiary'}
              />
              <span className="flex min-w-0 flex-col">
                <span className={done ? 'text-content-secondary' : 'font-medium text-foreground'}>
                  {done ? t(STEP_DONE_COPY[id]) : t(copy.title)}
                </span>
                {!done && <span className="text-meta text-content-secondary">{t(copy.hint)}</span>}
              </span>
              {!done && actionFor(id, t(copy.action))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
