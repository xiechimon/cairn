import { cn } from 'cn';
import { Check } from 'lucide-react';
import { useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useReportRoute } from '../chief/report-route.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { threadProgress } from './thread-panel-model.js';

const DOT_TONE = {
  wait: 'bg-(--badge-attention)',
  run: 'bg-(--running)',
  idle: 'border border-content-tertiary',
} as const;

const STEP_TEXT = {
  done: 'text-content-secondary',
  now: 'text-foreground',
  later: 'text-content-tertiary',
} as const;

export function ThreadFacts({
  todo,
  machineName,
  waitingOnChecks,
}: {
  todo: TodoRecord;
  machineName: string | null;
  waitingOnChecks: boolean;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const project = useProjects(teamId, live).data?.find((p) => p.id === todo.projectId)?.name;
  const route = useReportRoute(todo.id, todo.phase);
  const progress = threadProgress(todo, waitingOnChecks);
  const facts = [
    ...(project !== undefined ? [['project', t('项目'), project]] : []),
    ...(machineName !== null ? [['machine', t('机器'), machineName]] : []),
    ...(route !== null ? [['route', t('结果回到'), route]] : []),
  ];
  if (facts.length === 0 && progress === null) return null;
  return (
    <div data-testid="thread-facts" className="flex flex-none flex-col gap-1.5 px-4 pb-3">
      {facts.length > 0 && (
        <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-meta">
          {facts.map(([slot, label, value]) => (
            <div key={slot} data-slot={`thread-fact-${slot}`} className="flex min-w-0 gap-1.5">
              <dt className="flex-none text-content-tertiary">{label}</dt>
              <dd className="m-0 min-w-0 truncate text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {progress !== null && (
        <ol
          aria-label={t('进度')}
          data-testid="thread-progress"
          className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-meta"
        >
          {progress.steps.map((step, index) => {
            const state = index < progress.at ? 'done' : index === progress.at ? 'now' : 'later';
            return (
              <li
                key={step}
                data-state={state}
                aria-current={state === 'now' ? 'step' : undefined}
                className="flex items-center gap-2"
              >
                {index > 0 && <span aria-hidden="true" className="h-px w-3 bg-border" />}
                <span className="flex items-center gap-1.5">
                  {state === 'done' ? (
                    <Check aria-hidden="true" className="size-3 text-content-secondary" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 rounded-full',
                        state === 'now' ? DOT_TONE[progress.tone] : 'border border-content-dim',
                      )}
                    />
                  )}
                  <span className={STEP_TEXT[state]}>{t(step)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
